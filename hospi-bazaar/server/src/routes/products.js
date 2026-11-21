'use strict';

const express = require('express');
const { pool, withTransaction } = require('../db');
const { z, str, optionalStr } = require('../utils/validation');
const { ApiError, asyncHandler } = require('../utils/errors');
const { audit } = require('../utils/audit');
const settings = require('../services/settings');
const notify = require('../services/notify');
const { authenticate } = require('../middleware/auth');
const { supplierMember, verifiedSupplier, idParam } = require('../middleware/guards');

const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'item';
const optInt = z.preprocess((v) => (v === '' || v == null ? undefined : v), z.coerce.number().int().min(0).max(100000).optional());
const fileRef = z.string().max(500).regex(/^(\/uploads\/[a-f0-9]+\.[a-z]+|https?:\/\/\S+)$/, 'Upload a file or paste a link');

const productSchema = z.object({
  category_id: z.coerce.number().int().positive(),
  brand: optionalStr(150),
  name: str(250),
  model_number: optionalStr(100),
  sku: optionalStr(100),
  short_description: optionalStr(500),
  description: optionalStr(8000),
  specifications: z.record(z.string().max(300)).default({}),
  unit_price: z.coerce.number().positive('Enter a price above zero').max(1e9),
  gst_rate: z.coerce.number().min(0).max(40),
  hsn_code: optionalStr(10),
  min_order_qty: z.coerce.number().int().min(1).max(100000).default(1),
  stock_status: z.enum(['in_stock', 'made_to_order', 'out_of_stock']),
  lead_time_days: optInt,
  warranty_months: optInt,
  installation_available: z.boolean().default(false),
  logistics_type: z.enum(['small_parcel', 'large_equipment']).default('large_equipment'),
  images: z.array(fileRef).max(8).default([]),
  documents: z.array(z.object({ document_type: z.enum(['brochure', 'datasheet', 'certificate', 'manual', 'other']), file_url: fileRef })).max(10).default([]),
});

async function writeProduct(conn, supplierId, d, productId = null) {
  const [[reg]] = await conn.query('SELECT 1 AS ok FROM supplier_categories WHERE supplier_id = ? AND category_id = ?', [supplierId, d.category_id]);
  if (!reg) throw new ApiError(400, 'Choose one of the categories you registered for', undefined);

  let brandId = null;
  if (d.brand) {
    await conn.query('INSERT INTO brands (name, slug) VALUES (?, ?) ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)', [d.brand, slugify(d.brand)]);
    const [[b]] = await conn.query('SELECT LAST_INSERT_ID() AS id');
    brandId = b.id;
    await conn.query('INSERT IGNORE INTO supplier_brands (supplier_id, brand_id) VALUES (?, ?)', [supplierId, brandId]);
  }

  const cols = [d.category_id, brandId, d.name, d.model_number ?? null, d.sku ?? null, d.short_description ?? null, d.description ?? null,
    JSON.stringify(d.specifications || {}), d.unit_price, d.gst_rate, d.hsn_code ?? null, d.min_order_qty, d.stock_status,
    d.lead_time_days ?? null, d.warranty_months ?? null, d.installation_available ? 1 : 0, d.logistics_type];

  let id = productId;
  if (productId) {
    await conn.query(
      `UPDATE products SET category_id=?, brand_id=?, name=?, model_number=?, sku=?, short_description=?, description=?, specifications=?,
         unit_price=?, gst_rate=?, hsn_code=?, min_order_qty=?, stock_status=?, lead_time_days=?, warranty_months=?,
         installation_available=?, logistics_type=? WHERE id = ?`,
      [...cols, productId]
    );
  } else {
    const [r] = await conn.query(
      `INSERT INTO products (supplier_id, slug, category_id, brand_id, name, model_number, sku, short_description, description, specifications,
         unit_price, gst_rate, hsn_code, min_order_qty, stock_status, lead_time_days, warranty_months, installation_available, logistics_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [supplierId, `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, ...cols]
    );
    id = r.insertId;
  }
  await conn.query('UPDATE products SET slug = ? WHERE id = ?', [`${slugify(d.name)}-${id}`, id]);

  await conn.query('DELETE FROM product_images WHERE product_id = ?', [id]);
  for (const [i, url] of d.images.entries()) await conn.query('INSERT INTO product_images (product_id, image_url, sort_order) VALUES (?, ?, ?)', [id, url, i]);
  await conn.query('DELETE FROM product_documents WHERE product_id = ?', [id]);
  for (const doc of d.documents) await conn.query('INSERT INTO product_documents (product_id, document_type, file_url) VALUES (?, ?, ?)', [id, doc.document_type, doc.file_url]);
  return id;
}

async function loadOwn(conn, req) {
  const [[p]] = await conn.query('SELECT * FROM products WHERE id = ? AND supplier_id = ? FOR UPDATE', [idParam(req), req.user.supplierId]);
  if (!p) throw new ApiError(404, 'Product not found');
  return p;
}

// ------------------------------------------------------------------ Supplier: manage products

const supplier = express.Router();
supplier.use(authenticate, supplierMember);

supplier.get('/', asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT p.id, p.slug, p.name, p.model_number, p.unit_price, p.stock_status, p.status, p.rejection_reason, p.updated_at,
            c.name AS category_name, (SELECT image_url FROM product_images WHERE product_id = p.id ORDER BY sort_order, id LIMIT 1) AS image_url
       FROM products p JOIN categories c ON c.id = p.category_id WHERE p.supplier_id = ? ORDER BY p.updated_at DESC`,
    [req.user.supplierId]
  );
  res.json({ products: rows });
}));

supplier.get('/categories', asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT c.id, c.name FROM supplier_categories sc JOIN categories c ON c.id = sc.category_id WHERE sc.supplier_id = ? ORDER BY c.name`,
    [req.user.supplierId]
  );
  res.json({ categories: rows, default_gst_rate: await settings.num('default_gst_rate', 12) });
}));

supplier.get('/:id', asyncHandler(async (req, res) => {
  const [[p]] = await pool.query(
    `SELECT p.*, b.name AS brand FROM products p LEFT JOIN brands b ON b.id = p.brand_id WHERE p.id = ? AND p.supplier_id = ?`,
    [idParam(req), req.user.supplierId]
  );
  if (!p) throw new ApiError(404, 'Product not found');
  const [images] = await pool.query('SELECT image_url FROM product_images WHERE product_id = ? ORDER BY sort_order, id', [p.id]);
  const [documents] = await pool.query('SELECT document_type, file_url FROM product_documents WHERE product_id = ?', [p.id]);
  res.json({ product: { ...p, images: images.map((i) => i.image_url), documents } });
}));

supplier.post('/', verifiedSupplier, asyncHandler(async (req, res) => {
  const d = productSchema.parse(req.body);
  const id = await withTransaction(async (conn) => {
    const pid = await writeProduct(conn, req.user.supplierId, d);
    await audit(conn, { actorId: req.user.id, action: 'product.created', entityType: 'product', entityId: pid, ip: req.ip });
    return pid;
  });
  res.status(201).json({ id });
}));

// Full edit. An approved product goes back for approval, so it leaves the marketplace until re-approved.
supplier.put('/:id', verifiedSupplier, asyncHandler(async (req, res) => {
  const d = productSchema.parse(req.body);
  const status = await withTransaction(async (conn) => {
    const p = await loadOwn(conn, req);
    if (p.status === 'pending_approval') throw new ApiError(409, 'This product is being reviewed. Wait for the decision before editing.');
    await writeProduct(conn, req.user.supplierId, d, p.id);
    const next = ['approved', 'inactive'].includes(p.status) ? 'pending_approval' : p.status;
    await conn.query('UPDATE products SET status = ?, rejection_reason = NULL WHERE id = ?', [next, p.id]);
    if (next === 'pending_approval') await notify.toAdmins(conn, { event: 'product_pending', title: `Product waiting for approval: ${d.name}`, entityType: 'product', entityId: p.id }, ['super_admin', 'catalog_manager']);
    await audit(conn, { actorId: req.user.id, action: 'product.updated', entityType: 'product', entityId: p.id, ip: req.ip });
    return next;
  });
  res.json({ status });
}));

// Price and stock changes keep an approved product live.
supplier.patch('/:id/price-stock', verifiedSupplier, asyncHandler(async (req, res) => {
  const d = z.object({ unit_price: z.coerce.number().positive().max(1e9), stock_status: z.enum(['in_stock', 'made_to_order', 'out_of_stock']) }).parse(req.body);
  await withTransaction(async (conn) => {
    const p = await loadOwn(conn, req);
    await conn.query('UPDATE products SET unit_price = ?, stock_status = ? WHERE id = ?', [d.unit_price, d.stock_status, p.id]);
    await audit(conn, { actorId: req.user.id, action: 'product.price_changed', entityType: 'product', entityId: p.id, oldValues: { unit_price: p.unit_price }, newValues: { unit_price: d.unit_price } });
  });
  res.json({ ok: true });
}));

supplier.post('/:id/submit', verifiedSupplier, asyncHandler(async (req, res) => {
  await withTransaction(async (conn) => {
    const p = await loadOwn(conn, req);
    if (!['draft', 'rejected'].includes(p.status)) throw new ApiError(409, 'Only a draft or rejected product can be submitted');
    await conn.query(`UPDATE products SET status = 'pending_approval', rejection_reason = NULL WHERE id = ?`, [p.id]);
    await notify.toAdmins(conn, { event: 'product_pending', title: `Product waiting for approval: ${p.name}`, entityType: 'product', entityId: p.id }, ['super_admin', 'catalog_manager']);
    await audit(conn, { actorId: req.user.id, action: 'product.submitted', entityType: 'product', entityId: p.id, ip: req.ip });
  });
  res.json({ status: 'pending_approval' });
}));

supplier.post('/:id/deactivate', asyncHandler(async (req, res) => {
  await withTransaction(async (conn) => {
    const p = await loadOwn(conn, req);
    if (p.status !== 'approved') throw new ApiError(409, 'Only a live product can be taken offline');
    await conn.query(`UPDATE products SET status = 'inactive' WHERE id = ?`, [p.id]);
  });
  res.json({ status: 'inactive' });
}));

supplier.post('/:id/activate', asyncHandler(async (req, res) => {
  await withTransaction(async (conn) => {
    const p = await loadOwn(conn, req);
    if (p.status !== 'inactive') throw new ApiError(409, 'Only an offline product can be put back live');
    await conn.query(`UPDATE products SET status = 'approved' WHERE id = ?`, [p.id]);
  });
  res.json({ status: 'approved' });
}));

supplier.delete('/:id', asyncHandler(async (req, res) => {
  await withTransaction(async (conn) => {
    const p = await loadOwn(conn, req);
    if (p.status !== 'draft') throw new ApiError(409, 'Only a draft can be deleted. Take a live product offline instead.');
    await conn.query('DELETE FROM products WHERE id = ?', [p.id]);
  });
  res.json({ ok: true });
}));

// ------------------------------------------------------------------ Public marketplace

const market = express.Router();

const esc = (s) => String(s).replace(/[\\%_]/g, (m) => `\\${m}`);
const LIVE = `p.status = 'approved' AND s.account_status = 'active' AND sv.verification_status = 'verified'`;
const FROM = `FROM products p
  JOIN suppliers s ON s.id = p.supplier_id
  JOIN supplier_verification sv ON sv.supplier_id = s.id
  JOIN categories c ON c.id = p.category_id
  LEFT JOIN brands b ON b.id = p.brand_id`;

market.get('/products', asyncHandler(async (req, res) => {
  const q = z.object({
    q: z.string().trim().max(100).optional(),
    category: z.string().trim().max(160).optional(),
    brand: z.coerce.number().int().positive().optional(),
    supplier_type: z.enum(['manufacturer', 'brand_oem', 'authorised_dealer', 'distributor']).optional(),
    min_price: z.coerce.number().min(0).optional(),
    max_price: z.coerce.number().min(0).optional(),
    negotiable: z.enum(['1']).optional(),
    sort: z.enum(['newest', 'price_asc', 'price_desc', 'name']).default('newest'),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(48).default(12),
  }).parse(req.query);

  const where = [LIVE]; const params = [];
  if (q.q) {
    for (const w of q.q.split(/\s+/).filter(Boolean).slice(0, 5)) {
      where.push(`(p.name LIKE ? OR p.model_number LIKE ? OR p.short_description LIKE ? OR b.name LIKE ? OR c.name LIKE ?)`);
      params.push(...Array(5).fill(`%${esc(w)}%`));
    }
  }
  if (q.category) {
    where.push(`(c.slug = ? OR c.parent_id = (SELECT id FROM categories WHERE slug = ?))`);
    params.push(q.category, q.category);
  }
  if (q.brand) { where.push('p.brand_id = ?'); params.push(q.brand); }
  if (q.supplier_type) { where.push('s.supplier_type = ?'); params.push(q.supplier_type); }
  if (q.min_price !== undefined) { where.push('p.unit_price >= ?'); params.push(q.min_price); }
  if (q.max_price !== undefined) { where.push('p.unit_price <= ?'); params.push(q.max_price); }
  if (q.negotiable) { where.push('p.unit_price > ?'); params.push(await settings.num('negotiation_min_unit_price', 5000)); }

  const order = { newest: 'p.id DESC', price_asc: 'p.unit_price ASC, p.id DESC', price_desc: 'p.unit_price DESC, p.id DESC', name: 'p.name ASC' }[q.sort];
  const clause = where.join(' AND ');
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total ${FROM} WHERE ${clause}`, params);
  const [rows] = await pool.query(
    `SELECT p.id, p.slug, p.name, p.model_number, p.short_description, p.unit_price, p.gst_rate, p.stock_status, p.lead_time_days,
            p.warranty_months, p.installation_available, b.name AS brand_name, c.name AS category_name, c.slug AS category_slug,
            s.company_name, s.supplier_type, s.city AS supplier_city,
            (SELECT image_url FROM product_images WHERE product_id = p.id ORDER BY sort_order, id LIMIT 1) AS image_url
       ${FROM} WHERE ${clause} ORDER BY ${order} LIMIT ? OFFSET ?`,
    [...params, q.limit, (q.page - 1) * q.limit]
  );
  const minNeg = await settings.num('negotiation_min_unit_price', 5000);
  res.json({
    products: rows.map((r) => ({ ...r, negotiable: r.unit_price > minNeg })),
    total, page: q.page, pages: Math.max(1, Math.ceil(total / q.limit)),
  });
}));

market.get('/products/:slug', asyncHandler(async (req, res) => {
  const [[p]] = await pool.query(
    `SELECT p.*, b.name AS brand_name, c.name AS category_name, c.slug AS category_slug,
            s.id AS supplier_id, s.company_name, s.supplier_type, s.city AS supplier_city, s.state AS supplier_state
       ${FROM} WHERE p.slug = ? AND ${LIVE}`,
    [String(req.params.slug)]
  );
  if (!p) throw new ApiError(404, 'Product not found');
  const [images] = await pool.query('SELECT image_url FROM product_images WHERE product_id = ? ORDER BY sort_order, id', [p.id]);
  const [documents] = await pool.query('SELECT document_type, file_url FROM product_documents WHERE product_id = ?', [p.id]);
  const [service] = await pool.query('SELECT DISTINCT state FROM supplier_service_locations WHERE supplier_id = ?', [p.supplier_id]);
  const minNeg = await settings.num('negotiation_min_unit_price', 5000);
  res.json({
    product: {
      ...p, images: images.map((i) => i.image_url), documents, service_states: service.map((s) => s.state),
      negotiable: p.unit_price > minNeg, negotiation_min_unit_price: minNeg,
    },
  });
}));

module.exports = { supplier, market };

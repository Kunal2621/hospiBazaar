'use strict';

const express = require('express');
const { pool, withTransaction } = require('../db');
const { z, str, optionalStr, pincode } = require('../utils/validation');
const { ApiError, asyncHandler } = require('../utils/errors');
const { audit } = require('../utils/audit');
const { priceLines, round2 } = require('../services/money');
const settings = require('../services/settings');
const notify = require('../services/notify');
const orders = require('../services/orders');
const { authenticate } = require('../middleware/auth');
const { hospitalMember, hospitalBuyer, verifiedHospital, supplierMember, verifiedSupplier, idParam } = require('../middleware/guards');

const optInt = (max) => z.preprocess((v) => (v === '' || v == null ? undefined : v), z.coerce.number().int().min(0).max(max).optional());
const optNum = (max) => z.preprocess((v) => (v === '' || v == null ? undefined : v), z.coerce.number().min(0).max(max).optional());
const pad = (id) => String(id).padStart(6, '0');

const rfqSchema = z.object({
  title: str(250),
  delivery_address: str(500),
  delivery_city: str(100),
  delivery_state: str(100),
  delivery_pincode: pincode,
  required_within_days: optInt(730),
  warranty_years_required: optNum(20),
  installation_required: z.boolean().default(false),
  notes: optionalStr(4000),
  quotes_due_days: optInt(90),
  items: z.array(z.object({
    category_id: z.coerce.number().int().positive(),
    product_id: z.preprocess((v) => (v === '' || v == null ? undefined : v), z.coerce.number().int().positive().optional()),
    item_name: str(250),
    quantity: z.coerce.number().int().min(1).max(100000),
    specifications: optionalStr(4000),
  })).min(1, 'Add at least one item').max(30),
});

/** Turn an accepted quotation into an order and close out the RFQ. Used by the hospital and by admin manual orders. */
async function awardQuotation(conn, rfq, quotation, { placedBy, createdVia = 'online', manualRequestId = null, status } = {}) {
  const [items] = await conn.query(
    `SELECT qi.*, ri.item_name FROM quotation_items qi JOIN rfq_items ri ON ri.id = qi.rfq_item_id WHERE qi.quotation_id = ?`,
    [quotation.id]
  );
  const order = await orders.createOrder(conn, {
    hospitalId: rfq.hospital_id, supplierId: quotation.supplier_id, placedBy, source: 'rfq', createdVia,
    rfqId: rfq.id, quotationId: quotation.id, manualRequestId, status,
    items: items.map((i) => ({
      product_id: i.product_id, item_name: i.item_name, model_number: i.brand_model, quantity: i.quantity,
      unit_price: i.unit_price, gst_rate: i.gst_rate, warranty_months: quotation.warranty_months,
    })),
    freight: quotation.freight_charge, installation: quotation.installation_charge, service: quotation.service_charge,
    installationRequired: rfq.installation_required, paymentTerms: quotation.payment_terms,
    delivery: { address: rfq.delivery_address || 'See RFQ', city: rfq.delivery_city, state: rfq.delivery_state, pincode: rfq.delivery_pincode },
  });

  await conn.query(`UPDATE rfqs SET status = 'awarded', awarded_quotation_id = ? WHERE id = ?`, [quotation.id, rfq.id]);
  await conn.query(`UPDATE quotations SET status = 'accepted' WHERE id = ?`, [quotation.id]);
  const [others] = await conn.query(`SELECT id, supplier_id FROM quotations WHERE rfq_id = ? AND id <> ? AND status = 'submitted'`, [rfq.id, quotation.id]);
  for (const o of others) {
    await conn.query(`UPDATE quotations SET status = 'rejected' WHERE id = ?`, [o.id]);
    await notify.toSupplier(conn, o.supplier_id, { event: 'quotation_not_selected', title: `${rfq.rfq_number}: another supplier was selected`, entityType: 'rfq', entityId: rfq.id });
  }
  await audit(conn, { actorId: placedBy, action: 'rfq.awarded', entityType: 'rfq', entityId: rfq.id, newValues: { quotation_id: quotation.id, order_id: order.id } });
  return order;
}

// ------------------------------------------------------------------ Hospital side

const hospital = express.Router();
hospital.use(authenticate, hospitalMember);

hospital.post('/', hospitalBuyer, asyncHandler(async (req, res) => {
  const d = rfqSchema.parse(req.body);
  const days = d.quotes_due_days || await settings.num('rfq_default_quote_days', 7);

  const result = await withTransaction(async (conn) => {
    const catIds = [...new Set(d.items.map((i) => i.category_id))];
    const [cats] = await conn.query('SELECT id FROM categories WHERE id IN (?) AND is_active = 1 AND parent_id IS NOT NULL', [catIds]);
    if (cats.length !== catIds.length) throw new ApiError(400, 'One or more categories are invalid');

    const [r] = await conn.query(
      `INSERT INTO rfqs (hospital_id, created_by, title, delivery_address, delivery_city, delivery_state, delivery_pincode,
         required_within_days, warranty_years_required, installation_required, notes, quotes_due_by, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? DAY), 'open')`,
      [req.user.hospitalId, req.user.id, d.title, d.delivery_address, d.delivery_city, d.delivery_state, d.delivery_pincode,
        d.required_within_days ?? null, d.warranty_years_required ?? null, d.installation_required ? 1 : 0, d.notes ?? null, days]
    );
    const rfqId = r.insertId;
    const number = `HB-RFQ-${pad(rfqId)}`;
    await conn.query('UPDATE rfqs SET rfq_number = ? WHERE id = ?', [number, rfqId]);

    const productIds = [];
    for (const it of d.items) {
      await conn.query(
        'INSERT INTO rfq_items (rfq_id, category_id, product_id, item_name, quantity, specifications) VALUES (?, ?, ?, ?, ?, ?)',
        [rfqId, it.category_id, it.product_id ?? null, it.item_name, it.quantity, it.specifications ?? null]
      );
      if (it.product_id) productIds.push(it.product_id);
    }

    // Recipients: verified suppliers registered for any requested category, plus suppliers of any chosen product.
    const [rows] = await conn.query(
      `SELECT DISTINCT s.id FROM suppliers s
         JOIN supplier_verification sv ON sv.supplier_id = s.id AND sv.verification_status = 'verified'
         JOIN supplier_categories sc ON sc.supplier_id = s.id
        WHERE s.account_status = 'active' AND sc.category_id IN (?)`,
      [catIds]
    );
    const ids = new Set(rows.map((x) => x.id));
    if (productIds.length) {
      const [ps] = await conn.query(`SELECT DISTINCT supplier_id FROM products WHERE id IN (?) AND status = 'approved'`, [productIds]);
      ps.forEach((p) => ids.add(p.supplier_id));
    }
    for (const sid of ids) {
      await conn.query('INSERT INTO rfq_recipients (rfq_id, supplier_id) VALUES (?, ?)', [rfqId, sid]);
      await notify.toSupplier(conn, sid, { event: 'rfq_received', title: `New RFQ ${number}: ${d.title}`, body: `Deliver to ${d.delivery_city}. Send your quotation.`, entityType: 'rfq', entityId: rfqId });
    }
    await audit(conn, { actorId: req.user.id, action: 'rfq.created', entityType: 'rfq', entityId: rfqId, newValues: { recipients: ids.size }, ip: req.ip });
    return { id: rfqId, rfq_number: number, recipients: ids.size };
  });
  res.status(201).json(result);
}));

hospital.get('/', asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT r.id, r.rfq_number, r.title, r.status, r.delivery_city, r.quotes_due_by, r.created_at,
            (SELECT COUNT(*) FROM rfq_items WHERE rfq_id = r.id) AS item_count,
            (SELECT COUNT(*) FROM rfq_recipients WHERE rfq_id = r.id) AS recipient_count,
            (SELECT COUNT(*) FROM quotations WHERE rfq_id = r.id AND status IN ('submitted','accepted')) AS quotation_count
       FROM rfqs r WHERE r.hospital_id = ? ORDER BY r.id DESC LIMIT 200`,
    [req.user.hospitalId]
  );
  res.json({ rfqs: rows });
}));

hospital.get('/:id', asyncHandler(async (req, res) => {
  const id = idParam(req);
  const [[rfq]] = await pool.query('SELECT * FROM rfqs WHERE id = ? AND hospital_id = ?', [id, req.user.hospitalId]);
  if (!rfq) throw new ApiError(404, 'RFQ not found');
  const [items] = await pool.query(
    `SELECT ri.*, c.name AS category_name FROM rfq_items ri JOIN categories c ON c.id = ri.category_id WHERE ri.rfq_id = ? ORDER BY ri.id`, [id]);
  const [[rc]] = await pool.query(
    `SELECT COUNT(*) AS sent, SUM(status IN ('viewed','quoted')) AS viewed, SUM(status = 'quoted') AS quoted, SUM(status = 'declined') AS declined
       FROM rfq_recipients WHERE rfq_id = ?`, [id]);
  const [quotations] = await pool.query(
    `SELECT q.*, s.company_name, s.supplier_type, s.city AS supplier_city, s.state AS supplier_state
       FROM quotations q JOIN suppliers s ON s.id = q.supplier_id
      WHERE q.rfq_id = ? AND q.status <> 'withdrawn' ORDER BY q.total_amount ASC`, [id]);
  for (const q of quotations) {
    const [qi] = await pool.query('SELECT * FROM quotation_items WHERE quotation_id = ?', [q.id]);
    q.items = qi;
    q.expired = q.status === 'submitted' && new Date(q.valid_until) < new Date(new Date().toDateString());
  }
  const [[order]] = await pool.query('SELECT id, order_number, status FROM orders WHERE rfq_id = ? AND status <> \'cancelled\' LIMIT 1', [id]);
  const [[manual]] = await pool.query(`SELECT id, status FROM manual_order_requests WHERE rfq_id = ? AND status IN ('new','contacted') LIMIT 1`, [id]);
  res.json({
    rfq, items, recipients: { sent: rc.sent, viewed: Number(rc.viewed || 0), quoted: Number(rc.quoted || 0), declined: Number(rc.declined || 0) },
    quotations, order: order || null, manual_request: manual || null, online_order_cap: await settings.num('online_order_cap', 500000),
  });
}));

hospital.post('/:id/cancel', hospitalBuyer, asyncHandler(async (req, res) => {
  await withTransaction(async (conn) => {
    const [[rfq]] = await conn.query('SELECT * FROM rfqs WHERE id = ? AND hospital_id = ? FOR UPDATE', [idParam(req), req.user.hospitalId]);
    if (!rfq) throw new ApiError(404, 'RFQ not found');
    if (!['open', 'quotes_received'].includes(rfq.status)) throw new ApiError(409, 'This RFQ can no longer be cancelled');
    await conn.query(`UPDATE rfqs SET status = 'cancelled' WHERE id = ?`, [rfq.id]);
    const [recips] = await conn.query('SELECT supplier_id FROM rfq_recipients WHERE rfq_id = ?', [rfq.id]);
    for (const r of recips) await notify.toSupplier(conn, r.supplier_id, { event: 'rfq_cancelled', title: `${rfq.rfq_number} was cancelled`, entityType: 'rfq', entityId: rfq.id });
    await audit(conn, { actorId: req.user.id, action: 'rfq.cancelled', entityType: 'rfq', entityId: rfq.id, ip: req.ip });
  });
  res.json({ status: 'cancelled' });
}));

// Accept a quotation: becomes an order, or a manual-order request when above the online cap (decision 2).
hospital.post('/:id/accept', hospitalBuyer, verifiedHospital, asyncHandler(async (req, res) => {
  const { quotation_id } = z.object({ quotation_id: z.coerce.number().int().positive() }).parse(req.body);
  const cap = await settings.num('online_order_cap', 500000);

  const out = await withTransaction(async (conn) => {
    const [[rfq]] = await conn.query('SELECT * FROM rfqs WHERE id = ? AND hospital_id = ? FOR UPDATE', [idParam(req), req.user.hospitalId]);
    if (!rfq) throw new ApiError(404, 'RFQ not found');
    if (!['open', 'quotes_received'].includes(rfq.status)) throw new ApiError(409, 'This RFQ is no longer open');
    const [[q]] = await conn.query('SELECT * FROM quotations WHERE id = ? AND rfq_id = ? FOR UPDATE', [quotation_id, rfq.id]);
    if (!q || q.status !== 'submitted') throw new ApiError(409, 'This quotation is not available');
    if (new Date(q.valid_until) < new Date(new Date().toDateString())) throw new ApiError(409, 'This quotation has expired. Ask the supplier to send a new one.');

    if (q.total_amount > cap) {
      const [[dup]] = await conn.query(`SELECT id FROM manual_order_requests WHERE rfq_id = ? AND status IN ('new','contacted')`, [rfq.id]);
      if (dup) throw new ApiError(409, 'Our team is already working on this request');
      const [r] = await conn.query(
        `INSERT INTO manual_order_requests (hospital_id, requested_by, source, rfq_id, quotation_id, total_amount) VALUES (?, ?, 'rfq', ?, ?, ?)`,
        [req.user.hospitalId, req.user.id, rfq.id, q.id, q.total_amount]
      );
      await notify.toAdmins(conn, { event: 'manual_order_request', title: `Manual order request for ${rfq.rfq_number}`, body: `Quotation total above the online limit.`, entityType: 'manual_order_request', entityId: r.insertId }, ['super_admin', 'support']);
      await audit(conn, { actorId: req.user.id, action: 'manual_order.requested', entityType: 'manual_order_request', entityId: r.insertId, ip: req.ip });
      return { manual: true, manual_request_id: r.insertId, message: await settings.get('online_cap_message') };
    }
    const order = await awardQuotation(conn, rfq, q, { placedBy: req.user.id });
    return { manual: false, order };
  });
  res.status(out.manual ? 202 : 201).json(out);
}));

// ------------------------------------------------------------------ Supplier side

const supplier = express.Router();
supplier.use(authenticate, supplierMember);

const quoteSchema = z.object({
  freight_charge: z.coerce.number().min(0).max(1e9).default(0),
  installation_charge: z.coerce.number().min(0).max(1e9).default(0),
  service_charge: z.coerce.number().min(0).max(1e9).default(0),
  warranty_months: optInt(240),
  service_terms: optionalStr(4000),
  delivery_days: z.coerce.number().int().min(1).max(730),
  payment_terms: optionalStr(500),
  valid_until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date'),
  notes: optionalStr(4000),
  items: z.array(z.object({
    rfq_item_id: z.coerce.number().int().positive(),
    product_id: z.preprocess((v) => (v === '' || v == null ? undefined : v), z.coerce.number().int().positive().optional()),
    brand_model: optionalStr(250),
    unit_price: z.coerce.number().positive('Enter a price above zero').max(1e9),
    gst_rate: z.coerce.number().min(0).max(40),
  })).min(1),
});

async function recipientOr404(conn, rfqId, supplierId) {
  const [[row]] = await conn.query(
    `SELECT rr.status AS my_status, r.* FROM rfq_recipients rr JOIN rfqs r ON r.id = rr.rfq_id WHERE rr.rfq_id = ? AND rr.supplier_id = ?`, [rfqId, supplierId]);
  if (!row) throw new ApiError(404, 'RFQ not found');
  return row;
}

supplier.get('/', asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT r.id, r.rfq_number, r.title, r.status, r.delivery_city, r.delivery_state, r.quotes_due_by, r.required_within_days, r.created_at,
            h.hospital_name, rr.status AS my_status, q.id AS quotation_id, q.status AS quotation_status, q.total_amount,
            (SELECT COUNT(*) FROM rfq_items WHERE rfq_id = r.id) AS item_count
       FROM rfq_recipients rr JOIN rfqs r ON r.id = rr.rfq_id JOIN hospitals h ON h.id = r.hospital_id
       LEFT JOIN quotations q ON q.rfq_id = r.id AND q.supplier_id = rr.supplier_id
      WHERE rr.supplier_id = ? ORDER BY r.id DESC LIMIT 200`,
    [req.user.supplierId]
  );
  res.json({ rfqs: rows });
}));

supplier.get('/:id', asyncHandler(async (req, res) => {
  const id = idParam(req);
  const row = await recipientOr404(pool, id, req.user.supplierId);
  if (row.my_status === 'sent') await pool.query(`UPDATE rfq_recipients SET status = 'viewed' WHERE rfq_id = ? AND supplier_id = ?`, [id, req.user.supplierId]);
  const [[h]] = await pool.query('SELECT hospital_name, hospital_type FROM hospitals WHERE id = ?', [row.hospital_id]);
  const [items] = await pool.query(`SELECT ri.*, c.name AS category_name FROM rfq_items ri JOIN categories c ON c.id = ri.category_id WHERE ri.rfq_id = ? ORDER BY ri.id`, [id]);
  const [[q]] = await pool.query('SELECT * FROM quotations WHERE rfq_id = ? AND supplier_id = ?', [id, req.user.supplierId]);
  if (q) [q.items] = await pool.query('SELECT * FROM quotation_items WHERE quotation_id = ?', [q.id]);
  const { hospital_id, created_by, ...rfq } = row;
  res.json({ rfq: { ...rfq, hospital_name: h.hospital_name, hospital_type: h.hospital_type }, items, quotation: q || null });
}));

supplier.post('/:id/quote', verifiedSupplier, asyncHandler(async (req, res) => {
  const d = quoteSchema.parse(req.body);
  const out = await withTransaction(async (conn) => {
    const rfqId = idParam(req);
    const rfq = await recipientOr404(conn, rfqId, req.user.supplierId);
    if (!['open', 'quotes_received'].includes(rfq.status)) throw new ApiError(409, 'This RFQ is no longer open for quotations');
    if (rfq.quotes_due_by && new Date(rfq.quotes_due_by) < new Date()) throw new ApiError(409, 'The deadline for quotations has passed');
    if (new Date(d.valid_until) < new Date(new Date().toDateString())) throw new ApiError(400, 'Valid-until date cannot be in the past');

    const [rfqItems] = await conn.query('SELECT id, quantity FROM rfq_items WHERE rfq_id = ?', [rfqId]);
    const byId = new Map(rfqItems.map((i) => [i.id, i.quantity]));
    const priced = new Set(d.items.map((i) => i.rfq_item_id));
    if (priced.size !== d.items.length || d.items.some((i) => !byId.has(i.rfq_item_id)) || priced.size !== rfqItems.length) {
      throw new ApiError(400, 'Give a price for every item in the RFQ');
    }
    const { lines, subtotal, gst_total } = priceLines(d.items.map((i) => ({ ...i, quantity: byId.get(i.rfq_item_id) })));
    const total = round2(subtotal + gst_total + d.freight_charge + d.installation_charge + d.service_charge);

    const [[existing]] = await conn.query('SELECT id, status FROM quotations WHERE rfq_id = ? AND supplier_id = ? FOR UPDATE', [rfqId, req.user.supplierId]);
    if (existing && ['accepted', 'rejected'].includes(existing.status)) throw new ApiError(409, 'This quotation has already been decided');

    const vals = [d.freight_charge, d.installation_charge, d.service_charge, d.warranty_months ?? null, d.service_terms ?? null, d.delivery_days,
      d.payment_terms ?? null, d.valid_until, d.notes ?? null, subtotal, gst_total, total];
    let qid;
    if (existing) {
      qid = existing.id;
      await conn.query(
        `UPDATE quotations SET freight_charge=?, installation_charge=?, service_charge=?, warranty_months=?, service_terms=?, delivery_days=?,
           payment_terms=?, valid_until=?, notes=?, subtotal=?, gst_total=?, total_amount=?, status='submitted', submitted_by=?, submitted_at=NOW() WHERE id=?`,
        [...vals, req.user.id, qid]
      );
      await conn.query('DELETE FROM quotation_items WHERE quotation_id = ?', [qid]);
    } else {
      const [r] = await conn.query(
        `INSERT INTO quotations (rfq_id, supplier_id, submitted_by, freight_charge, installation_charge, service_charge, warranty_months, service_terms,
           delivery_days, payment_terms, valid_until, notes, subtotal, gst_total, total_amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [rfqId, req.user.supplierId, req.user.id, ...vals]
      );
      qid = r.insertId;
    }
    for (const l of lines) {
      await conn.query(
        `INSERT INTO quotation_items (quotation_id, rfq_item_id, product_id, brand_model, quantity, unit_price, gst_rate, line_subtotal, line_gst)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [qid, l.rfq_item_id, l.product_id ?? null, l.brand_model ?? null, l.quantity, l.unit_price, l.gst_rate, l.line_subtotal, l.line_gst]
      );
    }
    await conn.query(`UPDATE rfq_recipients SET status = 'quoted', responded_at = NOW() WHERE rfq_id = ? AND supplier_id = ?`, [rfqId, req.user.supplierId]);
    await conn.query(`UPDATE rfqs SET status = 'quotes_received' WHERE id = ? AND status = 'open'`, [rfqId]);
    const [[s]] = await conn.query('SELECT company_name FROM suppliers WHERE id = ?', [req.user.supplierId]);
    await notify.toHospital(conn, rfq.hospital_id, { event: 'quotation_received', title: `New quotation for ${rfq.rfq_number}`, body: `${s.company_name} sent a quotation.`, entityType: 'rfq', entityId: rfqId });
    await audit(conn, { actorId: req.user.id, action: existing ? 'quotation.updated' : 'quotation.submitted', entityType: 'quotation', entityId: qid, newValues: { total }, ip: req.ip });
    return { id: qid, total_amount: total };
  });
  res.status(201).json(out);
}));

supplier.post('/:id/decline', asyncHandler(async (req, res) => {
  await withTransaction(async (conn) => {
    const rfqId = idParam(req);
    await recipientOr404(conn, rfqId, req.user.supplierId);
    const [[q]] = await conn.query(`SELECT id FROM quotations WHERE rfq_id = ? AND supplier_id = ? AND status IN ('submitted','accepted')`, [rfqId, req.user.supplierId]);
    if (q) throw new ApiError(409, 'Withdraw your quotation before declining');
    await conn.query(`UPDATE rfq_recipients SET status = 'declined', responded_at = NOW() WHERE rfq_id = ? AND supplier_id = ?`, [rfqId, req.user.supplierId]);
  });
  res.json({ status: 'declined' });
}));

supplier.post('/:id/withdraw', asyncHandler(async (req, res) => {
  await withTransaction(async (conn) => {
    const rfqId = idParam(req);
    const [[q]] = await conn.query(`SELECT id, status FROM quotations WHERE rfq_id = ? AND supplier_id = ? FOR UPDATE`, [rfqId, req.user.supplierId]);
    if (!q || q.status !== 'submitted') throw new ApiError(409, 'There is no open quotation to withdraw');
    await conn.query(`UPDATE quotations SET status = 'withdrawn' WHERE id = ?`, [q.id]);
    await conn.query(`UPDATE rfq_recipients SET status = 'viewed' WHERE rfq_id = ? AND supplier_id = ?`, [rfqId, req.user.supplierId]);
  });
  res.json({ status: 'withdrawn' });
}));

module.exports = { hospital, supplier, awardQuotation };

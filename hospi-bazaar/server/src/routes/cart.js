'use strict';

// Cart and checkout (spec sections 17 and 18).
//  - A negotiated item enters the cart at its agreed price, held for price_lock_hours (decision 5).
//    After that it reverts to the current listed price.
//  - A cart above online_order_cap cannot be paid online. It becomes a manual-order request (decision 2).
const express = require('express');
const { pool, withTransaction } = require('../db');
const { z, str, pincode } = require('../utils/validation');
const { ApiError, asyncHandler } = require('../utils/errors');
const { audit } = require('../utils/audit');
const { priceLines, round2 } = require('../services/money');
const settings = require('../services/settings');
const notify = require('../services/notify');
const orders = require('../services/orders');
const { authenticate } = require('../middleware/auth');
const { hospitalMember, hospitalBuyer, verifiedHospital, idParam } = require('../middleware/guards');

const router = express.Router();
router.use(authenticate, hospitalMember);

const LIVE = `p.status = 'approved' AND s.account_status = 'active' AND sv.verification_status = 'verified'`;

async function cartId(conn, req) {
  await conn.query('INSERT IGNORE INTO carts (hospital_id, user_id) VALUES (?, ?)', [req.user.hospitalId, req.user.id]);
  const [[c]] = await conn.query('SELECT id FROM carts WHERE hospital_id = ? AND user_id = ?', [req.user.hospitalId, req.user.id]);
  return c.id;
}

/** Lines in the cart, with expired price locks reverted to the listed price. */
async function loadLines(conn, cid, { lock = false } = {}) {
  const [rows] = await conn.query(
    `SELECT ci.id, ci.product_id, ci.quantity, ci.unit_price, ci.negotiation_id, ci.price_locked_until,
            p.name, p.slug, p.model_number, p.unit_price AS listed_price, p.gst_rate, p.min_order_qty, p.warranty_months,
            p.supplier_id, s.company_name AS supplier_name, (${LIVE}) AS available,
            (SELECT image_url FROM product_images WHERE product_id = p.id ORDER BY sort_order, id LIMIT 1) AS image_url
       FROM cart_items ci JOIN products p ON p.id = ci.product_id JOIN suppliers s ON s.id = p.supplier_id
       JOIN supplier_verification sv ON sv.supplier_id = s.id
      WHERE ci.cart_id = ? ORDER BY ci.id ${lock ? 'FOR UPDATE' : ''}`,
    [cid]
  );
  const reverted = [];
  for (const r of rows) {
    if (r.negotiation_id && r.price_locked_until && new Date(r.price_locked_until) < new Date()) {
      await conn.query('UPDATE cart_items SET unit_price = ?, price_locked_until = NULL WHERE id = ?', [r.listed_price, r.id]);
      reverted.push(r.id);
      r.unit_price = r.listed_price; r.price_locked_until = null;
    }
  }
  return { rows, reverted };
}

function totals(rows) {
  const { lines, subtotal, gst_total } = priceLines(rows.map((r) => ({ ...r, quantity: r.quantity, unit_price: r.unit_price, gst_rate: r.gst_rate })));
  return { lines, subtotal, gst_total, total: round2(subtotal + gst_total) };
}

router.get('/', asyncHandler(async (req, res) => {
  const cid = await cartId(pool, req);
  const { rows, reverted } = await loadLines(pool, cid);
  const t = totals(rows);
  const cap = await settings.num('online_order_cap', 500000);
  res.json({
    items: rows.map((r, i) => ({ ...r, available: Boolean(r.available), line_subtotal: t.lines[i].line_subtotal, line_gst: t.lines[i].line_gst, price_reverted: reverted.includes(r.id) })),
    subtotal: t.subtotal, gst_total: t.gst_total, total: t.total,
    online_order_cap: cap, over_cap: t.total > cap, cap_message: await settings.get('online_cap_message'),
  });
}));

router.post('/items', hospitalBuyer, asyncHandler(async (req, res) => {
  const d = z.object({ product_id: z.coerce.number().int().positive(), quantity: z.coerce.number().int().min(1).max(100000) }).parse(req.body);
  await withTransaction(async (conn) => {
    const [[p]] = await conn.query(
      `SELECT p.* FROM products p JOIN suppliers s ON s.id = p.supplier_id JOIN supplier_verification sv ON sv.supplier_id = s.id WHERE p.id = ? AND ${LIVE}`, [d.product_id]);
    if (!p) throw new ApiError(404, 'Product not found');
    if (p.stock_status === 'out_of_stock') throw new ApiError(409, 'This item is out of stock');
    const cid = await cartId(conn, req);
    const [[line]] = await conn.query('SELECT id, quantity FROM cart_items WHERE cart_id = ? AND product_id = ? AND negotiation_id IS NULL FOR UPDATE', [cid, p.id]);
    const qty = (line?.quantity || 0) + d.quantity;
    if (qty < p.min_order_qty) throw new ApiError(400, `The minimum order quantity is ${p.min_order_qty}`);
    if (line) await conn.query('UPDATE cart_items SET quantity = ?, unit_price = ? WHERE id = ?', [qty, p.unit_price, line.id]);
    else await conn.query('INSERT INTO cart_items (cart_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?)', [cid, p.id, qty, p.unit_price]);
  });
  res.status(201).json({ ok: true });
}));

// Put a negotiated item in the cart at its agreed price.
router.post('/items/negotiated', hospitalBuyer, asyncHandler(async (req, res) => {
  const { negotiation_id } = z.object({ negotiation_id: z.coerce.number().int().positive() }).parse(req.body);
  const lockHours = await settings.num('price_lock_hours', 72);
  await withTransaction(async (conn) => {
    const [[n]] = await conn.query('SELECT * FROM negotiations WHERE negotiation_id = ? AND buyer_id = ? FOR UPDATE', [negotiation_id, req.user.hospitalId]);
    if (!n) throw new ApiError(404, 'Negotiation not found');
    if (n.status !== 'agreed') throw new ApiError(409, 'This negotiation has no agreed price');
    const lockEnds = new Date(new Date(n.closed_at).getTime() + lockHours * 3600e3);
    if (lockEnds < new Date()) throw new ApiError(409, 'The agreed price has expired. Start a new negotiation.');
    const [[used]] = await conn.query('SELECT (SELECT COUNT(*) FROM order_items WHERE negotiation_id = ?) + (SELECT COUNT(*) FROM cart_items WHERE negotiation_id = ?) AS n', [negotiation_id, negotiation_id]);
    if (used.n > 0) throw new ApiError(409, 'This agreed price is already in a cart or order');
    const [[p]] = await conn.query(
      `SELECT p.* FROM products p JOIN suppliers s ON s.id = p.supplier_id JOIN supplier_verification sv ON sv.supplier_id = s.id WHERE p.id = ? AND ${LIVE}`, [n.product_id]);
    if (!p) throw new ApiError(409, 'This product is no longer available');
    const cid = await cartId(conn, req);
    // If the listed price has dropped below the agreed price, the buyer gets the lower one.
    await conn.query(
      'INSERT INTO cart_items (cart_id, product_id, quantity, unit_price, negotiation_id, price_locked_until) VALUES (?, ?, ?, ?, ?, ?)',
      [cid, p.id, n.quantity, Math.min(n.agreed_price, p.unit_price), n.negotiation_id, lockEnds]
    );
  });
  res.status(201).json({ ok: true });
}));

router.patch('/items/:id', hospitalBuyer, asyncHandler(async (req, res) => {
  const { quantity } = z.object({ quantity: z.coerce.number().int().min(1).max(100000) }).parse(req.body);
  const cid = await cartId(pool, req);
  const [[line]] = await pool.query('SELECT ci.id, ci.negotiation_id, p.min_order_qty FROM cart_items ci JOIN products p ON p.id = ci.product_id WHERE ci.id = ? AND ci.cart_id = ?', [idParam(req), cid]);
  if (!line) throw new ApiError(404, 'Item not found');
  if (line.negotiation_id) throw new ApiError(409, 'The quantity is fixed for a negotiated price. Remove the item and negotiate again to change it.');
  if (quantity < line.min_order_qty) throw new ApiError(400, `The minimum order quantity is ${line.min_order_qty}`);
  await pool.query('UPDATE cart_items SET quantity = ? WHERE id = ?', [quantity, line.id]);
  res.json({ ok: true });
}));

router.delete('/items/:id', hospitalBuyer, asyncHandler(async (req, res) => {
  const cid = await cartId(pool, req);
  await pool.query('DELETE FROM cart_items WHERE id = ? AND cart_id = ?', [idParam(req), cid]);
  res.json({ ok: true });
}));

const checkoutSchema = z.object({
  delivery_address: str(500), delivery_city: str(100), delivery_state: str(100), delivery_pincode: pincode,
  installation_required: z.boolean().default(false),
});

router.post('/checkout', hospitalBuyer, verifiedHospital, asyncHandler(async (req, res) => {
  const d = checkoutSchema.parse(req.body);
  const cap = await settings.num('online_order_cap', 500000);
  const delivery = { address: d.delivery_address, city: d.delivery_city, state: d.delivery_state, pincode: d.delivery_pincode };

  const out = await withTransaction(async (conn) => {
    const cid = await cartId(conn, req);
    const { rows } = await loadLines(conn, cid, { lock: true });
    if (!rows.length) throw new ApiError(400, 'Your cart is empty');
    for (const r of rows) {
      if (!r.available) throw new ApiError(409, `${r.name} is no longer available. Remove it to continue.`);
      if (r.quantity < r.min_order_qty) throw new ApiError(409, `${r.name}: the minimum order quantity is ${r.min_order_qty}`);
      if (r.negotiation_id) {
        const [[used]] = await conn.query('SELECT COUNT(*) AS n FROM order_items WHERE negotiation_id = ?', [r.negotiation_id]);
        if (used.n > 0) throw new ApiError(409, `The agreed price for ${r.name} was already used. Remove it to continue.`);
      }
    }
    const t = totals(rows);

    if (t.total > cap) {
      const snapshot = {
        delivery, installation_required: d.installation_required,
        items: rows.map((r) => ({ product_id: r.product_id, name: r.name, model_number: r.model_number, supplier_id: r.supplier_id, supplier_name: r.supplier_name,
          quantity: r.quantity, unit_price: r.unit_price, gst_rate: r.gst_rate, warranty_months: r.warranty_months, negotiation_id: r.negotiation_id })),
      };
      const [r] = await conn.query(
        `INSERT INTO manual_order_requests (hospital_id, requested_by, source, cart_snapshot, total_amount) VALUES (?, ?, 'cart', ?, ?)`,
        [req.user.hospitalId, req.user.id, JSON.stringify(snapshot), t.total]
      );
      await conn.query('DELETE FROM cart_items WHERE cart_id = ?', [cid]);
      await notify.toAdmins(conn, { event: 'manual_order_request', title: 'Manual order request from a cart', body: `Total ₹${t.total.toLocaleString('en-IN')} is above the online limit.`, entityType: 'manual_order_request', entityId: r.insertId }, ['super_admin', 'support']);
      await audit(conn, { actorId: req.user.id, action: 'manual_order.requested', entityType: 'manual_order_request', entityId: r.insertId, ip: req.ip });
      return { manual: true, manual_request_id: r.insertId, message: await settings.get('online_cap_message') };
    }

    const bySupplier = new Map();
    for (const r of rows) {
      if (!bySupplier.has(r.supplier_id)) bySupplier.set(r.supplier_id, []);
      bySupplier.get(r.supplier_id).push(r);
    }
    const created = [];
    for (const [supplierId, items] of bySupplier) {
      created.push(await orders.createOrder(conn, {
        hospitalId: req.user.hospitalId, supplierId, placedBy: req.user.id, source: 'cart', delivery, installationRequired: d.installation_required,
        items: items.map((r) => ({ product_id: r.product_id, negotiation_id: r.negotiation_id, item_name: r.name, model_number: r.model_number,
          quantity: r.quantity, unit_price: r.unit_price, gst_rate: r.gst_rate, warranty_months: r.warranty_months })),
      }));
    }
    await conn.query('DELETE FROM cart_items WHERE cart_id = ?', [cid]);
    return { manual: false, orders: created };
  });
  res.status(out.manual ? 202 : 201).json(out);
}));

module.exports = router;

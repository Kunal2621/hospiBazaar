'use strict';

// Admin operations beyond verification: product approval, manual orders, offline payments,
// payouts, disputes, platform settings and headline numbers. Mounted before routes/admin.js.
const express = require('express');
const { pool, withTransaction } = require('../db');
const { z, str, optionalStr, pincode } = require('../utils/validation');
const { ApiError, asyncHandler } = require('../utils/errors');
const { audit } = require('../utils/audit');
const settings = require('../services/settings');
const notify = require('../services/notify');
const orders = require('../services/orders');
const payments = require('../services/payments');
const { round2 } = require('../services/money');
const { awardQuotation } = require('./rfqs');
const { authenticate, requireType, requireAdminRole } = require('../middleware/auth');
const { idParam } = require('../middleware/guards');

const router = express.Router();
router.use(authenticate, requireType('admin'));

const ops = requireAdminRole('support');
const catalog = requireAdminRole('catalog_manager');

// ------------------------------------------------------------------ Products

router.get('/products', catalog, asyncHandler(async (req, res) => {
  const status = String(req.query.status || 'pending_approval');
  const [rows] = await pool.query(
    `SELECT p.id, p.name, b.name AS brand, p.model_number, p.unit_price, p.status, p.created_at, p.rejection_reason, s.company_name, c.name AS category
       FROM products p JOIN suppliers s ON s.id = p.supplier_id JOIN categories c ON c.id = p.category_id LEFT JOIN brands b ON b.id = p.brand_id
      WHERE p.status = ? ORDER BY p.updated_at DESC LIMIT 200`, [status]);
  res.json({ products: rows });
}));

router.get('/products/:id', catalog, asyncHandler(async (req, res) => {
  const [[p]] = await pool.query(
    `SELECT p.*, s.company_name, c.name AS category FROM products p JOIN suppliers s ON s.id = p.supplier_id
       JOIN categories c ON c.id = p.category_id WHERE p.id = ?`, [idParam(req)]);
  if (!p) throw new ApiError(404, 'Product not found');
  const [images] = await pool.query('SELECT image_url FROM product_images WHERE product_id = ? ORDER BY sort_order, id', [p.id]);
  const [documents] = await pool.query('SELECT * FROM product_documents WHERE product_id = ?', [p.id]);
  res.json({ product: p, images, documents });
}));

router.post('/products/:id/approve', catalog, asyncHandler(async (req, res) => {
  await withTransaction(async (conn) => {
    const [[p]] = await conn.query('SELECT * FROM products WHERE id = ? FOR UPDATE', [idParam(req)]);
    if (!p) throw new ApiError(404, 'Product not found');
    if (p.status !== 'pending_approval') throw new ApiError(409, 'This product is not waiting for approval');
    await conn.query(`UPDATE products SET status = 'approved', approved_by = ?, approved_at = NOW(), rejection_reason = NULL WHERE id = ?`, [req.user.id, p.id]);
    await notify.toSupplier(conn, p.supplier_id, { event: 'product_approved', title: `${p.name} is now live`, entityType: 'product', entityId: p.id });
    await audit(conn, { actorId: req.user.id, action: 'product.approved', entityType: 'product', entityId: p.id, ip: req.ip });
  });
  res.json({ status: 'approved' });
}));

router.post('/products/:id/reject', catalog, asyncHandler(async (req, res) => {
  const { reason } = z.object({ reason: z.string().trim().min(5, 'Tell the supplier what to fix').max(500) }).parse(req.body);
  await withTransaction(async (conn) => {
    const [[p]] = await conn.query('SELECT * FROM products WHERE id = ? FOR UPDATE', [idParam(req)]);
    if (!p) throw new ApiError(404, 'Product not found');
    if (p.status !== 'pending_approval') throw new ApiError(409, 'This product is not waiting for approval');
    await conn.query(`UPDATE products SET status = 'rejected', rejection_reason = ? WHERE id = ?`, [reason, p.id]);
    await notify.toSupplier(conn, p.supplier_id, { event: 'product_rejected', title: `${p.name} needs changes`, body: reason, entityType: 'product', entityId: p.id });
    await audit(conn, { actorId: req.user.id, action: 'product.rejected', entityType: 'product', entityId: p.id, newValues: { reason }, ip: req.ip });
  });
  res.json({ status: 'rejected' });
}));

// ------------------------------------------------------------------ Manual order requests and manual orders

router.get('/manual-requests', ops, asyncHandler(async (req, res) => {
  const status = req.query.status ? String(req.query.status) : null;
  const [rows] = await pool.query(
    `SELECT m.*, h.hospital_name, u.full_name AS requested_by_name, r.rfq_number
       FROM manual_order_requests m JOIN hospitals h ON h.id = m.hospital_id JOIN users u ON u.id = m.requested_by
       LEFT JOIN rfqs r ON r.id = m.rfq_id ${status ? 'WHERE m.status = ?' : ''} ORDER BY m.id DESC LIMIT 200`,
    status ? [status] : []);
  res.json({ requests: rows });
}));

router.patch('/manual-requests/:id', ops, asyncHandler(async (req, res) => {
  const d = z.object({ status: z.enum(['new', 'contacted', 'closed']).optional(), admin_notes: optionalStr(4000) }).parse(req.body);
  const [[m]] = await pool.query('SELECT status FROM manual_order_requests WHERE id = ?', [idParam(req)]);
  if (!m) throw new ApiError(404, 'Request not found');
  if (m.status === 'converted') throw new ApiError(409, 'This request already became an order');
  await pool.query('UPDATE manual_order_requests SET status = COALESCE(?, status), admin_notes = COALESCE(?, admin_notes), assigned_admin_id = ? WHERE id = ?',
    [d.status ?? null, d.admin_notes ?? null, req.user.id, idParam(req)]);
  res.json({ ok: true });
}));

const manualItem = z.object({
  product_id: z.coerce.number().int().positive().optional(),
  item_name: str(250), model_number: optionalStr(100),
  quantity: z.coerce.number().int().min(1).max(100000),
  unit_price: z.coerce.number().positive().max(1e9),
  gst_rate: z.coerce.number().min(0).max(40),
  warranty_months: z.coerce.number().int().min(0).max(240).optional(),
});
const manualOrderSchema = z.object({
  manual_request_id: z.coerce.number().int().positive().optional(),
  // Only needed for an order that does not come from a request.
  hospital_id: z.coerce.number().int().positive().optional(),
  supplier_id: z.coerce.number().int().positive().optional(),
  items: z.array(manualItem).min(1).optional(),
  delivery_address: optionalStr(500), delivery_city: optionalStr(100), delivery_state: optionalStr(100), delivery_pincode: z.preprocess((v) => (v === '' ? undefined : v), pincode.optional()),
  freight: z.coerce.number().min(0).default(0), installation: z.coerce.number().min(0).default(0), service: z.coerce.number().min(0).default(0),
  installation_required: z.boolean().optional(),
  payment_terms: optionalStr(500),
});

/** Create an order on behalf of a hospital. It skips supplier confirmation and waits for an offline payment. */
router.post('/orders', ops, asyncHandler(async (req, res) => {
  const d = manualOrderSchema.parse(req.body);
  const created = await withTransaction(async (conn) => {
    const base = { placedBy: req.user.id, createdVia: 'manual_admin', status: 'payment_pending' };
    let list = [];
    let request = null;
    if (d.manual_request_id) {
      [[request]] = await conn.query('SELECT * FROM manual_order_requests WHERE id = ? FOR UPDATE', [d.manual_request_id]);
      if (!request) throw new ApiError(404, 'Request not found');
      if (['converted', 'closed'].includes(request.status)) throw new ApiError(409, `This request is already ${request.status}`);
      if (request.source === 'rfq') {
        const [[rfq]] = await conn.query('SELECT * FROM rfqs WHERE id = ?', [request.rfq_id]);
        const [[q]] = await conn.query('SELECT * FROM quotations WHERE id = ?', [request.quotation_id]);
        if (!rfq || !q) throw new ApiError(409, 'The RFQ or quotation is no longer available');
        if (rfq.status === 'awarded' || rfq.status === 'cancelled') throw new ApiError(409, `This RFQ is already ${rfq.status}`);
        list.push(await awardQuotation(conn, rfq, q, { ...base, manualRequestId: request.id }));
      } else {
        const snap = typeof request.cart_snapshot === 'string' ? JSON.parse(request.cart_snapshot) : request.cart_snapshot;
        const bySupplier = new Map();
        for (const it of snap.items) {
          if (!bySupplier.has(it.supplier_id)) bySupplier.set(it.supplier_id, []);
          bySupplier.get(it.supplier_id).push(it);
        }
        for (const [supplierId, items] of bySupplier) {
          list.push(await orders.createOrder(conn, {
            ...base, hospitalId: request.hospital_id, supplierId, source: 'cart', manualRequestId: request.id,
            installationRequired: snap.installation_required, delivery: snap.delivery, paymentTerms: d.payment_terms,
            freight: d.freight, installation: d.installation, service: d.service,
            items: items.map((i) => ({ product_id: i.product_id, negotiation_id: i.negotiation_id, item_name: i.name, model_number: i.model_number,
              quantity: i.quantity, unit_price: i.unit_price, gst_rate: i.gst_rate, warranty_months: i.warranty_months })),
          }));
        }
      }
      await conn.query(`UPDATE manual_order_requests SET status = 'converted', converted_order_id = ?, assigned_admin_id = ? WHERE id = ?`, [list[0].id, req.user.id, request.id]);
    } else {
      if (!d.hospital_id || !d.supplier_id || !d.items || !d.delivery_address || !d.delivery_city || !d.delivery_state || !d.delivery_pincode) {
        throw new ApiError(400, 'Choose a hospital, a supplier, the items and the delivery address');
      }
      const [[h]] = await conn.query(`SELECT id FROM hospitals WHERE id = ? AND verification_status = 'verified'`, [d.hospital_id]);
      const [[s]] = await conn.query(`SELECT s.id FROM suppliers s JOIN supplier_verification v ON v.supplier_id = s.id WHERE s.id = ? AND v.verification_status = 'verified'`, [d.supplier_id]);
      if (!h || !s) throw new ApiError(400, 'The hospital and supplier must both be verified');
      list.push(await orders.createOrder(conn, {
        ...base, hospitalId: d.hospital_id, supplierId: d.supplier_id, source: 'cart', items: d.items,
        installationRequired: Boolean(d.installation_required), paymentTerms: d.payment_terms,
        freight: d.freight, installation: d.installation, service: d.service,
        delivery: { address: d.delivery_address, city: d.delivery_city, state: d.delivery_state, pincode: d.delivery_pincode },
      }));
    }
    await audit(conn, { actorId: req.user.id, action: 'order.created_manually', entityType: 'order', entityId: list[0].id, ip: req.ip });
    return list;
  });
  res.status(201).json({ orders: created });
}));

// Offline payment (bank transfer). Can be recorded in parts; the order is paid once the total is covered.
router.post('/orders/:id/payments', ops, asyncHandler(async (req, res) => {
  const d = z.object({ amount: z.coerce.number().positive().max(1e10), reference: str(100), method: z.enum(['bank_transfer', 'cheque', 'cash']).default('bank_transfer') }).parse(req.body);
  const out = await withTransaction(async (conn) => {
    const [[o]] = await conn.query('SELECT * FROM orders WHERE id = ? FOR UPDATE', [idParam(req)]);
    if (!o) throw new ApiError(404, 'Order not found');
    if (o.status !== 'payment_pending') throw new ApiError(409, 'Payments can be recorded while the order is waiting for payment');
    const [[sum]] = await conn.query(`SELECT COALESCE(SUM(amount), 0) AS s FROM payments WHERE order_id = ? AND status = 'captured'`, [o.id]);
    const due = round2(o.total_amount - sum.s);
    if (d.amount > due + 0.005) throw new ApiError(400, `The amount is more than the balance of ₹${due.toLocaleString('en-IN')}`);
    await conn.query(
      `INSERT INTO payments (order_id, razorpay_order_id, amount, method, status, captured_at, gateway_payload)
       VALUES (?, ?, ?, ?, 'captured', NOW(), ?)`,
      [o.id, `OFFLINE-${o.id}-${Date.now()}`, d.amount, d.method, JSON.stringify({ reference: d.reference, recorded_by: req.user.id })]
    );
    const paid = await orders.settleIfPaid(conn, o.id, req.user.id);
    await audit(conn, { actorId: req.user.id, action: 'payment.recorded_offline', entityType: 'order', entityId: o.id, newValues: { amount: d.amount, reference: d.reference }, ip: req.ip });
    return { paid, balance: round2(due - d.amount) };
  });
  res.status(201).json(out);
}));

// ------------------------------------------------------------------ Payouts

router.get('/payouts', ops, asyncHandler(async (req, res) => {
  const status = req.query.status ? String(req.query.status) : null;
  const [rows] = await pool.query(
    `SELECT sp.*, o.order_number, s.company_name, ba.account_holder_name, ba.account_number, ba.ifsc
       FROM supplier_payouts sp JOIN orders o ON o.id = sp.order_id JOIN suppliers s ON s.id = sp.supplier_id
       LEFT JOIN supplier_bank_accounts ba ON ba.supplier_id = s.id AND ba.is_primary = 1
      ${status ? 'WHERE sp.status = ?' : ''} ORDER BY sp.id DESC LIMIT 300`, status ? [status] : []);
  res.json({ payouts: rows });
}));

router.post('/payouts/:id/release', ops, asyncHandler(async (req, res) => {
  const { bank_reference } = z.object({ bank_reference: str(100) }).parse(req.body);
  await withTransaction(async (conn) => {
    const [[p]] = await conn.query('SELECT * FROM supplier_payouts WHERE id = ? FOR UPDATE', [idParam(req)]);
    if (!p) throw new ApiError(404, 'Payout not found');
    if (p.status !== 'eligible') throw new ApiError(409, p.status === 'released' ? 'Already released' : 'This payout is not ready to release');
    const [[open]] = await conn.query(`SELECT COUNT(*) AS n FROM order_disputes WHERE order_id = ? AND status = 'open'`, [p.order_id]);
    if (open.n) throw new ApiError(409, 'There is an open dispute on this order');
    await conn.query(`UPDATE supplier_payouts SET status = 'released', released_at = NOW(), bank_reference = ? WHERE id = ?`, [bank_reference, p.id]);
    await notify.toSupplier(conn, p.supplier_id, { event: 'payout_released', title: `Payout of ₹${p.net_amount.toLocaleString('en-IN')} released`, body: `Bank reference ${bank_reference}`, entityType: 'order', entityId: p.order_id });
    await audit(conn, { actorId: req.user.id, action: 'payout.released', entityType: 'payout', entityId: p.id, newValues: { bank_reference }, ip: req.ip });
  });
  res.json({ status: 'released' });
}));

// ------------------------------------------------------------------ Disputes

router.get('/disputes', ops, asyncHandler(async (req, res) => {
  const status = req.query.status ? String(req.query.status) : 'open';
  const [rows] = await pool.query(
    `SELECT d.*, o.order_number, o.total_amount, o.status AS order_status, h.hospital_name, s.company_name
       FROM order_disputes d JOIN orders o ON o.id = d.order_id JOIN hospitals h ON h.id = o.hospital_id JOIN suppliers s ON s.id = o.supplier_id
      WHERE d.status = ? ORDER BY d.id DESC LIMIT 200`, [status]);
  res.json({ disputes: rows });
}));

router.post('/disputes/:id/resolve', ops, asyncHandler(async (req, res) => {
  const d = z.object({ resolution: z.enum(['release', 'refund', 'close']), note: z.string().trim().min(5, 'Add a short note').max(2000) }).parse(req.body);
  const days = await settings.num('delivery_auto_confirm_days', 7);
  await withTransaction(async (conn) => {
    const [[dis]] = await conn.query('SELECT * FROM order_disputes WHERE id = ? FOR UPDATE', [idParam(req)]);
    if (!dis) throw new ApiError(404, 'Dispute not found');
    if (dis.status !== 'open') throw new ApiError(409, 'This dispute is already resolved');
    const [[o]] = await conn.query('SELECT * FROM orders WHERE id = ? FOR UPDATE', [dis.order_id]);
    const next = { release: 'resolved_release', refund: 'resolved_refund', close: 'closed' }[d.resolution];
    await conn.query('UPDATE order_disputes SET status = ?, resolution_note = ?, resolved_by = ?, resolved_at = NOW() WHERE id = ?', [next, d.note, req.user.id, dis.id]);

    if (d.resolution === 'release') {
      await conn.query('UPDATE deliveries SET buyer_confirmed_at = COALESCE(buyer_confirmed_at, NOW()), installation_confirmed_at = IF(?, COALESCE(installation_confirmed_at, NOW()), installation_confirmed_at), auto_confirm_at = NULL WHERE order_id = ?', [o.installation_required, o.id]);
      await orders.completeOrder(conn, o.id, { by: req.user.id, note: 'Dispute resolved in favour of the supplier' });
    } else if (d.resolution === 'refund') {
      const [pays] = await conn.query(`SELECT * FROM payments WHERE order_id = ? AND status = 'captured'`, [o.id]);
      for (const p of pays) {
        const r = await payments.refundPayment({ razorpayPaymentId: p.razorpay_payment_id, amount: p.amount });
        await conn.query(`INSERT INTO refunds (payment_id, razorpay_refund_id, amount, reason, status, requested_by, processed_at) VALUES (?, ?, ?, ?, ?, ?, NOW())`,
          [p.id, r.id || null, p.amount, d.note.slice(0, 500), r.status === 'processed' ? 'processed' : 'requested', req.user.id]);
        await conn.query(`UPDATE payments SET status = 'refunded' WHERE id = ?`, [p.id]);
      }
      await orders.cancelOrder(conn, o.id, { by: req.user.id, reason: `Refunded after a dispute: ${d.note}` });
    } else {
      // Nothing to change on the order. Delivered goods go back on the auto-confirm clock.
      if (['delivered', 'installed'].includes(o.status)) {
        await conn.query('UPDATE deliveries SET auto_confirm_at = DATE_ADD(NOW(), INTERVAL ? DAY) WHERE order_id = ? AND (buyer_confirmed_at IS NULL OR installed_at IS NOT NULL) AND installation_confirmed_at IS NULL', [days, o.id]);
      }
    }
    const text = { release: 'The dispute was resolved and the order is complete', refund: 'The dispute was resolved with a refund', close: 'The dispute was closed' }[d.resolution];
    await notify.toHospital(conn, o.hospital_id, { event: 'dispute_resolved', title: `${o.order_number}: ${text}`, body: d.note, entityType: 'order', entityId: o.id });
    await notify.toSupplier(conn, o.supplier_id, { event: 'dispute_resolved', title: `${o.order_number}: ${text}`, body: d.note, entityType: 'order', entityId: o.id });
    await audit(conn, { actorId: req.user.id, action: `dispute.${next}`, entityType: 'dispute', entityId: dis.id, ip: req.ip });
  });
  res.json({ ok: true });
}));

// ------------------------------------------------------------------ Directory lookups for manual orders

router.get('/lookup/hospitals', ops, asyncHandler(async (_req, res) => {
  const [rows] = await pool.query(`SELECT id, hospital_name, city, state FROM hospitals WHERE verification_status = 'verified' ORDER BY hospital_name LIMIT 500`);
  res.json({ hospitals: rows });
}));
router.get('/lookup/suppliers', ops, asyncHandler(async (_req, res) => {
  const [rows] = await pool.query(
    `SELECT s.id, s.company_name, s.city, s.state FROM suppliers s JOIN supplier_verification v ON v.supplier_id = s.id WHERE v.verification_status = 'verified' ORDER BY s.company_name LIMIT 500`);
  res.json({ suppliers: rows });
}));

// ------------------------------------------------------------------ Stats and settings

router.get('/stats', asyncHandler(async (_req, res) => {
  const q = async (sql) => (await pool.query(sql))[0][0];
  const [sup, hos, prod, mor, dis, pay, ord, gmv] = await Promise.all([
    q(`SELECT COUNT(*) AS n FROM supplier_verification WHERE verification_status IN ('pending','under_verification')`),
    q(`SELECT COUNT(*) AS n FROM hospitals WHERE verification_status IN ('pending','under_verification')`),
    q(`SELECT COUNT(*) AS n FROM products WHERE status = 'pending_approval'`),
    q(`SELECT COUNT(*) AS n FROM manual_order_requests WHERE status IN ('new','contacted')`),
    q(`SELECT COUNT(*) AS n FROM order_disputes WHERE status = 'open'`),
    q(`SELECT COUNT(*) AS n, COALESCE(SUM(net_amount), 0) AS amount FROM supplier_payouts WHERE status = 'eligible'`),
    q(`SELECT COUNT(*) AS n FROM orders WHERE status NOT IN ('completed','cancelled')`),
    q(`SELECT COALESCE(SUM(total_amount), 0) AS amount FROM orders WHERE status = 'completed'`),
  ]);
  res.json({
    suppliers_pending: sup.n, hospitals_pending: hos.n, products_pending: prod.n, manual_requests_open: mor.n,
    disputes_open: dis.n, payouts_ready: pay.n, payouts_ready_amount: pay.amount, orders_in_progress: ord.n, completed_value: gmv.amount,
  });
}));

router.get('/settings', requireAdminRole(), asyncHandler(async (_req, res) => {
  const [rows] = await pool.query('SELECT setting_key, setting_value, description, updated_at FROM platform_settings ORDER BY setting_key');
  res.json({ settings: rows });
}));

router.put('/settings/:key', requireAdminRole(), asyncHandler(async (req, res) => {
  const { value } = z.object({ value: z.union([z.string(), z.number()]).transform((v) => String(v).trim()) }).parse(req.body);
  if (!value || value.length > 255) throw new ApiError(400, 'Enter a value');
  const key = String(req.params.key);
  const numeric = ['online_order_cap', 'negotiation_min_unit_price', 'negotiation_inactivity_days', 'price_lock_hours', 'delivery_auto_confirm_days', 'platform_fee_percent', 'default_gst_rate', 'rfq_default_quote_days'];
  if (numeric.includes(key) && !(Number(value) >= 0)) throw new ApiError(400, 'Enter a number');
  const [r] = await pool.query('UPDATE platform_settings SET setting_value = ?, updated_by = ? WHERE setting_key = ?', [value, req.user.id, key]);
  if (!r.affectedRows) throw new ApiError(404, 'Unknown setting');
  settings.clear();
  await audit(pool, { actorId: req.user.id, action: 'settings.updated', entityType: 'setting', entityId: null, newValues: { key, value }, ip: req.ip });
  res.json({ ok: true });
}));

module.exports = router;

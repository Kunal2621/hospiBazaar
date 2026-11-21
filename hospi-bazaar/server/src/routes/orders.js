'use strict';

// Order lifecycle (spec section 8):
// placed -> supplier confirms -> hospital pays -> supplier dispatches -> delivered -> (installed) -> completed
// The supplier is paid only after the hospital confirms delivery (and installation), see decision 3.
const express = require('express');
const { pool, withTransaction } = require('../db');
const { z, str, optionalStr } = require('../utils/validation');
const { ApiError, asyncHandler } = require('../utils/errors');
const { audit } = require('../utils/audit');
const settings = require('../services/settings');
const notify = require('../services/notify');
const orders = require('../services/orders');
const payments = require('../services/payments');
const { authenticate } = require('../middleware/auth');
const { BUYER_ROLES, idParam } = require('../middleware/guards');

const router = express.Router();
router.use(authenticate);

const CONFIRM_ROLES = [...BUYER_ROLES, 'biomedical_engineer'];

function scopeOf(user) {
  if (user.type === 'hospital_user' && user.hospitalId) return { side: 'hospital', col: 'o.hospital_id', val: user.hospitalId };
  if (user.type === 'supplier_user' && user.supplierId) return { side: 'supplier', col: 'o.supplier_id', val: user.supplierId };
  if (user.type === 'admin') return { side: 'admin' };
  throw new ApiError(403, 'Not allowed');
}

async function loadOrder(conn, req, { lock = false } = {}) {
  const sc = scopeOf(req.user);
  const [[o]] = await conn.query(
    `SELECT o.* FROM orders o WHERE o.id = ? ${sc.col ? `AND ${sc.col} = ?` : ''} ${lock ? 'FOR UPDATE' : ''}`,
    sc.col ? [idParam(req), sc.val] : [idParam(req)]
  );
  if (!o) throw new ApiError(404, 'Order not found');
  return { o, sc };
}

const mustBe = (o, ...statuses) => {
  if (!statuses.includes(o.status)) throw new ApiError(409, `This cannot be done while the order is ${o.status.replace(/_/g, ' ')}`);
};
const requireSide = (sc, side) => { if (sc.side !== side) throw new ApiError(403, 'Not allowed'); };
const requireRole = (req, roles) => { if (!roles.includes(req.user.hospitalRole)) throw new ApiError(403, 'Your role cannot do this'); };

async function openDispute(conn, orderId) {
  const [[d]] = await conn.query(`SELECT id FROM order_disputes WHERE order_id = ? AND status = 'open' LIMIT 1`, [orderId]);
  return d || null;
}

/** What this user can do next, so the screens never guess. */
function actionsFor(o, sc, req, delivery, dispute) {
  const a = [];
  if (sc.side === 'supplier') {
    if (o.status === 'pending_supplier_confirmation') a.push('confirm', 'reject');
    if (o.status === 'paid') a.push('dispatch');
    if (o.status === 'dispatched') a.push('mark_delivered');
    if (o.status === 'delivered' && o.installation_required && delivery?.buyer_confirmed_at) a.push('mark_installed');
  }
  if (sc.side === 'hospital') {
    const buyer = BUYER_ROLES.includes(req.user.hospitalRole);
    const confirmer = CONFIRM_ROLES.includes(req.user.hospitalRole);
    const manualOffline = o.created_via === 'manual_admin';
    if (buyer && ['pending_supplier_confirmation', 'payment_pending'].includes(o.status)) a.push('cancel');
    if (buyer && o.status === 'payment_pending' && !manualOffline) a.push('pay');
    if (confirmer && !dispute && o.status === 'delivered' && delivery && !delivery.buyer_confirmed_at) a.push('confirm_delivery');
    if (confirmer && !dispute && o.status === 'installed') a.push('confirm_installation');
    if (confirmer && !dispute && ['dispatched', 'delivered', 'installed'].includes(o.status)) a.push('dispute');
  }
  return a;
}

router.get('/', asyncHandler(async (req, res) => {
  const sc = scopeOf(req.user);
  const status = req.query.status ? String(req.query.status) : null;
  const where = []; const params = [];
  if (sc.col) { where.push(`${sc.col} = ?`); params.push(sc.val); }
  if (status) { where.push('o.status = ?'); params.push(status); }
  const [rows] = await pool.query(
    `SELECT o.id, o.order_number, o.status, o.total_amount, o.source, o.created_via, o.created_at, o.delivery_city,
            h.hospital_name, s.company_name, (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) AS item_count,
            (SELECT item_name FROM order_items WHERE order_id = o.id ORDER BY id LIMIT 1) AS first_item
       FROM orders o JOIN hospitals h ON h.id = o.hospital_id JOIN suppliers s ON s.id = o.supplier_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY o.id DESC LIMIT 300`,
    params
  );
  res.json({ orders: rows });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const { o, sc } = await loadOrder(pool, req);
  const [[h]] = await pool.query('SELECT hospital_name, gstin, city, state FROM hospitals WHERE id = ?', [o.hospital_id]);
  const [[s]] = await pool.query('SELECT company_name, gstin, city, state, phone FROM suppliers WHERE id = ?', [o.supplier_id]);
  const [items] = await pool.query('SELECT * FROM order_items WHERE order_id = ? ORDER BY id', [o.id]);
  const [history] = await pool.query(
    `SELECT from_status, to_status, note, changed_at FROM order_status_history WHERE order_id = ? ORDER BY id`, [o.id]);
  const [[delivery]] = await pool.query('SELECT * FROM deliveries WHERE order_id = ?', [o.id]);
  const [pays] = await pool.query(
    `SELECT id, amount, method, status, captured_at, razorpay_payment_id, created_at FROM payments WHERE order_id = ? ORDER BY id`, [o.id]);
  const dispute = await pool.query('SELECT * FROM order_disputes WHERE order_id = ? ORDER BY id DESC LIMIT 1', [o.id]).then(([r]) => r[0] || null);
  let payout = null;
  if (sc.side !== 'hospital') [[payout]] = await pool.query('SELECT status, gross_amount, platform_fee_rate, platform_fee, net_amount, eligible_at, released_at, bank_reference FROM supplier_payouts WHERE order_id = ?', [o.id]);
  const openD = dispute && dispute.status === 'open' ? dispute : null;
  res.json({
    order: o, hospital: h, supplier: s, items, history, delivery: delivery || null, payments: pays, payout: payout || null, dispute,
    actions: actionsFor(o, sc, req, delivery, openD),
    side: sc.side,
    dispute_note: await settings.get('dispute_window_note'),
    manual_payment_note: o.created_via === 'manual_admin' ? 'Pay this order by bank transfer. Our team will record the payment.' : null,
  });
}));

// ------------------------------------------------------------------ Supplier actions

router.post('/:id/confirm', asyncHandler(async (req, res) => {
  const body = z.object({ payment_terms: optionalStr(500) }).parse(req.body);
  await withTransaction(async (conn) => {
    const { o, sc } = await loadOrder(conn, req, { lock: true });
    requireSide(sc, 'supplier'); mustBe(o, 'pending_supplier_confirmation');
    if (body.payment_terms) await conn.query('UPDATE orders SET payment_terms = ? WHERE id = ?', [body.payment_terms, o.id]);
    await orders.setStatus(conn, o.id, 'payment_pending', { by: req.user.id, note: 'Supplier confirmed the order' });
    await notify.toHospital(conn, o.hospital_id, { event: 'order_confirmed', title: `${o.order_number} confirmed`, body: o.created_via === 'manual_admin' ? 'Pay by bank transfer. Our team will record it.' : 'You can pay now.', entityType: 'order', entityId: o.id });
    await audit(conn, { actorId: req.user.id, action: 'order.confirmed', entityType: 'order', entityId: o.id, ip: req.ip });
  });
  res.json({ status: 'payment_pending' });
}));

router.post('/:id/reject', asyncHandler(async (req, res) => {
  const { reason } = z.object({ reason: z.string().trim().min(5, 'Give a reason').max(500) }).parse(req.body);
  await withTransaction(async (conn) => {
    const { o, sc } = await loadOrder(conn, req, { lock: true });
    requireSide(sc, 'supplier'); mustBe(o, 'pending_supplier_confirmation');
    await orders.cancelOrder(conn, o.id, { by: req.user.id, reason: `Declined by the supplier: ${reason}` });
    await audit(conn, { actorId: req.user.id, action: 'order.rejected_by_supplier', entityType: 'order', entityId: o.id, ip: req.ip });
  });
  res.json({ status: 'cancelled' });
}));

const dispatchSchema = z.object({
  carrier_name: str(150), tracking_reference: optionalStr(150),
  supplier_invoice_number: str(60),
  supplier_invoice_url: z.preprocess((v) => (v === '' ? undefined : v), z.string().max(500).regex(/^(\/uploads\/[a-f0-9]+\.[a-z]+|https?:\/\/\S+)$/).optional()),
  notes: optionalStr(1000),
});

router.post('/:id/dispatch', asyncHandler(async (req, res) => {
  const d = dispatchSchema.parse(req.body);
  await withTransaction(async (conn) => {
    const { o, sc } = await loadOrder(conn, req, { lock: true });
    requireSide(sc, 'supplier'); mustBe(o, 'paid');
    const [[big]] = await conn.query(`SELECT COUNT(*) AS n FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id = ? AND p.logistics_type = 'large_equipment'`, [o.id]);
    const type = big.n > 0 ? 'large_equipment' : 'small_parcel';
    await conn.query('UPDATE orders SET supplier_invoice_number = ?, supplier_invoice_url = ? WHERE id = ?', [d.supplier_invoice_number, d.supplier_invoice_url ?? null, o.id]);
    await conn.query(
      `INSERT INTO deliveries (order_id, delivery_type, carrier_name, tracking_reference, dispatched_at, notes) VALUES (?, ?, ?, ?, NOW(), ?)
       ON DUPLICATE KEY UPDATE carrier_name = VALUES(carrier_name), tracking_reference = VALUES(tracking_reference), dispatched_at = NOW(), notes = VALUES(notes)`,
      [o.id, type, d.carrier_name, d.tracking_reference ?? null, d.notes ?? null]
    );
    await orders.setStatus(conn, o.id, 'dispatched', { by: req.user.id, note: `Dispatched with ${d.carrier_name}` });
    await notify.toHospital(conn, o.hospital_id, { event: 'order_dispatched', title: `${o.order_number} was dispatched`, body: `${d.carrier_name}${d.tracking_reference ? `, tracking ${d.tracking_reference}` : ''}`, entityType: 'order', entityId: o.id });
  });
  res.json({ status: 'dispatched' });
}));

router.post('/:id/mark-delivered', asyncHandler(async (req, res) => {
  const days = await settings.num('delivery_auto_confirm_days', 7);
  await withTransaction(async (conn) => {
    const { o, sc } = await loadOrder(conn, req, { lock: true });
    requireSide(sc, 'supplier'); mustBe(o, 'dispatched');
    await conn.query(`UPDATE deliveries SET delivered_at = NOW(), auto_confirm_at = DATE_ADD(NOW(), INTERVAL ? DAY) WHERE order_id = ?`, [days, o.id]);
    await orders.setStatus(conn, o.id, 'delivered', { by: req.user.id, note: 'Supplier marked the order delivered' });
    await notify.toHospital(conn, o.hospital_id, { event: 'order_delivered', title: `${o.order_number} was delivered`, body: `Confirm delivery, or raise a dispute. It is confirmed automatically after ${days} days.`, entityType: 'order', entityId: o.id });
  });
  res.json({ status: 'delivered' });
}));

router.post('/:id/mark-installed', asyncHandler(async (req, res) => {
  const days = await settings.num('delivery_auto_confirm_days', 7);
  await withTransaction(async (conn) => {
    const { o, sc } = await loadOrder(conn, req, { lock: true });
    requireSide(sc, 'supplier'); mustBe(o, 'delivered');
    const [[dl]] = await conn.query('SELECT buyer_confirmed_at FROM deliveries WHERE order_id = ?', [o.id]);
    if (!o.installation_required || !dl?.buyer_confirmed_at) throw new ApiError(409, 'Installation can be marked once the hospital confirms delivery');
    await conn.query(`UPDATE deliveries SET installed_at = NOW(), auto_confirm_at = DATE_ADD(NOW(), INTERVAL ? DAY) WHERE order_id = ?`, [days, o.id]);
    await orders.setStatus(conn, o.id, 'installed', { by: req.user.id, note: 'Supplier marked the order installed' });
    await notify.toHospital(conn, o.hospital_id, { event: 'order_installed', title: `${o.order_number} was installed`, body: 'Confirm the installation to complete the order.', entityType: 'order', entityId: o.id });
  });
  res.json({ status: 'installed' });
}));

// ------------------------------------------------------------------ Hospital actions

router.post('/:id/cancel', asyncHandler(async (req, res) => {
  const { reason } = z.object({ reason: optionalStr(500) }).parse(req.body);
  await withTransaction(async (conn) => {
    const { o, sc } = await loadOrder(conn, req, { lock: true });
    requireSide(sc, 'hospital'); requireRole(req, BUYER_ROLES);
    mustBe(o, 'pending_supplier_confirmation', 'payment_pending');
    const [[paid]] = await conn.query(`SELECT COUNT(*) AS n FROM payments WHERE order_id = ? AND status = 'captured'`, [o.id]);
    if (paid.n > 0) throw new ApiError(409, 'A payment has been received for this order. Contact support to cancel it.');
    await orders.cancelOrder(conn, o.id, { by: req.user.id, reason: reason || 'Cancelled by the hospital' });
    await audit(conn, { actorId: req.user.id, action: 'order.cancelled', entityType: 'order', entityId: o.id, ip: req.ip });
  });
  res.json({ status: 'cancelled' });
}));

// Start an online payment. Returns what the checkout needs (real Razorpay key, or mock mode).
router.post('/:id/pay', asyncHandler(async (req, res) => {
  const out = await withTransaction(async (conn) => {
    const { o, sc } = await loadOrder(conn, req, { lock: true });
    requireSide(sc, 'hospital'); requireRole(req, BUYER_ROLES);
    mustBe(o, 'payment_pending');
    if (o.created_via === 'manual_admin') throw new ApiError(409, 'Pay this order by bank transfer. Our team will record the payment.');
    const [[paid]] = await conn.query(`SELECT COALESCE(SUM(amount), 0) AS s FROM payments WHERE order_id = ? AND status = 'captured'`, [o.id]);
    const due = Math.round((o.total_amount - paid.s) * 100) / 100;
    let [[pay]] = await conn.query(`SELECT * FROM payments WHERE order_id = ? AND status = 'created' ORDER BY id DESC LIMIT 1`, [o.id]);
    if (!pay || Math.abs(pay.amount - due) > 0.005) {
      const gw = await payments.createGatewayOrder({ amount: due, receipt: o.order_number });
      const [r] = await conn.query(`INSERT INTO payments (order_id, razorpay_order_id, amount, currency) VALUES (?, ?, ?, 'INR')`, [o.id, gw.id, due]);
      [[pay]] = await conn.query('SELECT * FROM payments WHERE id = ?', [r.insertId]);
    }
    const [[h]] = await conn.query('SELECT hospital_name, contact_person_email, contact_person_mobile FROM hospitals WHERE id = ?', [o.hospital_id]);
    return {
      ...payments.publicConfig(), razorpay_order_id: pay.razorpay_order_id, amount: pay.amount, amount_paise: Math.round(pay.amount * 100),
      currency: 'INR', order_id: o.id, order_number: o.order_number,
      prefill: { name: h.hospital_name, email: h.contact_person_email, contact: h.contact_person_mobile },
    };
  });
  res.json(out);
}));

router.post('/:id/confirm-delivery', asyncHandler(async (req, res) => {
  const result = await withTransaction(async (conn) => {
    const { o, sc } = await loadOrder(conn, req, { lock: true });
    requireSide(sc, 'hospital'); requireRole(req, CONFIRM_ROLES); mustBe(o, 'delivered');
    if (await openDispute(conn, o.id)) throw new ApiError(409, 'There is an open dispute on this order');
    const [[dl]] = await conn.query('SELECT buyer_confirmed_at FROM deliveries WHERE order_id = ?', [o.id]);
    if (dl?.buyer_confirmed_at) throw new ApiError(409, 'Delivery is already confirmed');
    await audit(conn, { actorId: req.user.id, action: 'order.delivery_confirmed', entityType: 'order', entityId: o.id, ip: req.ip });
    return orders.confirmDelivery(conn, o.id, { by: req.user.id });
  });
  res.json({ result });
}));

router.post('/:id/confirm-installation', asyncHandler(async (req, res) => {
  await withTransaction(async (conn) => {
    const { o, sc } = await loadOrder(conn, req, { lock: true });
    requireSide(sc, 'hospital'); requireRole(req, CONFIRM_ROLES); mustBe(o, 'installed');
    if (await openDispute(conn, o.id)) throw new ApiError(409, 'There is an open dispute on this order');
    await audit(conn, { actorId: req.user.id, action: 'order.installation_confirmed', entityType: 'order', entityId: o.id, ip: req.ip });
    await orders.confirmInstallation(conn, o.id, { by: req.user.id });
  });
  res.json({ status: 'completed' });
}));

router.post('/:id/dispute', asyncHandler(async (req, res) => {
  const { reason } = z.object({ reason: z.string().trim().min(10, 'Describe the problem in a few words').max(2000) }).parse(req.body);
  const id = await withTransaction(async (conn) => {
    const { o, sc } = await loadOrder(conn, req, { lock: true });
    requireSide(sc, 'hospital'); requireRole(req, CONFIRM_ROLES);
    mustBe(o, 'dispatched', 'delivered', 'installed');
    if (await openDispute(conn, o.id)) throw new ApiError(409, 'A dispute is already open for this order');
    const [r] = await conn.query('INSERT INTO order_disputes (order_id, raised_by, reason) VALUES (?, ?, ?)', [o.id, req.user.id, reason]);
    await conn.query('UPDATE deliveries SET auto_confirm_at = NULL WHERE order_id = ?', [o.id]);
    await notify.toAdmins(conn, { event: 'dispute_opened', title: `Dispute on ${o.order_number}`, body: reason.slice(0, 200), entityType: 'dispute', entityId: r.insertId }, ['super_admin', 'support']);
    await notify.toSupplier(conn, o.supplier_id, { event: 'dispute_opened', title: `The hospital raised a dispute on ${o.order_number}`, entityType: 'order', entityId: o.id });
    await audit(conn, { actorId: req.user.id, action: 'dispute.opened', entityType: 'dispute', entityId: r.insertId, ip: req.ip });
    return r.insertId;
  });
  res.status(201).json({ id });
}));

module.exports = router;

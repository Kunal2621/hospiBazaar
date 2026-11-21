'use strict';

// Warranty, service requests, notifications and the dashboard summaries.
const express = require('express');
const { pool, withTransaction } = require('../db');
const { z, str, optionalStr } = require('../utils/validation');
const { ApiError, asyncHandler } = require('../utils/errors');
const { audit } = require('../utils/audit');
const notify = require('../services/notify');
const { authenticate } = require('../middleware/auth');
const { BUYER_ROLES, idParam } = require('../middleware/guards');

const router = express.Router();
// Mounted at /api, so only guard our own paths and let unknown URLs fall through to the 404 handler.
router.use(['/notifications', '/warranties', '/service-requests', '/summary'], authenticate);

const isHospital = (u) => u.type === 'hospital_user' && u.hospitalId;
const isSupplier = (u) => u.type === 'supplier_user' && u.supplierId;
const side = (u) => {
  if (isHospital(u)) return { col: 'hospital_id', val: u.hospitalId, name: 'hospital' };
  if (isSupplier(u)) return { col: 'supplier_id', val: u.supplierId, name: 'supplier' };
  if (u.type === 'admin') return { name: 'admin' };
  throw new ApiError(403, 'Not allowed');
};

// ------------------------------------------------------------------ Notifications

router.get('/notifications', asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT id, event_type, title, body, entity_type, entity_id, status, created_at FROM notifications
      WHERE user_id = ? AND channel = 'in_app' ORDER BY id DESC LIMIT 50`, [req.user.id]);
  const [[c]] = await pool.query(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND channel = 'in_app' AND status <> 'read'`, [req.user.id]);
  res.json({ notifications: rows.map((r) => ({ ...r, is_read: r.status === 'read' })), unread: c.n });
}));

router.get('/notifications/unread-count', asyncHandler(async (req, res) => {
  const [[c]] = await pool.query(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND channel = 'in_app' AND status <> 'read'`, [req.user.id]);
  res.json({ unread: c.n });
}));

router.post('/notifications/read-all', asyncHandler(async (req, res) => {
  await pool.query(`UPDATE notifications SET status = 'read', read_at = NOW() WHERE user_id = ? AND channel = 'in_app' AND status <> 'read'`, [req.user.id]);
  res.json({ ok: true });
}));

router.post('/notifications/:id/read', asyncHandler(async (req, res) => {
  await pool.query(`UPDATE notifications SET status = 'read', read_at = NOW() WHERE id = ? AND user_id = ? AND channel = 'in_app'`, [idParam(req), req.user.id]);
  res.json({ ok: true });
}));

// ------------------------------------------------------------------ Warranty

router.get('/warranties', asyncHandler(async (req, res) => {
  const sd = side(req.user);
  const [rows] = await pool.query(
    `SELECT w.id, w.model_number, w.serial_number, w.purchase_date, w.installation_date, w.warranty_months, w.expires_on,
            oi.item_name, o.id AS order_id, o.order_number, h.hospital_name, s.company_name,
            (w.expires_on IS NOT NULL AND w.expires_on < CURDATE()) AS expired,
            (SELECT COUNT(*) FROM service_requests sr WHERE sr.warranty_id = w.id AND sr.status NOT IN ('resolved','closed')) AS open_tickets
       FROM warranties w JOIN order_items oi ON oi.id = w.order_item_id JOIN orders o ON o.id = oi.order_id
       JOIN hospitals h ON h.id = w.hospital_id JOIN suppliers s ON s.id = w.supplier_id
      ${sd.col ? `WHERE w.${sd.col} = ?` : ''} ORDER BY w.expires_on IS NULL, w.expires_on LIMIT 500`, sd.col ? [sd.val] : []);
  res.json({ warranties: rows.map((r) => ({ ...r, expired: Boolean(r.expired) })) });
}));

// The hospital records the serial number and the installation date. Warranty expiry follows the installation date.
router.patch('/warranties/:id', asyncHandler(async (req, res) => {
  const sd = side(req.user);
  if (sd.name === 'admin') throw new ApiError(403, 'Not allowed');
  const d = z.object({
    serial_number: optionalStr(100),
    installation_date: z.preprocess((v) => (v === '' ? undefined : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date').optional()),
  }).parse(req.body);
  const [[w]] = await pool.query(`SELECT id FROM warranties WHERE id = ? AND ${sd.col} = ?`, [idParam(req), sd.val]);
  if (!w) throw new ApiError(404, 'Warranty not found');
  await pool.query(
    `UPDATE warranties SET serial_number = COALESCE(?, serial_number),
       installation_date = COALESCE(?, installation_date),
       expires_on = IF(? IS NULL, expires_on, DATE_ADD(?, INTERVAL warranty_months MONTH)) WHERE id = ?`,
    [d.serial_number ?? null, d.installation_date ?? null, d.installation_date ?? null, d.installation_date ?? null, w.id]);
  res.json({ ok: true });
}));

// ------------------------------------------------------------------ Service requests

const SR_STATUSES = ['acknowledged', 'in_progress', 'resolved'];

router.get('/service-requests', asyncHandler(async (req, res) => {
  const sd = side(req.user);
  const status = req.query.status ? String(req.query.status) : null;
  const where = []; const params = [];
  if (sd.col) { where.push(`sr.${sd.col} = ?`); params.push(sd.val); }
  if (status) { where.push('sr.status = ?'); params.push(status); }
  const [rows] = await pool.query(
    `SELECT sr.id, sr.ticket_number, sr.issue_summary, sr.priority, sr.status, sr.created_at, sr.updated_at,
            h.hospital_name, s.company_name, oi.item_name
       FROM service_requests sr JOIN hospitals h ON h.id = sr.hospital_id JOIN suppliers s ON s.id = sr.supplier_id
       LEFT JOIN warranties w ON w.id = sr.warranty_id LEFT JOIN order_items oi ON oi.id = w.order_item_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY sr.id DESC LIMIT 300`, params);
  res.json({ requests: rows });
}));

router.post('/service-requests', asyncHandler(async (req, res) => {
  if (!isHospital(req.user)) throw new ApiError(403, 'Only hospitals raise service requests');
  const d = z.object({
    warranty_id: z.coerce.number().int().positive(),
    issue_summary: z.string().trim().min(5, 'Describe the issue in a few words').max(300),
    description: optionalStr(4000),
    priority: z.enum(['low', 'normal', 'high', 'critical']).default('normal'),
  }).parse(req.body);
  const out = await withTransaction(async (conn) => {
    const [[w]] = await conn.query('SELECT * FROM warranties WHERE id = ? AND hospital_id = ?', [d.warranty_id, req.user.hospitalId]);
    if (!w) throw new ApiError(404, 'Warranty not found');
    const [r] = await conn.query(
      `INSERT INTO service_requests (hospital_id, supplier_id, warranty_id, raised_by, issue_summary, description, priority) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [w.hospital_id, w.supplier_id, w.id, req.user.id, d.issue_summary, d.description ?? null, d.priority]);
    const ticket = `HB-SR-${String(r.insertId).padStart(6, '0')}`;
    await conn.query('UPDATE service_requests SET ticket_number = ? WHERE id = ?', [ticket, r.insertId]);
    await notify.toSupplier(conn, w.supplier_id, { event: 'service_request', title: `Service request ${ticket}`, body: d.issue_summary, entityType: 'service_request', entityId: r.insertId });
    await audit(conn, { actorId: req.user.id, action: 'service_request.created', entityType: 'service_request', entityId: r.insertId, ip: req.ip });
    return { id: r.insertId, ticket_number: ticket, expired: w.expires_on && new Date(w.expires_on) < new Date() };
  });
  res.status(201).json(out);
}));

async function loadRequest(req) {
  const sd = side(req.user);
  const [[sr]] = await pool.query(
    `SELECT sr.*, h.hospital_name, s.company_name, oi.item_name, w.serial_number, w.expires_on
       FROM service_requests sr JOIN hospitals h ON h.id = sr.hospital_id JOIN suppliers s ON s.id = sr.supplier_id
       LEFT JOIN warranties w ON w.id = sr.warranty_id LEFT JOIN order_items oi ON oi.id = w.order_item_id
      WHERE sr.id = ? ${sd.col ? `AND sr.${sd.col} = ?` : ''}`, sd.col ? [idParam(req), sd.val] : [idParam(req)]);
  if (!sr) throw new ApiError(404, 'Service request not found');
  return { sr, sd };
}

router.get('/service-requests/:id', asyncHandler(async (req, res) => {
  const { sr, sd } = await loadRequest(req);
  const [updates] = await pool.query(
    `SELECT u.id, u.message, u.new_status, u.created_at, us.full_name FROM service_request_updates u JOIN users us ON us.id = u.user_id
      WHERE u.service_request_id = ? ORDER BY u.id`, [sr.id]);
  res.json({ request: sr, updates, side: sd.name });
}));

router.post('/service-requests/:id/updates', asyncHandler(async (req, res) => {
  const d = z.object({ message: z.string().trim().min(2, 'Write a message').max(2000), status: z.enum(SR_STATUSES).optional() }).parse(req.body);
  await withTransaction(async (conn) => {
    const { sr, sd } = await loadRequest(req);
    if (sr.status === 'closed') throw new ApiError(409, 'This request is closed');
    if (sd.name === 'admin') throw new ApiError(403, 'Not allowed');
    if (d.status && sd.name !== 'supplier') throw new ApiError(403, 'Only the supplier changes the status');
    await conn.query('INSERT INTO service_request_updates (service_request_id, user_id, message, new_status) VALUES (?, ?, ?, ?)', [sr.id, req.user.id, d.message, d.status ?? null]);
    if (d.status) {
      await conn.query(`UPDATE service_requests SET status = ?, resolved_at = IF(? = 'resolved', NOW(), resolved_at) WHERE id = ?`, [d.status, d.status, sr.id]);
    } else {
      await conn.query('UPDATE service_requests SET updated_at = NOW() WHERE id = ?', [sr.id]);
    }
    const payload = { event: 'service_update', title: `${sr.ticket_number}: ${d.status ? d.status.replace('_', ' ') : 'new message'}`, body: d.message.slice(0, 200), entityType: 'service_request', entityId: sr.id };
    if (sd.name === 'supplier') await notify.toHospital(conn, sr.hospital_id, payload);
    else await notify.toSupplier(conn, sr.supplier_id, payload);
  });
  res.status(201).json({ ok: true });
}));

router.post('/service-requests/:id/close', asyncHandler(async (req, res) => {
  const { sr, sd } = await loadRequest(req);
  if (sd.name !== 'hospital') throw new ApiError(403, 'Only the hospital closes a request');
  if (!BUYER_ROLES.includes(req.user.hospitalRole) && req.user.id !== sr.raised_by && req.user.hospitalRole !== 'biomedical_engineer') throw new ApiError(403, 'Your role cannot do this');
  if (sr.status === 'closed') throw new ApiError(409, 'Already closed');
  await withTransaction(async (conn) => {
    await conn.query(`UPDATE service_requests SET status = 'closed' WHERE id = ?`, [sr.id]);
    await conn.query(`INSERT INTO service_request_updates (service_request_id, user_id, message, new_status) VALUES (?, ?, 'Closed by the hospital', 'closed')`, [sr.id, req.user.id]);
    await notify.toSupplier(conn, sr.supplier_id, { event: 'service_update', title: `${sr.ticket_number} was closed`, entityType: 'service_request', entityId: sr.id });
  });
  res.json({ status: 'closed' });
}));

// ------------------------------------------------------------------ Dashboard summaries (real counts)

router.get('/summary', asyncHandler(async (req, res) => {
  const u = req.user;
  const n = async (sql, p = []) => (await pool.query(sql, p))[0][0].n;
  if (isHospital(u)) {
    const h = u.hospitalId;
    const [rfqs, quotes, nego, orders, toConfirm, warrantySoon, tickets, cart] = await Promise.all([
      n(`SELECT COUNT(*) AS n FROM rfqs WHERE hospital_id = ? AND status = 'open'`, [h]),
      n(`SELECT COUNT(*) AS n FROM quotations q JOIN rfqs r ON r.id = q.rfq_id WHERE r.hospital_id = ? AND r.status = 'open' AND q.status = 'submitted'`, [h]),
      n(`SELECT COUNT(*) AS n FROM negotiations WHERE buyer_id = ? AND status = 'open' AND (SELECT sender FROM negotiation_messages m WHERE m.negotiation_id = negotiations.negotiation_id AND m.offer_amount IS NOT NULL ORDER BY m.message_id DESC LIMIT 1) = 'supplier'`, [h]),
      n(`SELECT COUNT(*) AS n FROM orders WHERE hospital_id = ? AND status NOT IN ('completed','cancelled')`, [h]),
      n(`SELECT COUNT(*) AS n FROM orders WHERE hospital_id = ? AND status IN ('payment_pending','delivered','installed')`, [h]),
      n(`SELECT COUNT(*) AS n FROM warranties WHERE hospital_id = ? AND expires_on BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 60 DAY)`, [h]),
      n(`SELECT COUNT(*) AS n FROM service_requests WHERE hospital_id = ? AND status NOT IN ('resolved','closed')`, [h]),
      n(`SELECT COUNT(*) AS n FROM cart_items ci JOIN carts c ON c.id = ci.cart_id WHERE c.hospital_id = ? AND c.user_id = ?`, [h, u.id]),
    ]);
    return res.json({ open_rfqs: rfqs, new_quotations: quotes, negotiations_awaiting_you: nego, orders_in_progress: orders, orders_need_action: toConfirm, warranties_expiring: warrantySoon, open_tickets: tickets, cart_items: cart });
  }
  if (isSupplier(u)) {
    const s = u.supplierId;
    const [rfqs, nego, toConfirm, toDispatch, tickets, products, payout] = await Promise.all([
      n(`SELECT COUNT(*) AS n FROM rfq_recipients rr JOIN rfqs r ON r.id = rr.rfq_id WHERE rr.supplier_id = ? AND r.status = 'open' AND rr.status IN ('sent','viewed')`, [s]),
      n(`SELECT COUNT(*) AS n FROM negotiations WHERE supplier_id = ? AND status = 'open' AND (SELECT sender FROM negotiation_messages m WHERE m.negotiation_id = negotiations.negotiation_id AND m.offer_amount IS NOT NULL ORDER BY m.message_id DESC LIMIT 1) = 'buyer'`, [s]),
      n(`SELECT COUNT(*) AS n FROM orders WHERE supplier_id = ? AND status = 'pending_supplier_confirmation'`, [s]),
      n(`SELECT COUNT(*) AS n FROM orders WHERE supplier_id = ? AND status = 'paid'`, [s]),
      n(`SELECT COUNT(*) AS n FROM service_requests WHERE supplier_id = ? AND status IN ('open','acknowledged','in_progress')`, [s]),
      n(`SELECT COUNT(*) AS n FROM products WHERE supplier_id = ? AND status = 'approved'`, [s]),
      pool.query(`SELECT COALESCE(SUM(net_amount), 0) AS amount FROM supplier_payouts WHERE supplier_id = ? AND status IN ('held','eligible')`, [s]).then(([r]) => r[0].amount),
    ]);
    return res.json({ rfqs_to_quote: rfqs, negotiations_awaiting_you: nego, orders_to_confirm: toConfirm, orders_to_dispatch: toDispatch, open_tickets: tickets, live_products: products, payout_pending: payout });
  }
  throw new ApiError(403, 'Not allowed');
}));

module.exports = router;

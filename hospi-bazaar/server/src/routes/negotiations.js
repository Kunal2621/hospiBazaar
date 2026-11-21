'use strict';

// Per-item counter offers (spec section 18, decisions 4 and 6):
//  - only on items priced above negotiation_min_unit_price
//  - open-ended chat of offers, auto-closes after negotiation_inactivity_days without a message
//  - quantity is fixed when the negotiation starts
const express = require('express');
const { pool, withTransaction } = require('../db');
const { z, optionalStr } = require('../utils/validation');
const { ApiError, asyncHandler } = require('../utils/errors');
const { audit } = require('../utils/audit');
const settings = require('../services/settings');
const notify = require('../services/notify');
const { authenticate } = require('../middleware/auth');
const { BUYER_ROLES, idParam } = require('../middleware/guards');

const router = express.Router();
router.use(authenticate);

/** Close open negotiations that have been quiet for too long. Also run by the background job. */
async function sweepExpired(conn = pool) {
  const [r] = await conn.query(
    `UPDATE negotiations SET status = 'closed_no_deal', close_reason = 'expired', closed_at = NOW() WHERE status = 'open' AND expires_at < NOW()`
  );
  return r.affectedRows;
}

function sideOf(user, n) {
  if (user.type === 'hospital_user' && user.hospitalId === n.buyer_id) return 'buyer';
  if (user.type === 'supplier_user' && user.supplierId === n.supplier_id) return 'supplier';
  return null;
}

async function loadFor(conn, req, { lock = false } = {}) {
  const [[n]] = await conn.query(`SELECT * FROM negotiations WHERE negotiation_id = ? ${lock ? 'FOR UPDATE' : ''}`, [idParam(req)]);
  const side = n && sideOf(req.user, n);
  if (!n || !side) throw new ApiError(404, 'Negotiation not found');
  return { n, side };
}

async function bump(conn, id) {
  const days = await settings.num('negotiation_inactivity_days', 7);
  await conn.query(`UPDATE negotiations SET last_activity_at = NOW(), expires_at = DATE_ADD(NOW(), INTERVAL ? DAY) WHERE negotiation_id = ?`, [days, id]);
}

const startSchema = z.object({
  product_id: z.coerce.number().int().positive(),
  quantity: z.coerce.number().int().min(1).max(100000),
  offer_amount: z.coerce.number().positive('Enter an offer above zero').max(1e9),
  note: optionalStr(1000),
});

router.post('/', asyncHandler(async (req, res) => {
  const u = req.user;
  if (u.type !== 'hospital_user' || !BUYER_ROLES.includes(u.hospitalRole)) throw new ApiError(403, 'Your role cannot start a negotiation');
  const d = startSchema.parse(req.body);
  const min = await settings.num('negotiation_min_unit_price', 5000);

  const out = await withTransaction(async (conn) => {
    const [[p]] = await conn.query(
      `SELECT p.* FROM products p JOIN suppliers s ON s.id = p.supplier_id JOIN supplier_verification sv ON sv.supplier_id = s.id
        WHERE p.id = ? AND p.status = 'approved' AND s.account_status = 'active' AND sv.verification_status = 'verified'`, [d.product_id]);
    if (!p) throw new ApiError(404, 'Product not found');
    if (p.unit_price <= min) throw new ApiError(400, `Counter offers are available on items priced above ₹${min.toLocaleString('en-IN')}`);
    if (d.quantity < p.min_order_qty) throw new ApiError(400, `The minimum order quantity is ${p.min_order_qty}`);
    if (d.offer_amount >= p.unit_price) throw new ApiError(400, 'Your offer must be below the listed price. You can add the item to your cart at the listed price instead.');

    const [[open]] = await conn.query(`SELECT negotiation_id FROM negotiations WHERE product_id = ? AND buyer_id = ? AND status = 'open'`, [p.id, u.hospitalId]);
    if (open) throw new ApiError(409, 'You already have an open negotiation for this item', { negotiation_id: open.negotiation_id });

    const days = await settings.num('negotiation_inactivity_days', 7);
    const [r] = await conn.query(
      `INSERT INTO negotiations (product_id, buyer_id, supplier_id, started_by_user_id, quantity, listed_price, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? DAY))`,
      [p.id, u.hospitalId, p.supplier_id, u.id, d.quantity, p.unit_price, days]
    );
    await conn.query(
      `INSERT INTO negotiation_messages (negotiation_id, sender, sender_user_id, offer_amount, note) VALUES (?, 'buyer', ?, ?, ?)`,
      [r.insertId, u.id, d.offer_amount, d.note ?? null]
    );
    await notify.toSupplier(conn, p.supplier_id, { event: 'negotiation_offer', title: `Counter offer on ${p.name}`, body: `Offer ₹${d.offer_amount.toLocaleString('en-IN')} per unit for ${d.quantity}.`, entityType: 'negotiation', entityId: r.insertId });
    await audit(conn, { actorId: u.id, action: 'negotiation.started', entityType: 'negotiation', entityId: r.insertId, ip: req.ip });
    return { id: r.insertId };
  });
  res.status(201).json(out);
}));

router.get('/', asyncHandler(async (req, res) => {
  const u = req.user;
  if (u.type !== 'hospital_user' && u.type !== 'supplier_user') throw new ApiError(403, 'Not allowed');
  await sweepExpired();
  const lockHours = await settings.num('price_lock_hours', 72);
  const buyer = u.type === 'hospital_user';
  const [rows] = await pool.query(
    `SELECT n.negotiation_id AS id, n.status, n.close_reason, n.quantity, n.listed_price, n.agreed_price, n.expires_at, n.last_activity_at, n.closed_at,
            p.name AS product_name, p.slug AS product_slug, ${buyer ? 's.company_name' : 'h.hospital_name'} AS counterparty,
            (SELECT offer_amount FROM negotiation_messages WHERE negotiation_id = n.negotiation_id AND offer_amount IS NOT NULL ORDER BY message_id DESC LIMIT 1) AS latest_offer,
            (SELECT sender FROM negotiation_messages WHERE negotiation_id = n.negotiation_id AND offer_amount IS NOT NULL ORDER BY message_id DESC LIMIT 1) AS latest_offer_by,
            (SELECT COUNT(*) FROM order_items oi WHERE oi.negotiation_id = n.negotiation_id) AS ordered
       FROM negotiations n JOIN products p ON p.id = n.product_id JOIN suppliers s ON s.id = n.supplier_id JOIN hospitals h ON h.id = n.buyer_id
      WHERE ${buyer ? 'n.buyer_id' : 'n.supplier_id'} = ? ORDER BY n.last_activity_at DESC LIMIT 200`,
    [buyer ? u.hospitalId : u.supplierId]
  );
  const me = buyer ? 'buyer' : 'supplier';
  res.json({
    negotiations: rows.map((r) => ({
      ...r,
      awaiting_me: r.status === 'open' && r.latest_offer_by && r.latest_offer_by !== me,
      lock_expires_at: r.status === 'agreed' ? new Date(new Date(r.closed_at).getTime() + lockHours * 3600e3) : null,
    })),
  });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  await sweepExpired();
  const { n, side } = await loadFor(pool, req);
  const [[p]] = await pool.query(
    `SELECT p.id, p.name, p.slug, p.unit_price, p.min_order_qty, s.company_name, h.hospital_name
       FROM products p JOIN suppliers s ON s.id = p.supplier_id JOIN hospitals h ON h.id = ? WHERE p.id = ?`, [n.buyer_id, n.product_id]);
  const [messages] = await pool.query(
    `SELECT message_id AS id, sender, offer_amount, note, is_acceptance, sent_at FROM negotiation_messages WHERE negotiation_id = ? ORDER BY message_id`, [n.negotiation_id]);
  const lockHours = await settings.num('price_lock_hours', 72);
  const lockEnds = n.status === 'agreed' ? new Date(new Date(n.closed_at).getTime() + lockHours * 3600e3) : null;
  const [[ordered]] = await pool.query('SELECT COUNT(*) AS n FROM order_items WHERE negotiation_id = ?', [n.negotiation_id]);
  const [[inCart]] = await pool.query('SELECT COUNT(*) AS n FROM cart_items WHERE negotiation_id = ?', [n.negotiation_id]);
  const last = [...messages].reverse().find((m) => m.offer_amount !== null);
  res.json({
    negotiation: {
      id: n.negotiation_id, status: n.status, close_reason: n.close_reason, quantity: n.quantity, listed_price: n.listed_price,
      agreed_price: n.agreed_price, expires_at: n.expires_at, closed_at: n.closed_at, product: p, side,
      lock_expires_at: lockEnds, lock_hours: lockHours,
      can_add_to_cart: side === 'buyer' && n.status === 'agreed' && lockEnds > new Date() && ordered.n === 0 && inCart.n === 0,
      ordered: ordered.n > 0, in_cart: inCart.n > 0,
      can_accept: n.status === 'open' && !!last && last.sender !== side,
    },
    messages,
  });
}));

const msgSchema = z.object({
  offer_amount: z.preprocess((v) => (v === '' || v == null ? undefined : v), z.coerce.number().positive('Enter an offer above zero').max(1e9).optional()),
  note: optionalStr(1000),
  accept: z.boolean().optional(),
}).refine((v) => v.accept || v.offer_amount !== undefined || v.note, { message: 'Write a message or make an offer' });

router.post('/:id/messages', asyncHandler(async (req, res) => {
  const d = msgSchema.parse(req.body);
  const u = req.user;
  const out = await withTransaction(async (conn) => {
    const { n, side } = await loadFor(conn, req, { lock: true });
    if (side === 'buyer' && !BUYER_ROLES.includes(u.hospitalRole)) throw new ApiError(403, 'Your role cannot negotiate');
    if (n.status === 'open' && new Date(n.expires_at) < new Date()) {
      await conn.query(`UPDATE negotiations SET status = 'closed_no_deal', close_reason = 'expired', closed_at = NOW() WHERE negotiation_id = ?`, [n.negotiation_id]);
      return { expired: true };
    }
    if (n.status !== 'open') throw new ApiError(409, 'This negotiation is closed');
    const [[prod]] = await conn.query('SELECT name FROM products WHERE id = ?', [n.product_id]);
    const other = side === 'buyer' ? 'supplier' : 'buyer';
    const notifyOther = (n2) => (other === 'supplier' ? notify.toSupplier(conn, n.supplier_id, n2) : notify.toHospital(conn, n.buyer_id, n2));

    if (d.accept) {
      const [[last]] = await conn.query(`SELECT sender, offer_amount FROM negotiation_messages WHERE negotiation_id = ? AND offer_amount IS NOT NULL ORDER BY message_id DESC LIMIT 1`, [n.negotiation_id]);
      if (!last || last.sender === side) throw new ApiError(400, 'There is no offer from the other side to accept');
      await conn.query(`INSERT INTO negotiation_messages (negotiation_id, sender, sender_user_id, offer_amount, note, is_acceptance) VALUES (?, ?, ?, ?, ?, 1)`,
        [n.negotiation_id, side, u.id, last.offer_amount, d.note ?? null]);
      await conn.query(`UPDATE negotiations SET status = 'agreed', agreed_price = ?, closed_at = NOW(), last_activity_at = NOW() WHERE negotiation_id = ?`, [last.offer_amount, n.negotiation_id]);
      await notifyOther({ event: 'negotiation_agreed', title: `Price agreed for ${prod.name}`, body: `₹${Number(last.offer_amount).toLocaleString('en-IN')} per unit.`, entityType: 'negotiation', entityId: n.negotiation_id });
      await audit(conn, { actorId: u.id, action: 'negotiation.agreed', entityType: 'negotiation', entityId: n.negotiation_id, newValues: { agreed_price: last.offer_amount }, ip: req.ip });
      return { status: 'agreed', agreed_price: last.offer_amount };
    }

    if (d.offer_amount !== undefined && d.offer_amount > n.listed_price) throw new ApiError(400, 'An offer cannot be above the listed price');
    await conn.query(`INSERT INTO negotiation_messages (negotiation_id, sender, sender_user_id, offer_amount, note) VALUES (?, ?, ?, ?, ?)`,
      [n.negotiation_id, side, u.id, d.offer_amount ?? null, d.note ?? null]);
    await bump(conn, n.negotiation_id);
    await notifyOther({
      event: 'negotiation_offer', title: d.offer_amount !== undefined ? `New offer on ${prod.name}` : `New message on ${prod.name}`,
      body: d.offer_amount !== undefined ? `₹${d.offer_amount.toLocaleString('en-IN')} per unit.` : d.note, entityType: 'negotiation', entityId: n.negotiation_id,
    });
    return { status: 'open' };
  });
  if (out.expired) throw new ApiError(409, 'This negotiation expired after a period of silence. Start a new one.');
  res.status(201).json(out);
}));

router.post('/:id/close', asyncHandler(async (req, res) => {
  await withTransaction(async (conn) => {
    const { n, side } = await loadFor(conn, req, { lock: true });
    if (n.status !== 'open') throw new ApiError(409, 'This negotiation is already closed');
    await conn.query(`UPDATE negotiations SET status = 'closed_no_deal', close_reason = 'walked_away', closed_at = NOW() WHERE negotiation_id = ?`, [n.negotiation_id]);
    const [[prod]] = await conn.query('SELECT name FROM products WHERE id = ?', [n.product_id]);
    const t = { event: 'negotiation_closed', title: `Negotiation ended for ${prod.name}`, entityType: 'negotiation', entityId: n.negotiation_id };
    if (side === 'buyer') await notify.toSupplier(conn, n.supplier_id, t); else await notify.toHospital(conn, n.buyer_id, t);
  });
  res.json({ status: 'closed_no_deal' });
}));

module.exports = { router, sweepExpired };

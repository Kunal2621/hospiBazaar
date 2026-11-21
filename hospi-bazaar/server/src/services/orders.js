'use strict';

// The order engine: creating orders, moving them through their lifecycle, settling payments,
// holding and releasing supplier payouts, and creating warranties. Every function takes a
// transaction connection so a change and its audit/notification rows commit together.
const { ApiError } = require('../utils/errors');
const { audit } = require('../utils/audit');
const { priceLines, gstSplit, round2 } = require('./money');
const settings = require('./settings');
const notify = require('./notify');

const pad = (id) => String(id).padStart(6, '0');

async function setStatus(conn, orderId, to, { by = null, note = null } = {}) {
  const [[o]] = await conn.query('SELECT status FROM orders WHERE id = ? FOR UPDATE', [orderId]);
  if (!o) throw new ApiError(404, 'Order not found');
  await conn.query('UPDATE orders SET status = ? WHERE id = ?', [to, orderId]);
  await conn.query(
    `INSERT INTO order_status_history (order_id, from_status, to_status, changed_by, note) VALUES (?, ?, ?, ?, ?)`,
    [orderId, o.status, to, by, note]
  );
}

/**
 * Create one order for one supplier.
 * items: [{ product_id?, negotiation_id?, item_name, model_number?, quantity, unit_price, gst_rate, warranty_months? }]
 */
async function createOrder(conn, p) {
  if (!p.items?.length) throw new ApiError(400, 'An order needs at least one item');
  const [[supplier]] = await conn.query('SELECT state FROM suppliers WHERE id = ?', [p.supplierId]);
  if (!supplier) throw new ApiError(404, 'Supplier not found');

  const { lines, subtotal, gst_total } = priceLines(p.items);
  const freight = round2(p.freight || 0);
  const install = round2(p.installation || 0);
  const service = round2(p.service || 0);
  const total = round2(subtotal + gst_total + freight + install + service);
  const split = gstSplit(supplier.state, p.delivery.state, gst_total);

  const [r] = await conn.query(
    `INSERT INTO orders (hospital_id, supplier_id, placed_by, source, created_via, rfq_id, quotation_id, manual_request_id,
       status, subtotal, gst_total, gst_type, cgst_total, sgst_total, igst_total, freight_charge, installation_charge,
       service_charge, total_amount, installation_required, delivery_address, delivery_city, delivery_state,
       delivery_pincode, payment_terms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [p.hospitalId, p.supplierId, p.placedBy, p.source, p.createdVia || 'online', p.rfqId || null, p.quotationId || null,
      p.manualRequestId || null, p.status || 'pending_supplier_confirmation', subtotal, gst_total, split.gst_type,
      split.cgst_total, split.sgst_total, split.igst_total, freight, install, service, total,
      p.installationRequired ? 1 : 0, p.delivery.address, p.delivery.city, p.delivery.state, p.delivery.pincode,
      p.paymentTerms || null]
  );
  const orderId = r.insertId;
  await conn.query('UPDATE orders SET order_number = ?, po_number = ? WHERE id = ?', [`HB-ORD-${pad(orderId)}`, `HB-PO-${pad(orderId)}`, orderId]);

  for (const l of lines) {
    await conn.query(
      `INSERT INTO order_items (order_id, product_id, negotiation_id, item_name, model_number, quantity, unit_price, gst_rate,
         line_subtotal, line_gst, warranty_months) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [orderId, l.product_id || null, l.negotiation_id || null, l.item_name, l.model_number || null, l.quantity, l.unit_price,
        l.gst_rate, l.line_subtotal, l.line_gst, l.warranty_months || null]
    );
  }
  await conn.query(
    `INSERT INTO order_status_history (order_id, from_status, to_status, changed_by, note) VALUES (?, NULL, ?, ?, ?)`,
    [orderId, p.status || 'pending_supplier_confirmation', p.placedBy, p.createdVia === 'manual_admin' ? 'Created by the Hospi Bazaar team' : 'Order placed']
  );

  const number = `HB-ORD-${pad(orderId)}`;
  await notify.toSupplier(conn, p.supplierId, { event: 'order_placed', title: `New order ${number}`, body: 'Review and confirm the order.', entityType: 'order', entityId: orderId });
  await notify.toHospital(conn, p.hospitalId, { event: 'order_placed', title: `Order ${number} placed`, body: 'Waiting for the supplier to confirm.', entityType: 'order', entityId: orderId });
  await audit(conn, { actorId: p.placedBy, action: 'order.created', entityType: 'order', entityId: orderId, newValues: { total, source: p.source, created_via: p.createdVia || 'online' } });
  return { id: orderId, order_number: number, total_amount: total, subtotal, gst_total };
}

/** Create the held payout row once an order is fully paid. Fee applies to the goods value (before GST). */
async function ensurePayout(conn, order) {
  const [[existing]] = await conn.query('SELECT id FROM supplier_payouts WHERE order_id = ?', [order.id]);
  if (existing) return;
  const rate = await settings.num('platform_fee_percent', 3);
  const fee = round2((order.subtotal * rate) / 100);
  await conn.query(
    `INSERT INTO supplier_payouts (order_id, supplier_id, gross_amount, platform_fee_rate, platform_fee, net_amount, status)
     VALUES (?, ?, ?, ?, ?, ?, 'held')`,
    [order.id, order.supplier_id, order.total_amount, rate, fee, round2(order.total_amount - fee)]
  );
}

/** Mark the order paid when captured payments cover the total. Returns true if it just became paid. */
async function settleIfPaid(conn, orderId, byUserId = null) {
  const [[order]] = await conn.query('SELECT * FROM orders WHERE id = ? FOR UPDATE', [orderId]);
  if (!order || order.status !== 'payment_pending') return false;
  const [[sum]] = await conn.query(`SELECT COALESCE(SUM(amount), 0) AS paid FROM payments WHERE order_id = ? AND status = 'captured'`, [orderId]);
  if (sum.paid + 0.005 < order.total_amount) return false;

  await setStatus(conn, orderId, 'paid', { by: byUserId, note: 'Payment received' });
  await ensurePayout(conn, order);
  await notify.toSupplier(conn, order.supplier_id, { event: 'order_paid', title: `${order.order_number} is paid`, body: 'You can dispatch the goods now.', entityType: 'order', entityId: orderId });
  await notify.toHospital(conn, order.hospital_id, { event: 'order_paid', title: `Payment received for ${order.order_number}`, entityType: 'order', entityId: orderId });
  return true;
}

/** Record a captured gateway payment (from checkout verification or webhook). Safe to call twice. */
async function captureGatewayPayment(conn, { razorpayOrderId, razorpayPaymentId, method = null, payload = null }) {
  const [[pay]] = await conn.query('SELECT * FROM payments WHERE razorpay_order_id = ? FOR UPDATE', [razorpayOrderId]);
  if (!pay) throw new ApiError(404, 'Payment not found');
  if (pay.status === 'captured') return { orderId: pay.order_id, already: true };
  await conn.query(
    `UPDATE payments SET status = 'captured', razorpay_payment_id = ?, method = ?, is_emi = ?, captured_at = NOW(), gateway_payload = ? WHERE id = ?`,
    [razorpayPaymentId, method, method === 'emi' ? 1 : 0, payload ? JSON.stringify(payload) : null, pay.id]
  );
  await settleIfPaid(conn, pay.order_id);
  return { orderId: pay.order_id, already: false };
}

/** Delivery and installation confirmed: complete the order, release the payout for admin, create warranties. */
async function completeOrder(conn, orderId, { by = null, note = 'Delivery confirmed' } = {}) {
  const [[order]] = await conn.query('SELECT * FROM orders WHERE id = ? FOR UPDATE', [orderId]);
  await setStatus(conn, orderId, 'completed', { by, note });

  const [[open]] = await conn.query(`SELECT COUNT(*) AS n FROM order_disputes WHERE order_id = ? AND status = 'open'`, [orderId]);
  if (open.n === 0) {
    await conn.query(`UPDATE supplier_payouts SET status = 'eligible', eligible_at = NOW() WHERE order_id = ? AND status = 'held'`, [orderId]);
  }

  const [[delivery]] = await conn.query('SELECT delivered_at, installed_at FROM deliveries WHERE order_id = ?', [orderId]);
  const base = delivery?.installed_at || delivery?.delivered_at || new Date();
  const [items] = await conn.query('SELECT * FROM order_items WHERE order_id = ? AND warranty_months > 0', [orderId]);
  for (const it of items) {
    await conn.query(
      `INSERT INTO warranties (order_item_id, hospital_id, supplier_id, product_id, model_number, purchase_date, installation_date,
         warranty_months, expires_on) VALUES (?, ?, ?, ?, ?, CURDATE(), ?, ?, DATE_ADD(DATE(?), INTERVAL ? MONTH))`,
      [it.id, order.hospital_id, order.supplier_id, it.product_id, it.model_number, delivery?.installed_at || null, it.warranty_months, base, it.warranty_months]
    );
  }

  await notify.toHospital(conn, order.hospital_id, { event: 'order_completed', title: `${order.order_number} completed`, body: items.length ? 'Warranty details are saved under Warranty and service.' : null, entityType: 'order', entityId: orderId });
  await notify.toSupplier(conn, order.supplier_id, { event: 'order_completed', title: `${order.order_number} completed`, body: 'Your payout is queued for release.', entityType: 'order', entityId: orderId });
  if (open.n === 0) await notify.toAdmins(conn, { event: 'payout_eligible', title: `Payout ready for ${order.order_number}`, entityType: 'order', entityId: orderId }, ['super_admin', 'support']);
}

async function confirmDelivery(conn, orderId, { by = null, system = false } = {}) {
  const [[order]] = await conn.query('SELECT * FROM orders WHERE id = ? FOR UPDATE', [orderId]);
  await conn.query(
    `UPDATE deliveries SET buyer_confirmed_at = NOW(), confirmed_by_system = ?, auto_confirm_at = NULL WHERE order_id = ?`,
    [system ? 1 : 0, orderId]
  );
  if (order.installation_required) {
    await conn.query(`INSERT INTO order_status_history (order_id, from_status, to_status, changed_by, note) VALUES (?, 'delivered', 'delivered', ?, ?)`,
      [orderId, by, system ? 'Delivery auto-confirmed' : 'Delivery confirmed by the hospital']);
    await notify.toSupplier(conn, order.supplier_id, { event: 'delivery_confirmed', title: `Delivery confirmed for ${order.order_number}`, body: 'Mark installation once it is done.', entityType: 'order', entityId: orderId });
    return 'awaiting_installation';
  }
  await completeOrder(conn, orderId, { by, note: system ? 'Delivery auto-confirmed' : 'Delivery confirmed by the hospital' });
  return 'completed';
}

async function confirmInstallation(conn, orderId, { by = null, system = false } = {}) {
  await conn.query(`UPDATE deliveries SET installation_confirmed_at = NOW(), confirmed_by_system = ?, auto_confirm_at = NULL WHERE order_id = ?`, [system ? 1 : 0, orderId]);
  await completeOrder(conn, orderId, { by, note: system ? 'Installation auto-confirmed' : 'Installation confirmed by the hospital' });
}

async function cancelOrder(conn, orderId, { by, reason }) {
  const [[order]] = await conn.query('SELECT * FROM orders WHERE id = ? FOR UPDATE', [orderId]);
  await conn.query('UPDATE orders SET cancelled_reason = ? WHERE id = ?', [reason || null, orderId]);
  await setStatus(conn, orderId, 'cancelled', { by, note: reason || null });
  await conn.query(`UPDATE supplier_payouts SET status = 'reversed' WHERE order_id = ? AND status IN ('held','eligible')`, [orderId]);
  const text = `${order.order_number} was cancelled`;
  await notify.toHospital(conn, order.hospital_id, { event: 'order_cancelled', title: text, body: reason, entityType: 'order', entityId: orderId });
  await notify.toSupplier(conn, order.supplier_id, { event: 'order_cancelled', title: text, body: reason, entityType: 'order', entityId: orderId });
}

module.exports = { setStatus, createOrder, ensurePayout, settleIfPaid, captureGatewayPayment, completeOrder, confirmDelivery, confirmInstallation, cancelOrder };

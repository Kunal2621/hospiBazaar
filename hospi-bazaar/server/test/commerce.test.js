'use strict';

// End-to-end commerce flows against a real database (see api.test.js for how to prepare it).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const bcrypt = require('bcryptjs');

process.env.NODE_ENV = 'test';
const app = require('../src/app');
const { pool } = require('../src/db');
const jobs = require('../src/jobs');

const run = Date.now().toString().slice(-8);
const T = {};      // tokens and ids
let catId;

const api = (method, url, token) => {
  const r = request(app)[method](url);
  return token ? r.set('Authorization', `Bearer ${token}`) : r;
};

async function registerHospital() {
  const email = `buyer.${run}@wellcare.in`;
  const res = await api('post', '/api/auth/register/hospital').send({
    hospital: {
      hospital_name: 'Wellcare Hospital', hospital_type: 'private', registration_number: `WC-${run}`, registered_address: '5 Link Road',
      city: 'Bhopal', state: 'Madhya Pradesh', pincode: '462001', phone: '0755123456', email: `info.${run}@wellcare.in`,
      contact_person_name: 'Dr Mehta', contact_person_designation: 'Director', contact_person_mobile: '9876543211', contact_person_email: email,
      gstin: '23WELLC7777F1Z5', pan: 'WELLC7777F',
    },
    user: { full_name: 'Dr Mehta', email, mobile: '9876543211', password: 'Secret123' },
    terms_accepted: true,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  await pool.query(`UPDATE hospitals SET verification_status = 'verified' WHERE id = ?`, [res.body.user.hospitalId]);
  return { token: res.body.token, hospitalId: res.body.user.hospitalId };
}

async function registerSupplier(tag, gstin) {
  const email = `sales.${tag}.${run}@suppliers.in`;
  const res = await api('post', '/api/auth/register/supplier').send({
    supplier: {
      company_name: `Supplier ${tag}`, supplier_type: 'manufacturer', registered_address: 'Plot 4', city: 'Pune', state: 'Maharashtra', pincode: '411001',
      phone: '02012345678', email, pan: 'AAACM1234B', gstin, business_proof_type: 'udyam', business_proof_number: 'UDYAM-MH-01-0000001',
      has_own_factory: true, factory_address: 'Plot 4, Pune', trademark_number: 'TM1',
    },
    user: { full_name: `Sales ${tag}`, email, mobile: '9123456781', password: 'Secret123' },
    categories: [catId], brands: ['Acme'], service_locations: [{ state: 'Madhya Pradesh', city: 'Bhopal' }],
    bank: { account_holder_name: 'Acme Pvt Ltd', account_number: '123456789012', ifsc: 'HDFC0001234', cancelled_cheque_url: 'https://files.example.com/c.pdf' },
    documents: [{ document_type: 'factory_license', file_url: 'https://files.example.com/f.pdf' }],
    terms_accepted: true,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  await pool.query(`UPDATE supplier_verification SET verification_status = 'verified' WHERE supplier_id = ?`, [res.body.user.supplierId]);
  await pool.query(`UPDATE suppliers SET account_status = 'active' WHERE id = ?`, [res.body.user.supplierId]);
  return { token: res.body.token, supplierId: res.body.user.supplierId };
}

const productBody = (over = {}) => ({
  category_id: catId, brand: 'Acme', name: `ICU Bed ${run}`, model_number: 'ICU-1', short_description: 'Five function ICU bed',
  specifications: { Motors: '5' }, unit_price: 100000, gst_rate: 12, stock_status: 'in_stock', min_order_qty: 1,
  warranty_months: 12, installation_available: false, logistics_type: 'large_equipment', ...over,
});

const deliveryBody = { delivery_address: '5 Link Road', delivery_city: 'Bhopal', delivery_state: 'Madhya Pradesh', delivery_pincode: '462001' };

async function liveProduct(supplierToken, over = {}) {
  const c = await api('post', '/api/supplier/products', supplierToken).send(productBody(over));
  assert.equal(c.status, 201, JSON.stringify(c.body));
  assert.equal((await api('post', `/api/supplier/products/${c.body.id}/submit`, supplierToken)).status, 200);
  const ok = await api('post', `/api/admin/products/${c.body.id}/approve`, T.admin);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  return c.body.id;
}

/** Walk an order from "paid" to completed. */
async function fulfil(orderId, { install = false } = {}) {
  assert.equal((await api('post', `/api/orders/${orderId}/dispatch`, T.s1).send({ carrier_name: 'VRL Logistics', tracking_reference: 'VRL123', supplier_invoice_number: 'INV-1' })).status, 200);
  assert.equal((await api('post', `/api/orders/${orderId}/mark-delivered`, T.s1)).status, 200);
  const done = await api('post', `/api/orders/${orderId}/confirm-delivery`, T.h);
  assert.equal(done.status, 200, JSON.stringify(done.body));
  return done.body.result;
}

async function payOnline(orderId) {
  const pay = await api('post', `/api/orders/${orderId}/pay`, T.h);
  assert.equal(pay.status, 200, JSON.stringify(pay.body));
  assert.equal(pay.body.mode, 'mock');
  const cap = await api('post', '/api/payments/mock-capture', T.h).send({ razorpay_order_id: pay.body.razorpay_order_id });
  assert.equal(cap.status, 200, JSON.stringify(cap.body));
  return pay.body;
}

before(async () => {
  const [[c]] = await pool.query(`SELECT id FROM categories WHERE slug = 'hospital-beds'`);
  catId = c.id;
  const hash = await bcrypt.hash('AdminPass1', 4);
  await pool.query(`INSERT INTO users (full_name, email, mobile, password_hash, user_type, admin_role) VALUES ('Root', ?, '9000000001', ?, 'admin', 'super_admin')`, [`root.${run}@hb.test`, hash]);
  T.admin = (await api('post', '/api/auth/login').send({ email: `root.${run}@hb.test`, password: 'AdminPass1' })).body.token;
  const h = await registerHospital(); T.h = h.token; T.hospitalId = h.hospitalId;
  const s1 = await registerSupplier('one', '27AAACM7777B1Z5'); T.s1 = s1.token; T.s1Id = s1.supplierId;
  const s2 = await registerSupplier('two', '27AAACM8888B1Z6'); T.s2 = s2.token; T.s2Id = s2.supplierId;
});
after(async () => { await pool.end(); });

test('catalogue: product approval gates the public marketplace', async () => {
  const c = await api('post', '/api/supplier/products', T.s1).send(productBody());
  assert.equal(c.status, 201, JSON.stringify(c.body));
  T.pid = c.body.id;
  assert.equal((await api('get', `/api/products?q=ICU`)).body.products.length, 0, 'drafts are hidden');
  assert.equal((await api('post', `/api/supplier/products/${T.pid}/submit`, T.s1)).status, 200);
  assert.equal((await api('post', `/api/admin/products/${T.pid}/approve`, T.s1)).status, 403);
  const pending = await api('get', '/api/admin/products', T.admin);
  assert.ok(pending.body.products.some((p) => p.id === T.pid));
  assert.equal((await api('post', `/api/admin/products/${T.pid}/approve`, T.admin)).status, 200);
  const list = await api('get', '/api/products?q=ICU');
  assert.equal(list.body.products.length, 1);
  const detail = await api('get', `/api/products/${list.body.products[0].slug}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.product.negotiable, true);
});

test('RFQ to completed order, payout, warranty and service request', async () => {
  const rfq = await api('post', '/api/rfqs', T.h).send({
    title: 'ICU beds for the new wing', ...deliveryBody, installation_required: false,
    items: [{ category_id: catId, item_name: 'ICU bed', quantity: 2 }],
  });
  assert.equal(rfq.status, 201, JSON.stringify(rfq.body));
  const rfqId = rfq.body.id;
  const seen = await api('get', '/api/supplier/rfqs', T.s1);
  assert.ok(seen.body.rfqs.some((r) => r.id === rfqId));

  const detail = await api('get', `/api/supplier/rfqs/${rfqId}`, T.s1);
  const itemId = detail.body.items[0].id;
  const quote = (price) => ({ delivery_days: 10, valid_until: new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10), warranty_months: 12, freight_charge: 0, installation_charge: 0, service_charge: 0, items: [{ rfq_item_id: itemId, unit_price: price, gst_rate: 12 }] });
  assert.equal((await api('post', `/api/supplier/rfqs/${rfqId}/quote`, T.s1).send(quote(50000))).status, 201);
  assert.equal((await api('post', `/api/supplier/rfqs/${rfqId}/quote`, T.s2).send(quote(52000))).status, 201);

  const cmp = await api('get', `/api/rfqs/${rfqId}`, T.h);
  assert.equal(cmp.body.quotations.length, 2);
  const q1 = cmp.body.quotations.find((q) => q.supplier_id === T.s1Id);

  const accepted = await api('post', `/api/rfqs/${rfqId}/accept`, T.h).send({ quotation_id: q1.id });
  assert.equal(accepted.status, 201, JSON.stringify(accepted.body));
  const orderId = accepted.body.order.id;
  assert.equal(accepted.body.order.total_amount, 112000);

  // Maharashtra supplier to Madhya Pradesh buyer is inter-state: IGST only.
  const o = await api('get', `/api/orders/${orderId}`, T.h);
  assert.equal(o.body.order.gst_type, 'inter_state');
  assert.equal(o.body.order.igst_total, 12000);
  assert.equal(o.body.order.cgst_total, 0);

  // order cannot be paid before the supplier confirms it
  assert.equal((await api('post', `/api/orders/${orderId}/pay`, T.h)).status, 409);
  assert.equal((await api('post', `/api/orders/${orderId}/confirm`, T.s2)).status, 404, 'other supplier cannot see it');
  assert.equal((await api('post', `/api/orders/${orderId}/confirm`, T.s1).send({})).status, 200);

  await payOnline(orderId);
  const paid = await api('get', `/api/orders/${orderId}`, T.s1);
  assert.equal(paid.body.order.status, 'paid');
  assert.equal(paid.body.payout.status, 'held');
  assert.equal(paid.body.payout.platform_fee, 3000, '3% of goods value 100000');
  assert.equal(paid.body.payout.net_amount, 109000);
  assert.deepEqual(paid.body.actions, ['dispatch']);

  assert.equal(await fulfil(orderId), 'completed');
  const done = await api('get', `/api/orders/${orderId}`, T.s1);
  assert.equal(done.body.order.status, 'completed');
  assert.equal(done.body.payout.status, 'eligible');

  // admin releases the payout
  const payouts = await api('get', '/api/admin/payouts?status=eligible', T.admin);
  const po = payouts.body.payouts.find((p) => p.order_id === orderId);
  assert.ok(po);
  assert.equal((await api('post', `/api/admin/payouts/${po.id}/release`, T.admin).send({})).status, 400);
  assert.equal((await api('post', `/api/admin/payouts/${po.id}/release`, T.admin).send({ bank_reference: 'UTR123456' })).status, 200);
  assert.equal((await api('post', `/api/admin/payouts/${po.id}/release`, T.admin).send({ bank_reference: 'UTR123456' })).status, 409);

  // warranty and service
  const w = await api('get', '/api/warranties', T.h);
  assert.equal(w.body.warranties.length, 1);
  const wid = w.body.warranties[0].id;
  assert.equal((await api('patch', `/api/warranties/${wid}`, T.h).send({ serial_number: 'SN-001', installation_date: '2026-11-01' })).status, 200);
  const sr = await api('post', '/api/service-requests', T.h).send({ warranty_id: wid, issue_summary: 'Motor makes noise', priority: 'high' });
  assert.equal(sr.status, 201, JSON.stringify(sr.body));
  assert.match(sr.body.ticket_number, /^HB-SR-\d{6}$/);
  assert.equal((await api('post', `/api/service-requests/${sr.body.id}/updates`, T.s1).send({ message: 'Engineer booked for Monday', status: 'in_progress' })).status, 201);
  assert.equal((await api('post', `/api/service-requests/${sr.body.id}/updates`, T.h).send({ message: 'Thanks', status: 'resolved' })).status, 403);
  assert.equal((await api('post', `/api/service-requests/${sr.body.id}/close`, T.h)).status, 200);
  assert.equal((await api('get', `/api/service-requests/${sr.body.id}`, T.s2)).status, 404);

  // notifications reached both sides
  const n = await api('get', '/api/notifications', T.h);
  assert.ok(n.body.unread > 0);
  await api('post', '/api/notifications/read-all', T.h);
  assert.equal((await api('get', '/api/notifications/unread-count', T.h)).body.unread, 0);

  const sum = await api('get', '/api/summary', T.s1);
  assert.equal(sum.status, 200);
  assert.equal((await api('get', '/api/summary', T.h)).body.warranties_expiring >= 0, true);
});

test('negotiation, price lock and cart checkout', async () => {
  const start = await api('post', '/api/negotiations', T.h).send({ product_id: T.pid, quantity: 3, offer_amount: 90000, note: 'Bulk of 3' });
  assert.equal(start.status, 201, JSON.stringify(start.body));
  const nid = start.body.id;
  assert.equal((await api('post', '/api/negotiations', T.h).send({ product_id: T.pid, quantity: 3, offer_amount: 91000 })).status, 409, 'one open negotiation per product');
  const counter = await api('post', `/api/negotiations/${nid}/messages`, T.s1).send({ offer_amount: 95000 });
  assert.equal(counter.status, 201, JSON.stringify(counter.body));
  assert.equal((await api('post', `/api/negotiations/${nid}/messages`, T.h).send({ accept: true })).status, 201);
  const view = await api('get', `/api/negotiations/${nid}`, T.h);
  assert.equal(view.body.negotiation.status, 'agreed');
  assert.equal(view.body.negotiation.agreed_price, 95000);

  assert.equal((await api('post', '/api/cart/items/negotiated', T.h).send({ negotiation_id: nid })).status, 201);
  assert.equal((await api('post', '/api/cart/items/negotiated', T.h).send({ negotiation_id: nid })).status, 409, 'agreed price used once');
  let cart = await api('get', '/api/cart', T.h);
  assert.equal(cart.body.items[0].unit_price, 95000);
  assert.equal(cart.body.subtotal, 285000);
  const line = cart.body.items[0].id;
  assert.equal((await api('patch', `/api/cart/items/${line}`, T.h).send({ quantity: 5 })).status, 409, 'quantity fixed for a negotiated price');

  // an expired price lock reverts to the listed price
  await pool.query('UPDATE cart_items SET price_locked_until = DATE_SUB(NOW(), INTERVAL 1 HOUR) WHERE id = ?', [line]);
  cart = await api('get', '/api/cart', T.h);
  assert.equal(cart.body.items[0].unit_price, 100000);
  assert.equal(cart.body.items[0].price_reverted, true);
  await pool.query('UPDATE cart_items SET price_locked_until = DATE_ADD(NOW(), INTERVAL 1 HOUR), unit_price = 95000 WHERE id = ?', [line]);

  // 3 x 95,000 + 12% = 3,19,200: under the cap, so it becomes an order
  const out = await api('post', '/api/cart/checkout', T.h).send({ ...deliveryBody });
  assert.equal(out.status, 201, JSON.stringify(out.body));
  assert.equal(out.body.orders.length, 1);
  assert.equal(out.body.orders[0].total_amount, 319200);
  assert.equal((await api('get', '/api/cart', T.h)).body.items.length, 0);
  T.cartOrder = out.body.orders[0].id;
});

test('order above the online cap becomes a manual order with offline payments', async () => {
  assert.equal((await api('post', '/api/cart/items', T.h).send({ product_id: T.pid, quantity: 5 })).status, 201);
  const cart = await api('get', '/api/cart', T.h);
  assert.equal(cart.body.over_cap, true);
  const out = await api('post', '/api/cart/checkout', T.h).send({ ...deliveryBody });
  assert.equal(out.status, 202, JSON.stringify(out.body));
  assert.equal(out.body.manual, true);
  const reqId = out.body.manual_request_id;

  const list = await api('get', '/api/admin/manual-requests', T.admin);
  assert.ok(list.body.requests.some((r) => r.id === reqId));
  assert.equal((await api('patch', `/api/admin/manual-requests/${reqId}`, T.admin).send({ status: 'contacted', admin_notes: 'Called the buyer' })).status, 200);

  const made = await api('post', '/api/admin/orders', T.admin).send({ manual_request_id: reqId, freight: 2000 });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const id = made.body.orders[0].id;
  const o = await api('get', `/api/orders/${id}`, T.h);
  assert.equal(o.body.order.status, 'payment_pending');
  assert.equal(o.body.order.created_via, 'manual_admin');
  assert.equal(o.body.order.total_amount, 562000, '5 x 100,000 + 12% GST + 2,000 freight');
  assert.ok(!o.body.actions.includes('pay'), 'manual orders are not paid online');
  assert.equal((await api('post', `/api/orders/${id}/pay`, T.h)).status, 409);
  assert.equal((await api('post', '/api/admin/orders', T.admin).send({ manual_request_id: reqId })).status, 409, 'request converts once');

  // staged offline payments
  const p1 = await api('post', `/api/admin/orders/${id}/payments`, T.admin).send({ amount: 300000, reference: 'NEFT-1' });
  assert.equal(p1.status, 201);
  assert.equal(p1.body.paid, false);
  assert.equal((await api('post', `/api/admin/orders/${id}/payments`, T.admin).send({ amount: 999999, reference: 'NEFT-X' })).status, 400, 'cannot overpay');
  const p2 = await api('post', `/api/admin/orders/${id}/payments`, T.admin).send({ amount: 262000, reference: 'NEFT-2' });
  assert.equal(p2.body.paid, true);
  assert.equal((await api('get', `/api/orders/${id}`, T.s1)).body.order.status, 'paid');
  T.manualOrder = id;
});

test('disputes block confirmation; admin can release or refund', async () => {
  // order from the cart checkout: confirm, pay, ship, then dispute
  const id = T.cartOrder;
  assert.equal((await api('post', `/api/orders/${id}/confirm`, T.s1).send({})).status, 200);
  await payOnline(id);
  assert.equal((await api('post', `/api/orders/${id}/dispatch`, T.s1).send({ carrier_name: 'Gati', supplier_invoice_number: 'INV-2' })).status, 200);
  assert.equal((await api('post', `/api/orders/${id}/mark-delivered`, T.s1)).status, 200);
  assert.equal((await api('post', `/api/orders/${id}/dispute`, T.h).send({ reason: 'Two beds arrived damaged' })).status, 201);
  assert.equal((await api('post', `/api/orders/${id}/confirm-delivery`, T.h)).status, 409);

  // auto-confirm skips orders with an open dispute
  await pool.query('UPDATE deliveries SET auto_confirm_at = DATE_SUB(NOW(), INTERVAL 1 DAY) WHERE order_id = ?', [id]);
  await jobs.autoConfirmDeliveries();
  assert.equal((await api('get', `/api/orders/${id}`, T.h)).body.order.status, 'delivered');

  const disputes = await api('get', '/api/admin/disputes', T.admin);
  const d = disputes.body.disputes.find((x) => x.order_id === id);
  assert.ok(d);
  const res = await api('post', `/api/admin/disputes/${d.id}/resolve`, T.admin).send({ resolution: 'refund', note: 'Damage confirmed by photos' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const after = await api('get', `/api/orders/${id}`, T.h);
  assert.equal(after.body.order.status, 'cancelled');
  assert.equal(after.body.payments[0].status, 'refunded');
  const [[pay]] = await pool.query('SELECT status FROM supplier_payouts WHERE order_id = ?', [id]);
  assert.equal(pay.status, 'reversed');

  // release path on the manual order
  const m = T.manualOrder;
  assert.equal((await api('post', `/api/orders/${m}/dispatch`, T.s1).send({ carrier_name: 'VRL', supplier_invoice_number: 'INV-3' })).status, 200);
  assert.equal((await api('post', `/api/orders/${m}/mark-delivered`, T.s1)).status, 200);
  assert.equal((await api('post', `/api/orders/${m}/dispute`, T.h).send({ reason: 'Missing accessories in the box' })).status, 201);
  const d2 = (await api('get', '/api/admin/disputes', T.admin)).body.disputes.find((x) => x.order_id === m);
  assert.equal((await api('post', `/api/admin/disputes/${d2.id}/resolve`, T.admin).send({ resolution: 'release', note: 'Accessories were shipped separately' })).status, 200);
  assert.equal((await api('get', `/api/orders/${m}`, T.h)).body.order.status, 'completed');
  const [[pay2]] = await pool.query('SELECT status FROM supplier_payouts WHERE order_id = ?', [m]);
  assert.equal(pay2.status, 'eligible');
});

test('auto-confirm completes an undisputed delivery, and settings are admin-only', async () => {
  const pid = await liveProduct(T.s1, { name: `Bedside locker ${run}`, unit_price: 4000 });
  assert.equal((await api('post', '/api/cart/items', T.h).send({ product_id: pid, quantity: 2 })).status, 201);
  const out = await api('post', '/api/cart/checkout', T.h).send({ ...deliveryBody });
  const id = out.body.orders[0].id;
  assert.equal((await api('post', `/api/orders/${id}/confirm`, T.s1).send({})).status, 200);
  await payOnline(id);
  assert.equal((await api('post', `/api/orders/${id}/dispatch`, T.s1).send({ carrier_name: 'Delhivery', supplier_invoice_number: 'INV-4' })).status, 200);
  assert.equal((await api('post', `/api/orders/${id}/mark-delivered`, T.s1)).status, 200);
  await pool.query('UPDATE deliveries SET auto_confirm_at = DATE_SUB(NOW(), INTERVAL 1 HOUR) WHERE order_id = ?', [id]);
  assert.ok((await jobs.autoConfirmDeliveries()) >= 1);
  const o = await api('get', `/api/orders/${id}`, T.h);
  assert.equal(o.body.order.status, 'completed');
  assert.equal(o.body.delivery.confirmed_by_system, 1);

  assert.equal((await api('get', '/api/admin/settings', T.h)).status, 403);
  assert.equal((await api('put', '/api/admin/settings/online_order_cap', T.admin).send({ value: 'abc' })).status, 400);
  assert.equal((await api('put', '/api/admin/settings/online_order_cap', T.admin).send({ value: 600000 })).status, 200);
  assert.equal((await api('get', '/api/cart', T.h)).body.online_order_cap, 600000);
  await api('put', '/api/admin/settings/online_order_cap', T.admin).send({ value: 500000 });

  const stats = await api('get', '/api/admin/stats', T.admin);
  assert.equal(stats.status, 200);
  assert.equal(typeof stats.body.orders_in_progress, 'number');
});

test('payment webhook and verification reject bad signatures', async () => {
  assert.equal((await api('post', '/api/payments/webhook').send({ event: 'payment.captured' })).status, 400);
  assert.equal((await api('post', '/api/payments/webhook').set('x-razorpay-signature', 'abc').send({ event: 'payment.captured' })).status, 400);
  assert.equal((await api('post', '/api/payments/verify', T.h).send({ razorpay_order_id: 'order_nope1', razorpay_payment_id: 'pay_nope1', razorpay_signature: 'x'.repeat(20) })).status, 404);
});

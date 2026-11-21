'use strict';

const express = require('express');
const { pool, withTransaction } = require('../db');
const { z } = require('../utils/validation');
const { ApiError, asyncHandler } = require('../utils/errors');
const { audit } = require('../utils/audit');
const payments = require('../services/payments');
const orders = require('../services/orders');
const { authenticate } = require('../middleware/auth');
const { hospitalBuyer } = require('../middleware/guards');

const router = express.Router();

async function ownedPayment(conn, razorpayOrderId, hospitalId) {
  const [[p]] = await conn.query(
    `SELECT p.* FROM payments p JOIN orders o ON o.id = p.order_id WHERE p.razorpay_order_id = ? AND o.hospital_id = ?`, [razorpayOrderId, hospitalId]);
  if (!p) throw new ApiError(404, 'Payment not found');
  return p;
}

// Called by the browser after Razorpay Checkout succeeds. The signature proves the payment is genuine.
router.post('/verify', authenticate, hospitalBuyer, asyncHandler(async (req, res) => {
  const d = z.object({
    razorpay_order_id: z.string().min(5).max(64), razorpay_payment_id: z.string().min(5).max(64),
    razorpay_signature: z.string().min(10).max(200), method: z.string().max(30).optional(),
  }).parse(req.body);
  await ownedPayment(pool, d.razorpay_order_id, req.user.hospitalId);
  if (!payments.verifyPaymentSignature(d.razorpay_order_id, d.razorpay_payment_id, d.razorpay_signature)) {
    throw new ApiError(400, 'We could not verify this payment. If money was deducted, it will be matched automatically within a few minutes.');
  }
  const out = await withTransaction(async (conn) => {
    const r = await orders.captureGatewayPayment(conn, { razorpayOrderId: d.razorpay_order_id, razorpayPaymentId: d.razorpay_payment_id, method: d.method || null });
    await audit(conn, { actorId: req.user.id, action: 'payment.captured', entityType: 'order', entityId: r.orderId, ip: req.ip });
    return r;
  });
  res.json({ ok: true, order_id: out.orderId });
}));

// Mock mode only: stands in for the Razorpay checkout so the full flow can be tried without keys.
router.post('/mock-capture', authenticate, hospitalBuyer, asyncHandler(async (req, res) => {
  if (!payments.isMock()) throw new ApiError(404, 'Not found');
  const { razorpay_order_id } = z.object({ razorpay_order_id: z.string().min(5).max(64) }).parse(req.body);
  await ownedPayment(pool, razorpay_order_id, req.user.hospitalId);
  const out = await withTransaction(async (conn) => {
    const r = await orders.captureGatewayPayment(conn, { razorpayOrderId: razorpay_order_id, razorpayPaymentId: `pay_mock_${Date.now()}`, method: 'mock' });
    await audit(conn, { actorId: req.user.id, action: 'payment.captured_mock', entityType: 'order', entityId: r.orderId, ip: req.ip });
    return r;
  });
  res.json({ ok: true, order_id: out.orderId });
}));

// Razorpay calls this server-to-server. It settles payments even if the browser closed early.
router.post('/webhook', asyncHandler(async (req, res) => {
  const signature = req.get('x-razorpay-signature');
  if (!req.rawBody || !payments.verifyWebhookSignature(req.rawBody, signature)) throw new ApiError(400, 'Invalid signature');
  const event = req.body?.event;
  const entity = req.body?.payload?.payment?.entity;
  if (entity?.order_id) {
    await withTransaction(async (conn) => {
      if (event === 'payment.captured') {
        await orders.captureGatewayPayment(conn, { razorpayOrderId: entity.order_id, razorpayPaymentId: entity.id, method: entity.method || null, payload: entity });
      } else if (event === 'payment.failed') {
        await conn.query(`UPDATE payments SET status = 'failed', failure_reason = ?, gateway_payload = ? WHERE razorpay_order_id = ? AND status = 'created'`,
          [String(entity.error_description || 'Payment failed').slice(0, 500), JSON.stringify(entity), entity.order_id]);
      }
    });
  }
  res.json({ ok: true });
}));

module.exports = router;

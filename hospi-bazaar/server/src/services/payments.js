'use strict';

// Razorpay wrapper. Real mode calls Razorpay's REST API; mock mode simulates it so the whole
// flow can be tried without keys. Switch with RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET.
const crypto = require('crypto');
const config = require('../config');
const { toPaise } = require('./money');

const MOCK_SECRET = 'mock-secret-not-for-production';
const isMock = () => config.payments.mode === 'mock';
const secret = () => (isMock() ? MOCK_SECRET : config.payments.keySecret);

function hmac(data, key) { return crypto.createHmac('sha256', key).update(data).digest('hex'); }

function safeEqual(a, b) {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

const verifyPaymentSignature = (orderId, paymentId, signature) => safeEqual(hmac(`${orderId}|${paymentId}`, secret()), signature || '');
const verifyWebhookSignature = (rawBody, signature) => (!isMock() && !config.payments.webhookSecret ? false : safeEqual(hmac(rawBody, isMock() ? MOCK_SECRET : config.payments.webhookSecret), signature || ''));
/** Used by mock mode (and tests) to produce a valid checkout signature. */
const signForMock = (orderId, paymentId) => hmac(`${orderId}|${paymentId}`, MOCK_SECRET);

async function api(method, path, body) {
  const auth = Buffer.from(`${config.payments.keyId}:${config.payments.keySecret}`).toString('base64');
  const res = await fetch(`https://api.razorpay.com/v1${path}`, {
    method,
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error?.description || 'Payment gateway error');
    err.status = 502;
    throw err;
  }
  return data;
}

/** Create a gateway order for an amount in rupees. */
async function createGatewayOrder({ amount, receipt }) {
  if (isMock()) return { id: `order_mock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, amount: toPaise(amount), currency: 'INR' };
  return api('POST', '/orders', { amount: toPaise(amount), currency: 'INR', receipt, payment_capture: 1 });
}

async function refundPayment({ razorpayPaymentId, amount }) {
  if (isMock() || !razorpayPaymentId || razorpayPaymentId.startsWith('OFFLINE')) {
    return { id: `rfnd_mock_${Date.now()}`, status: 'processed', offline: true };
  }
  return api('POST', `/payments/${razorpayPaymentId}/refund`, { amount: toPaise(amount) });
}

const publicConfig = () => ({ mode: config.payments.mode, key_id: isMock() ? 'mock' : config.payments.keyId });

module.exports = { isMock, createGatewayOrder, refundPayment, verifyPaymentSignature, verifyWebhookSignature, signForMock, publicConfig };

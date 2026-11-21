'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { ZodError } = require('zod');
const config = require('./config');
const { ApiError } = require('./utils/errors');

const app = express();
app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({ origin: config.clientOrigin }));
// The raw body is kept so the Razorpay webhook signature can be checked.
app.use(express.json({ limit: '1mb', verify: (req, _res, buf) => { req.rawBody = buf; } }));
app.use('/uploads', express.static(config.uploadsDir, { index: false, setHeaders: (res) => { res.set('X-Content-Type-Options', 'nosniff'); res.set('Cross-Origin-Resource-Policy', 'cross-origin'); } }));

if (config.env !== 'test') {
  // Slow down password guessing and registration spam.
  app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 100, standardHeaders: true, legacyHeaders: false }));
}

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.use('/api/auth', require('./routes/auth'));
app.use('/api', require('./routes/catalog'));
app.use('/api/suppliers', require('./routes/suppliers'));
app.use('/api/hospitals', require('./routes/hospitals'));
app.use('/api/admin', require('./routes/adminOps'));
app.use('/api/admin', require('./routes/admin'));

const rfqs = require('./routes/rfqs');
const products = require('./routes/products');
app.use('/api/uploads', require('./routes/uploads'));
app.use('/api/supplier/products', products.supplier);
app.use('/api/supplier/rfqs', rfqs.supplier);
app.use('/api/rfqs', rfqs.hospital);
app.use('/api/negotiations', require('./routes/negotiations').router);
app.use('/api/cart', require('./routes/cart'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api', products.market);
app.use('/api', require('./routes/postsale'));

app.use('/api', (_req, _res, next) => next(new ApiError(404, 'Not found')));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err instanceof ZodError) {
    const fields = {};
    for (const issue of err.issues) fields[issue.path.join('.') || '_'] = issue.message;
    return res.status(400).json({ error: 'Please correct the highlighted fields', fields });
  }
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: err.message, ...(err.details ? { details: err.details } : {}) });
  }
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
  if (err.code === 'ER_DUP_ENTRY') {
    const m = String(err.sqlMessage || '');
    let what = 'record';
    if (m.includes('uq_users_email')) what = 'email';
    else if (m.includes('gstin')) what = 'GSTIN';
    return res.status(409).json({ error: `This ${what} is already registered` });
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong' });
});

module.exports = app;

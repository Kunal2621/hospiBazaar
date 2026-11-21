'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const env = process.env.NODE_ENV || 'development';

const jwtSecret = process.env.JWT_SECRET || (env === 'production' ? '' : 'dev-only-secret-change-me');
if (!jwtSecret) {
  throw new Error('JWT_SECRET must be set in production');
}

module.exports = {
  env,
  port: Number(process.env.PORT || 4000),
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'hospi_bazaar',
  },
  jwt: { secret: jwtSecret, expiresIn: process.env.JWT_EXPIRES_IN || '8h' },

  // Uploaded files (local disk). To move to S3 or similar, replace src/services/storage.js.
  uploadsDir: process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads'),
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB || 10),

  // Razorpay. With no keys the app runs in "mock" mode: payments are simulated, nothing leaves your machine.
  payments: {
    keyId: process.env.RAZORPAY_KEY_ID || '',
    keySecret: process.env.RAZORPAY_KEY_SECRET || '',
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || '',
    mode: process.env.PAYMENT_MODE || (process.env.RAZORPAY_KEY_ID ? 'razorpay' : 'mock'),
  },

  // Email notifications are sent only when SMTP_HOST is set. In-app notifications always work.
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT || 587),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || 'Hospi Bazaar <no-reply@hospibazaar.example>',
  },
  runJobs: process.env.RUN_JOBS !== 'false',
};

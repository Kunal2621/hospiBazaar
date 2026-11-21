'use strict';

// Background work. Every job is safe to run twice, so a restart or a second server does no harm.
const nodemailer = require('nodemailer');
const config = require('./config');
const { pool, withTransaction } = require('./db');
const orders = require('./services/orders');
const notify = require('./services/notify');
const { sweepExpired } = require('./routes/negotiations');

async function expireQuotations() {
  const [rows] = await pool.query(`SELECT id FROM quotations WHERE status = 'submitted' AND valid_until < CURDATE()`);
  for (const q of rows) await pool.query(`UPDATE quotations SET status = 'expired' WHERE id = ? AND status = 'submitted'`, [q.id]);
  return rows.length;
}

/** Buyer never confirmed in time: confirm for them, unless a dispute is open. */
async function autoConfirmDeliveries() {
  const [rows] = await pool.query(
    `SELECT d.order_id, o.status FROM deliveries d JOIN orders o ON o.id = d.order_id
      WHERE d.auto_confirm_at IS NOT NULL AND d.auto_confirm_at <= NOW() AND o.status IN ('delivered','installed')
        AND NOT EXISTS (SELECT 1 FROM order_disputes x WHERE x.order_id = o.id AND x.status = 'open')`);
  let n = 0;
  for (const r of rows) {
    await withTransaction(async (conn) => {
      const [[o]] = await conn.query('SELECT status FROM orders WHERE id = ? FOR UPDATE', [r.order_id]);
      if (o.status === 'delivered') await orders.confirmDelivery(conn, r.order_id, { system: true });
      else if (o.status === 'installed') await orders.confirmInstallation(conn, r.order_id, { system: true });
      else return;
      n += 1;
    });
  }
  return n;
}

let transport;
async function sendPendingEmails() {
  if (!config.smtp.host) return 0;
  transport ||= nodemailer.createTransport({
    host: config.smtp.host, port: config.smtp.port, secure: config.smtp.port === 465,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });
  const [rows] = await pool.query(
    `SELECT n.id, n.title, n.body, u.email FROM notifications n JOIN users u ON u.id = n.user_id
      WHERE n.channel = 'email' AND n.status = 'pending' ORDER BY n.id LIMIT 50`);
  for (const r of rows) {
    try {
      await transport.sendMail({ from: config.smtp.from, to: r.email, subject: r.title, text: r.body || r.title });
      await pool.query(`UPDATE notifications SET status = 'sent', sent_at = NOW() WHERE id = ?`, [r.id]);
    } catch (e) {
      console.error('Email failed', r.id, e.message);
      await pool.query(`UPDATE notifications SET status = 'failed' WHERE id = ?`, [r.id]);
    }
  }
  return rows.length;
}

async function runAll() {
  const out = {};
  for (const [name, fn] of Object.entries({ negotiations: sweepExpired, quotations: expireQuotations, deliveries: autoConfirmDeliveries, emails: sendPendingEmails })) {
    try { out[name] = await fn(); } catch (e) { console.error(`Job ${name} failed:`, e.message); }
  }
  return out;
}

function start(everyMs = 5 * 60 * 1000) {
  const t = setInterval(runAll, everyMs);
  t.unref();
  setTimeout(runAll, 5000).unref();
}

module.exports = { runAll, start, expireQuotations, autoConfirmDeliveries, sendPendingEmails };

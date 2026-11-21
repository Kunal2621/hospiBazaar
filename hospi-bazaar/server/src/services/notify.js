'use strict';

// In-app notifications are written in the same transaction as the change that caused them.
// When SMTP is configured an email row is queued too; the background job sends it.
const config = require('../config');

async function hospitalUserIds(conn, hospitalId) {
  const [rows] = await conn.query(`SELECT user_id FROM hospital_users WHERE hospital_id = ? AND status = 'active'`, [hospitalId]);
  return rows.map((r) => r.user_id);
}
async function supplierUserIds(conn, supplierId) {
  const [rows] = await conn.query(`SELECT user_id FROM supplier_users WHERE supplier_id = ? AND status = 'active'`, [supplierId]);
  return rows.map((r) => r.user_id);
}
async function adminUserIds(conn, roles = ['super_admin', 'verifier', 'support']) {
  const [rows] = await conn.query(`SELECT id FROM users WHERE user_type = 'admin' AND status = 'active' AND admin_role IN (?)`, [roles]);
  return rows.map((r) => r.id);
}

async function notifyUsers(conn, userIds, { event, title, body = null, entityType = null, entityId = null }) {
  const ids = [...new Set(userIds)];
  for (const userId of ids) {
    await conn.query(
      `INSERT INTO notifications (user_id, channel, event_type, title, body, entity_type, entity_id, status, sent_at)
       VALUES (?, 'in_app', ?, ?, ?, ?, ?, 'sent', NOW())`,
      [userId, event, title, body, entityType, entityId]
    );
    if (config.smtp.host) {
      await conn.query(
        `INSERT INTO notifications (user_id, channel, event_type, title, body, entity_type, entity_id, status)
         VALUES (?, 'email', ?, ?, ?, ?, ?, 'pending')`,
        [userId, event, title, body, entityType, entityId]
      );
    }
  }
}

const toHospital = async (conn, hospitalId, n) => notifyUsers(conn, await hospitalUserIds(conn, hospitalId), n);
const toSupplier = async (conn, supplierId, n) => notifyUsers(conn, await supplierUserIds(conn, supplierId), n);
const toAdmins = async (conn, n, roles) => notifyUsers(conn, await adminUserIds(conn, roles), n);

module.exports = { notifyUsers, toHospital, toSupplier, toAdmins, hospitalUserIds, supplierUserIds, adminUserIds };

'use strict';

/** Write an audit_logs row. Pass the transaction connection so the log commits with the change. */
async function audit(conn, { actorId = null, action, entityType, entityId = null, oldValues = null, newValues = null, ip = null }) {
  await conn.query(
    `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, old_values, new_values, ip_address)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      actorId, action, entityType, entityId,
      oldValues === null ? null : JSON.stringify(oldValues),
      newValues === null ? null : JSON.stringify(newValues),
      ip,
    ]
  );
}

module.exports = { audit };

'use strict';

// Who may open a private file, and how private files get attached to records.
const { pool } = require('../db');
const { ApiError } = require('../utils/errors');

const PRIVATE_REF = /^\/files\/([a-f0-9]{32}\.[a-z]+)$/;
const privateName = (url) => PRIVATE_REF.exec(url || '')?.[1] || null;

/**
 * Private files attached to a record must be the caller's own upload. A file uploaded during sign-up
 * has no owner yet, so the new account claims it. Pass a transaction connection or the pool.
 */
async function attachPrivate(db, urls, userId) {
  for (const url of new Set(urls.filter(Boolean))) {
    const name = privateName(url);
    if (!name) continue;
    const [claimed] = await db.query(
      `UPDATE uploaded_files SET uploaded_by = ? WHERE stored_name = ? AND visibility = 'private' AND uploaded_by IS NULL`, [userId, name]);
    if (claimed.affectedRows) continue;
    const [[f]] = await db.query(`SELECT uploaded_by FROM uploaded_files WHERE stored_name = ? AND visibility = 'private'`, [name]);
    if (!f || Number(f.uploaded_by) !== Number(userId)) throw new ApiError(400, 'One of the uploaded files cannot be used. Upload it again.');
  }
}

/** file: a row of uploaded_files. user: the signed-in user's context. */
async function canView(user, file) {
  if (file.visibility === 'public') return true;
  if (user.type === 'admin') return true;
  if (Number(file.uploaded_by) === Number(user.id)) return true;
  const url = `/files/${file.stored_name}`;
  if (user.type === 'supplier_user' && user.supplierId) {
    const [rows] = await pool.query(
      `SELECT 1 FROM supplier_documents WHERE supplier_id = ? AND file_url = ?
       UNION ALL SELECT 1 FROM supplier_bank_accounts WHERE supplier_id = ? AND cancelled_cheque_url = ?
       UNION ALL SELECT 1 FROM orders WHERE supplier_id = ? AND supplier_invoice_url = ? LIMIT 1`,
      [user.supplierId, url, user.supplierId, url, user.supplierId, url]);
    return rows.length > 0;
  }
  if (user.type === 'hospital_user' && user.hospitalId) {
    const [rows] = await pool.query(`SELECT 1 FROM orders WHERE hospital_id = ? AND supplier_invoice_url = ? LIMIT 1`, [user.hospitalId, url]);
    return rows.length > 0;
  }
  return false;
}

module.exports = { attachPrivate, canView, privateName };
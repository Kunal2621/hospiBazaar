'use strict';

const express = require('express');
const { pool, withTransaction } = require('../db');
const { z, url } = require('../utils/validation');
const { ApiError, asyncHandler } = require('../utils/errors');
const { audit } = require('../utils/audit');
const { authenticate, requireType } = require('../middleware/auth');
const { requiredChecks } = require('../utils/verification');

const router = express.Router();
router.use(authenticate, requireType('supplier_user'));

function supplierIdOf(req) {
  if (!req.user.supplierId) throw new ApiError(403, 'No supplier account linked to this user');
  return req.user.supplierId;
}

// GET /api/suppliers/me -> profile, verification status, documents, categories
router.get('/me', asyncHandler(async (req, res) => {
  const id = supplierIdOf(req);
  const [[supplier]] = await pool.query(`SELECT * FROM suppliers WHERE id = ?`, [id]);
  const [[verification]] = await pool.query(
    `SELECT verification_status, rejection_reason, verified_at, updated_at FROM supplier_verification WHERE supplier_id = ?`,
    [id]
  );
  const [documents] = await pool.query(
    `SELECT id, document_type, file_url, valid_until, uploaded_at FROM supplier_documents WHERE supplier_id = ? ORDER BY id`,
    [id]
  );
  const [categories] = await pool.query(
    `SELECT c.id, c.name FROM supplier_categories sc JOIN categories c ON c.id = sc.category_id WHERE sc.supplier_id = ?`,
    [id]
  );
  const [brands] = await pool.query(
    `SELECT b.id, b.name FROM supplier_brands sb JOIN brands b ON b.id = sb.brand_id WHERE sb.supplier_id = ?`,
    [id]
  );
  const [locations] = await pool.query(`SELECT * FROM supplier_service_locations WHERE supplier_id = ?`, [id]);
  res.json({ supplier, verification, documents, categories, brands, service_locations: locations });
}));

// POST /api/suppliers/me/documents -> add a verification document
const docSchema = z.object({
  document_type: z.enum([
    'business_proof', 'factory_license', 'udyam', 'trademark', 'iso_13485', 'cdsco_licence',
    'dealer_authorisation', 'distribution_agreement', 'sourcing_invoice', 'cancelled_cheque', 'service_proof', 'other',
  ]),
  file_url: url,
  valid_until: z.preprocess((v) => (v === '' ? undefined : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
});

router.post('/me/documents', asyncHandler(async (req, res) => {
  const id = supplierIdOf(req);
  const d = docSchema.parse(req.body);
  const [r] = await pool.query(
    `INSERT INTO supplier_documents (supplier_id, document_type, file_url, valid_until) VALUES (?, ?, ?, ?)`,
    [id, d.document_type, d.file_url, d.valid_until ?? null]
  );
  res.status(201).json({ id: r.insertId });
}));

// POST /api/suppliers/me/reapply -> after a rejection, go back to Pending (§19: re-application allowed)
router.post('/me/reapply', asyncHandler(async (req, res) => {
  const id = supplierIdOf(req);
  await withTransaction(async (conn) => {
    const [[v]] = await conn.query(`SELECT verification_status, rejection_reason FROM supplier_verification WHERE supplier_id = ? FOR UPDATE`, [id]);
    if (!v || v.verification_status !== 'rejected') throw new ApiError(409, 'Only a rejected application can be re-submitted');
    await conn.query(
      `UPDATE supplier_verification SET verification_status = 'pending', rejection_reason = NULL,
         checklist = NULL, verified_at = NULL, verified_by = NULL WHERE supplier_id = ?`,
      [id]
    );
    await audit(conn, {
      actorId: req.user.id, action: 'supplier.reapplied', entityType: 'supplier', entityId: id,
      oldValues: { verification_status: 'rejected', rejection_reason: v.rejection_reason },
      newValues: { verification_status: 'pending' }, ip: req.ip,
    });
  });
  res.json({ verification_status: 'pending' });
}));

// GET /api/suppliers/me/checklist -> what the admin will check for this supplier (transparency)
router.get('/me/checklist', asyncHandler(async (req, res) => {
  const id = supplierIdOf(req);
  const [[supplier]] = await pool.query(`SELECT supplier_type, has_own_factory FROM suppliers WHERE id = ?`, [id]);
  const [[eq]] = await pool.query(
    `SELECT COUNT(*) AS n FROM supplier_categories sc JOIN categories c ON c.id = sc.category_id
      WHERE sc.supplier_id = ? AND c.parent_id = (SELECT id FROM categories WHERE slug = 'medical-equipment')`,
    [id]
  );
  res.json({ checks: requiredChecks(supplier, { hasEquipmentCategory: eq.n > 0 }) });
}));

module.exports = router;

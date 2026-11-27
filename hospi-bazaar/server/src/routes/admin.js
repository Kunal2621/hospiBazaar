'use strict';

const express = require('express');
const { pool, withTransaction } = require('../db');
const { z, optionalStr } = require('../utils/validation');
const { ApiError, asyncHandler } = require('../utils/errors');
const { audit } = require('../utils/audit');
const { authenticate, requireType, requireAdminRole } = require('../middleware/auth');
const { requiredChecks, failedChecks } = require('../utils/verification');
const notify = require('../services/notify');

const router = express.Router();
router.use(authenticate, requireType('admin'), requireAdminRole('verifier', 'support'));

const idParam = (req) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, 'Invalid id');
  return id;
};

const maskAccount = (n) => (n && n.length > 4 ? `${'*'.repeat(n.length - 4)}${n.slice(-4)}` : n);

// ------------------------------------------------------------ Suppliers

const SUPPLIER_STATUSES = ['pending', 'under_verification', 'verified', 'rejected'];

// GET /api/admin/suppliers?status=pending
router.get('/suppliers', asyncHandler(async (req, res) => {
  const { status } = req.query;
  if (status && !SUPPLIER_STATUSES.includes(status)) throw new ApiError(400, 'Invalid status');
  const [rows] = await pool.query(
    `SELECT s.id, s.company_name, s.supplier_type, s.city, s.state, s.gstin, s.created_at,
            sv.verification_status, sv.verified_at
       FROM suppliers s JOIN supplier_verification sv ON sv.supplier_id = s.id
      ${status ? 'WHERE sv.verification_status = ?' : ''}
      ORDER BY s.created_at DESC LIMIT 200`,
    status ? [status] : []
  );
  res.json({ suppliers: rows });
}));

// GET /api/admin/suppliers/:id -> everything the verifier needs, plus the required checklist
router.get('/suppliers/:id', asyncHandler(async (req, res) => {
  const id = idParam(req);
  const [[supplier]] = await pool.query(`SELECT * FROM suppliers WHERE id = ?`, [id]);
  if (!supplier) throw new ApiError(404, 'Supplier not found');

  const [[verification]] = await pool.query(`SELECT * FROM supplier_verification WHERE supplier_id = ?`, [id]);
  const [documents] = await pool.query(`SELECT id, document_type, file_url, valid_until, uploaded_at FROM supplier_documents WHERE supplier_id = ? ORDER BY id`, [id]);
  const [bankRows] = await pool.query(`SELECT account_holder_name, account_number, ifsc, cancelled_cheque_url FROM supplier_bank_accounts WHERE supplier_id = ?`, [id]);
  const [categories] = await pool.query(
    `SELECT c.id, c.name, c.parent_id FROM supplier_categories sc JOIN categories c ON c.id = sc.category_id WHERE sc.supplier_id = ?`,
    [id]
  );
  const [brands] = await pool.query(`SELECT b.name FROM supplier_brands sb JOIN brands b ON b.id = sb.brand_id WHERE sb.supplier_id = ?`, [id]);
  const [locations] = await pool.query(`SELECT state, city, address, contact_name, contact_phone FROM supplier_service_locations WHERE supplier_id = ?`, [id]);
  const [terms] = await pool.query(
    `SELECT tv.version, ta.accepted_at FROM terms_acceptances ta JOIN terms_versions tv ON tv.id = ta.terms_version_id WHERE ta.supplier_id = ?`,
    [id]
  );

  const [[eq]] = await pool.query(`SELECT id FROM categories WHERE slug = 'medical-equipment'`);
  const hasEquipmentCategory = categories.some((c) => eq && c.parent_id === eq.id);

  res.json({
    supplier, verification, documents, categories, brands, service_locations: locations, terms_acceptances: terms,
    bank_accounts: bankRows.map((b) => ({ ...b, account_number: maskAccount(b.account_number) })),
    required_checks: requiredChecks(supplier, { hasEquipmentCategory }),
  });
}));

// Shared state-transition helper: locks the verification row, checks the current status, applies the change.
async function transitionSupplier(req, { from, apply, action }) {
  const id = idParam(req);
  return withTransaction(async (conn) => {
    const [[v]] = await conn.query(`SELECT verification_status FROM supplier_verification WHERE supplier_id = ? FOR UPDATE`, [id]);
    if (!v) throw new ApiError(404, 'Supplier not found');
    if (!from.includes(v.verification_status)) {
      throw new ApiError(409, `Cannot do this while the supplier is ${v.verification_status.replace('_', ' ')}`);
    }
    const result = await apply(conn, id);
    await audit(conn, {
      actorId: req.user.id, action, entityType: 'supplier', entityId: id,
      oldValues: { verification_status: v.verification_status }, newValues: result.audit, ip: req.ip,
    });
    return result.response;
  });
}

// POST /api/admin/suppliers/:id/start-verification  Pending -> Under Verification
router.post('/suppliers/:id/start-verification', requireAdminRole('verifier'), asyncHandler(async (req, res) => {
    const [[owner]] = await pool.query(
    `SELECT u.email, u.email_verified_at FROM supplier_users su JOIN users u ON u.id = su.user_id
      WHERE su.supplier_id = ? AND su.role = 'owner' LIMIT 1`, [idParam(req)]);
  if (owner && !owner.email_verified_at) {
    throw new ApiError(409, `${owner.email} has not confirmed their email yet. Ask the supplier to open the link we sent, then start verification.`);
  }
  const out = await transitionSupplier(req, {
    from: ['pending'], action: 'supplier.verification_started',
    apply: async (conn, id) => {
      await conn.query(`UPDATE supplier_verification SET verification_status = 'under_verification', verified_by = ? WHERE supplier_id = ?`, [req.user.id, id]);
            await notify.toSupplier(conn, id, { event: 'supplier_verification_started', title: 'We have started verifying your account',
               body: 'Our team is checking your documents. We will tell you as soon as it is done.' });
      return { audit: { verification_status: 'under_verification' }, response: { verification_status: 'under_verification' } };
    },
  });
  res.json(out);
}));

const verifySchema = z.object({ checklist: z.record(z.boolean()), note: optionalStr(500) });

// POST /api/admin/suppliers/:id/verify  Under Verification -> Verified (every required check must pass)
router.post('/suppliers/:id/verify', requireAdminRole('verifier'), asyncHandler(async (req, res) => {
  const body = verifySchema.parse(req.body);
  const id = idParam(req);

  const [[supplier]] = await pool.query(`SELECT supplier_type, has_own_factory FROM suppliers WHERE id = ?`, [id]);
  if (!supplier) throw new ApiError(404, 'Supplier not found');
  const [[eq]] = await pool.query(
    `SELECT COUNT(*) AS n FROM supplier_categories sc JOIN categories c ON c.id = sc.category_id
      WHERE sc.supplier_id = ? AND c.parent_id = (SELECT id FROM categories WHERE slug = 'medical-equipment')`,
    [id]
  );
  const required = requiredChecks(supplier, { hasEquipmentCategory: eq.n > 0 });
  const failed = failedChecks(required, body.checklist);
  if (failed.length) throw new ApiError(422, 'Every required check must pass before verifying', { failed });

  const out = await transitionSupplier(req, {
    from: ['under_verification'], action: 'supplier.verified',
    apply: async (conn) => {
      await conn.query(
        `UPDATE supplier_verification SET verification_status = 'verified', checklist = ?, verified_at = NOW(),
           verified_by = ?, rejection_reason = NULL WHERE supplier_id = ?`,
        [JSON.stringify(body.checklist), req.user.id, id]
      );
      await conn.query(`UPDATE suppliers SET account_status = 'active' WHERE id = ?`, [id]);
            await notify.toSupplier(conn, id, { event: 'supplier_verified', title: 'Your supplier account is verified', body: 'You can now list products and receive RFQs and orders.' });
      await notify.toAdmins(conn, { event: 'supplier_verified', title: 'A supplier was verified', body: `Verified by ${req.user.fullName || 'an admin'}.`, entityType: 'supplier', entityId: id }, ['super_admin']);
      return { audit: { verification_status: 'verified', checklist: body.checklist }, response: { verification_status: 'verified' } };
    },
  });
  res.json(out);
}));

const rejectSchema = z.object({
  reason: z.string().trim().min(5, 'Give the supplier a clear reason').max(500),
  checklist: z.record(z.boolean()).optional(),
});

// POST /api/admin/suppliers/:id/reject  Under Verification -> Rejected (reason required)
router.post('/suppliers/:id/reject', requireAdminRole('verifier'), asyncHandler(async (req, res) => {
  const body = rejectSchema.parse(req.body);
  const out = await transitionSupplier(req, {
    from: ['under_verification'], action: 'supplier.rejected',
    apply: async (conn, id) => {
      await conn.query(
        `UPDATE supplier_verification SET verification_status = 'rejected', checklist = ?, verified_at = NULL,
           verified_by = ?, rejection_reason = ? WHERE supplier_id = ?`,
        [body.checklist ? JSON.stringify(body.checklist) : null, req.user.id, body.reason, id]
      );
      await conn.query(`UPDATE suppliers SET account_status = 'pending' WHERE id = ?`, [id]);
            await notify.toSupplier(conn, id, { event: 'supplier_rejected', title: 'Your supplier account needs changes', body: body.reason });
      return { audit: { verification_status: 'rejected', reason: body.reason }, response: { verification_status: 'rejected' } };
    },
  });
  res.json(out);
}));

// ------------------------------------------------------------ Hospitals (decision 7)

const HOSPITAL_STATUSES = ['unverified', 'under_review', 'verified', 'rejected'];

router.get('/hospitals', asyncHandler(async (req, res) => {
  const { status } = req.query;
  if (status && !HOSPITAL_STATUSES.includes(status)) throw new ApiError(400, 'Invalid status');
  const [rows] = await pool.query(
    `SELECT id, hospital_name, hospital_type, city, state, gstin, registration_number, verification_status, created_at
       FROM hospitals ${status ? 'WHERE verification_status = ?' : ''} ORDER BY created_at DESC LIMIT 200`,
    status ? [status] : []
  );
  res.json({ hospitals: rows });
}));

router.get('/hospitals/:id', asyncHandler(async (req, res) => {
  const [[h]] = await pool.query(`SELECT * FROM hospitals WHERE id = ?`, [idParam(req)]);
  if (!h) throw new ApiError(404, 'Hospital not found');
  res.json({ hospital: h });
}));

async function transitionHospital(req, { apply, action }) {
  const id = idParam(req);
  return withTransaction(async (conn) => {
    const [[h]] = await conn.query(`SELECT verification_status FROM hospitals WHERE id = ? FOR UPDATE`, [id]);
    if (!h) throw new ApiError(404, 'Hospital not found');
    if (h.verification_status !== 'under_review') {
      throw new ApiError(409, 'The hospital has not asked for verification (status: ' + h.verification_status.replace('_', ' ') + ')');
    }
    const result = await apply(conn, id);
    await audit(conn, {
      actorId: req.user.id, action, entityType: 'hospital', entityId: id,
      oldValues: { verification_status: h.verification_status }, newValues: result, ip: req.ip,
    });
    return result;
  });
}

router.post('/hospitals/:id/verify', requireAdminRole('verifier'), asyncHandler(async (req, res) => {
  const out = await transitionHospital(req, {
    action: 'hospital.verified',
    apply: async (conn, id) => {
      await conn.query(
        `UPDATE hospitals SET verification_status = 'verified', verified_at = NOW(), verified_by = ?, rejection_reason = NULL WHERE id = ?`,
        [req.user.id, id]
      );
            await notify.toHospital(conn, id, { event: 'hospital_verified', title: 'Your hospital is verified', body: 'You can now place orders.' });
      await notify.toAdmins(conn, { event: 'hospital_verified', title: 'A hospital was verified', body: `Verified by ${req.user.fullName || 'an admin'}.`, entityType: 'hospital', entityId: id }, ['super_admin']);
      return { verification_status: 'verified' };
    },
  });
  res.json(out);
}));

router.post('/hospitals/:id/reject', requireAdminRole('verifier'), asyncHandler(async (req, res) => {
  const { reason } = z.object({ reason: z.string().trim().min(5).max(500) }).parse(req.body);
  const out = await transitionHospital(req, {
    action: 'hospital.rejected',
    apply: async (conn, id) => {
      await conn.query(
        `UPDATE hospitals SET verification_status = 'rejected', verified_at = NULL, verified_by = ?, rejection_reason = ? WHERE id = ?`,
        [req.user.id, reason, id]
      );
            await notify.toHospital(conn, id, { event: 'hospital_rejected', title: 'Your hospital verification needs changes', body: reason });
      return { verification_status: 'rejected', reason };
    },
  });
  res.json(out);
}));

module.exports = router;

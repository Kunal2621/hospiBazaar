'use strict';

const express = require('express');
const { pool, withTransaction } = require('../db');
const { ApiError, asyncHandler } = require('../utils/errors');
const { audit } = require('../utils/audit');
const notify = require('../services/notify');
const { authenticate, requireHospitalRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

// GET /api/hospitals/me -> hospital profile and verification state
router.get('/me', requireHospitalRole(), asyncHandler(async (req, res) => {
  const [[hospital]] = await pool.query(
    `SELECT id, hospital_name, hospital_type, registration_number, registered_address, city, state, pincode, phone,
            email, website, contact_person_name, contact_person_designation, contact_person_mobile,
            contact_person_email, gstin, pan, account_status, verification_status, verified_at, rejection_reason
       FROM hospitals WHERE id = ?`,
    [req.user.hospitalId]
  );
  res.json({ hospital, role: req.user.hospitalRole });
}));

// POST /api/hospitals/me/request-verification -> unverified/rejected -> under_review (decision 7)
router.post('/me/request-verification', requireHospitalRole('hospital_admin', 'purchase_manager'), asyncHandler(async (req, res) => {
    if (!req.user.emailVerified) throw new ApiError(409, 'Verify your email first. Use the link we sent when you registered, or ask for a new one from the banner at the top of the page.');
  const id = req.user.hospitalId;
  await withTransaction(async (conn) => {
    const [[h]] = await conn.query(`SELECT verification_status FROM hospitals WHERE id = ? FOR UPDATE`, [id]);
    if (!['unverified', 'rejected'].includes(h.verification_status)) {
      throw new ApiError(409, `Verification is already ${h.verification_status.replace('_', ' ')}`);
    }
    await conn.query(`UPDATE hospitals SET verification_status = 'under_review', rejection_reason = NULL WHERE id = ?`, [id]);
    await audit(conn, {
      actorId: req.user.id, action: 'hospital.verification_requested', entityType: 'hospital', entityId: id,
      oldValues: { verification_status: h.verification_status }, newValues: { verification_status: 'under_review' }, ip: req.ip,
    });
        const [[hn]] = await conn.query(`SELECT hospital_name FROM hospitals WHERE id = ?`, [id]);
    await notify.toAdmins(conn, { event: 'hospital_verification_requested', title: `${hn.hospital_name} asked for verification`, 
      body: 'Open Hospitals to review and verify before its first order.', entityType: 'hospital', entityId: id }, ['super_admin', 'verifier']);
  });
  res.json({ verification_status: 'under_review' });
}));

module.exports = router;

'use strict';
const crypto = require('crypto');

const express = require('express');
const bcrypt = require('bcryptjs');
const { pool, withTransaction } = require('../db');
const { z, str, optionalStr, email, phone, pincode, pan, gstin, ifsc, url,password: passwordRule, userSchema } = require('../utils/validation');
const { ApiError, asyncHandler } = require('../utils/errors');
const { audit } = require('../utils/audit');
const config = require('../config');
const { sendMail } = require('../services/mailer');
const notify = require('../services/notify');
const { signToken, loadContext, authenticate } = require('../middleware/auth');

const router = express.Router();

const termsTrue = z.literal(true, { errorMap: () => ({ message: 'You must accept the Terms & Conditions' }) });

async function latestTerms(conn, audience) {
  const [[row]] = await conn.query(
    `SELECT id FROM terms_versions WHERE audience = ? ORDER BY published_at DESC, id DESC LIMIT 1`,
    [audience]
  );
  if (!row) throw new ApiError(500, `No ${audience} terms published`);
  return row.id;
}

// ------------------------------------------------------------ Hospital registration (§20)

const hospitalSchema = z.object({
  hospital: z.object({
    hospital_name: str(200),
    hospital_type: z.enum(['government', 'private', 'trust', 'clinic', 'nursing_home']),
    registration_number: str(100),
    registered_address: str(500),
    city: str(100),
    state: str(100),
    pincode,
    phone,
    email,
    website: optionalStr(255),
    contact_person_name: str(150),
    contact_person_designation: str(100),
    contact_person_mobile: userSchema.shape.mobile,
    contact_person_email: email,
    gstin,
    pan,
  }),
  user: userSchema,
  terms_accepted: termsTrue,
});

router.post('/register/hospital', asyncHandler(async (req, res) => {
  const body = hospitalSchema.parse(req.body);
  const h = body.hospital;
  const u = body.user;
  const passwordHash = await bcrypt.hash(u.password, 12);

  const userId = await withTransaction(async (conn) => {
    const [ur] = await conn.query(
      `INSERT INTO users (full_name, email, mobile, password_hash, user_type) VALUES (?, ?, ?, ?, 'hospital_user')`,
      [u.full_name, u.email, u.mobile, passwordHash]
    );
    // Decision 7: buyers can browse / RFQ / negotiate straight after sign-up -> account is active;
    // verification_status stays 'unverified' until the first order.
    const [hr] = await conn.query(
      `INSERT INTO hospitals (hospital_name, hospital_type, registration_number, registered_address, city, state,
         pincode, phone, email, website, contact_person_name, contact_person_designation, contact_person_mobile,
         contact_person_email, gstin, pan, account_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
      [h.hospital_name, h.hospital_type, h.registration_number, h.registered_address, h.city, h.state, h.pincode,
        h.phone, h.email, h.website ?? null, h.contact_person_name, h.contact_person_designation,
        h.contact_person_mobile, h.contact_person_email, h.gstin, h.pan]
    );
    await conn.query(
      `INSERT INTO hospital_users (hospital_id, user_id, full_name, mobile, email, role)
       VALUES (?, ?, ?, ?, ?, 'hospital_admin')`,
      [hr.insertId, ur.insertId, u.full_name, u.mobile, u.email]
    );
    await conn.query(
      `INSERT INTO terms_acceptances (terms_version_id, hospital_id, accepted_by, ip_address) VALUES (?, ?, ?, ?)`,
      [await latestTerms(conn, 'buyer'), hr.insertId, ur.insertId, req.ip]
    );
    await audit(conn, { actorId: ur.insertId, action: 'hospital.registered', entityType: 'hospital', entityId: hr.insertId, ip: req.ip });
        await notify.toAdmins(conn, { event: 'hospital_registered', title: `New hospital registered: ${h.hospital_name}`, body: `${h.city}, ${h.state}. Contact: ${u.full_name}, 
          ${u.email}. It will ask for verification before its first order.`, entityType: 'hospital', entityId: hr.insertId }, ['super_admin', 'verifier']);
    return ur.insertId;
  });
   await sendVerification(userId, u.email, u.full_name);
  const user = await loadContext(userId);
  res.status(201).json({ token: signToken(userId), user });
}));

// ------------------------------------------------------------ Supplier registration (§19, §20)

const SUPPLIER_DOC_TYPES = [
  'business_proof', 'factory_license', 'udyam', 'trademark', 'iso_13485', 'cdsco_licence',
  'dealer_authorisation', 'distribution_agreement', 'sourcing_invoice', 'cancelled_cheque', 'service_proof', 'other',
];

const supplierSchema = z.object({
  supplier: z.object({
    company_name: str(200),
    supplier_type: z.enum(['manufacturer', 'brand_oem', 'authorised_dealer', 'distributor']),
    registered_address: str(500),
    city: str(100),
    state: str(100),
    pincode,
    phone,
    email,
    website: optionalStr(255),
    pan,
    gstin,
    business_proof_type: z.enum(['incorporation_certificate', 'udyam', 'shop_establishment', 'trade_license']),
    business_proof_number: str(100),
    has_own_factory: z.boolean(),
    factory_address: optionalStr(500),
    trademark_number: optionalStr(100),
    service_capability_note: optionalStr(2000),
  }),
  user: userSchema,
  categories: z.array(z.number().int().positive()).min(1, 'Choose at least one category').max(50),
  brands: z.array(str(150)).max(50).default([]),
  service_locations: z.array(z.object({
    state: str(100),
    city: optionalStr(100),
    address: optionalStr(500),
    contact_name: optionalStr(150),
    contact_phone: optionalStr(20),
  })).max(100).default([]),
  bank: z.object({
    account_holder_name: str(200),
    account_number: z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), z.string().regex(/^\d{6,20}$/, 'Invalid account number')),
    ifsc,
    cancelled_cheque_url: url,
  }),
  documents: z.array(z.object({
    document_type: z.enum(SUPPLIER_DOC_TYPES),
    file_url: url,
    valid_until: z.preprocess((v) => (v === '' ? undefined : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
  })).max(30).default([]),
  terms_accepted: termsTrue,
}).superRefine((val, ctx) => {
  if (val.supplier.has_own_factory && !val.supplier.factory_address) {
    ctx.addIssue({ code: 'custom', path: ['supplier', 'factory_address'], message: 'Factory address is required' });
  }
});

router.post('/register/supplier', asyncHandler(async (req, res) => {
  const body = supplierSchema.parse(req.body);
  const s = body.supplier;
  const u = body.user;
  const passwordHash = await bcrypt.hash(u.password, 12);

  const userId = await withTransaction(async (conn) => {
    const [cats] = await conn.query(`SELECT id FROM categories WHERE id IN (?) AND is_active = 1`, [body.categories]);
    if (cats.length !== new Set(body.categories).size) throw new ApiError(400, 'One or more categories are invalid');

    const [ur] = await conn.query(
      `INSERT INTO users (full_name, email, mobile, password_hash, user_type) VALUES (?, ?, ?, ?, 'supplier_user')`,
      [u.full_name, u.email, u.mobile, passwordHash]
    );
    const [sr] = await conn.query(
      `INSERT INTO suppliers (company_name, supplier_type, registered_address, city, state, pincode, phone, email,
         website, pan, gstin, business_proof_type, business_proof_number, has_own_factory, factory_address,
         trademark_number, service_capability_note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [s.company_name, s.supplier_type, s.registered_address, s.city, s.state, s.pincode, s.phone, s.email,
        s.website ?? null, s.pan, s.gstin, s.business_proof_type, s.business_proof_number, s.has_own_factory ? 1 : 0,
        s.factory_address ?? null, s.trademark_number ?? null, s.service_capability_note ?? null]
    );
    const supplierId = sr.insertId;

    await conn.query(`INSERT INTO supplier_users (supplier_id, user_id, role) VALUES (?, ?, 'owner')`, [supplierId, ur.insertId]);
    await conn.query(`INSERT INTO supplier_verification (supplier_id, verification_status) VALUES (?, 'pending')`, [supplierId]);

    for (const categoryId of new Set(body.categories)) {
      await conn.query(`INSERT INTO supplier_categories (supplier_id, category_id) VALUES (?, ?)`, [supplierId, categoryId]);
    }

    for (const name of new Set(body.brands.map((b) => b.trim()))) {
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'brand';
      await conn.query(`INSERT INTO brands (name, slug) VALUES (?, ?) ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`, [name, slug]);
      const [[b]] = await conn.query(`SELECT LAST_INSERT_ID() AS id`);
      await conn.query(`INSERT IGNORE INTO supplier_brands (supplier_id, brand_id) VALUES (?, ?)`, [supplierId, b.id]);
    }

    for (const loc of body.service_locations) {
      await conn.query(
        `INSERT INTO supplier_service_locations (supplier_id, state, city, address, contact_name, contact_phone)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [supplierId, loc.state, loc.city ?? null, loc.address ?? null, loc.contact_name ?? null, loc.contact_phone ?? null]
      );
    }

    await conn.query(
      `INSERT INTO supplier_bank_accounts (supplier_id, account_holder_name, account_number, ifsc, cancelled_cheque_url)
       VALUES (?, ?, ?, ?, ?)`,
      [supplierId, body.bank.account_holder_name, body.bank.account_number, body.bank.ifsc, body.bank.cancelled_cheque_url]
    );
    // The cancelled cheque is also a verification document.
    await conn.query(
      `INSERT INTO supplier_documents (supplier_id, document_type, file_url) VALUES (?, 'cancelled_cheque', ?)`,
      [supplierId, body.bank.cancelled_cheque_url]
    );
    for (const d of body.documents) {
      await conn.query(
        `INSERT INTO supplier_documents (supplier_id, document_type, file_url, valid_until) VALUES (?, ?, ?, ?)`,
        [supplierId, d.document_type, d.file_url, d.valid_until ?? null]
      );
    }

    await conn.query(
      `INSERT INTO terms_acceptances (terms_version_id, supplier_id, accepted_by, ip_address) VALUES (?, ?, ?, ?)`,
      [await latestTerms(conn, 'supplier'), supplierId, ur.insertId, req.ip]
    );
    await audit(conn, { actorId: ur.insertId, action: 'supplier.registered', entityType: 'supplier', entityId: supplierId, ip: req.ip });
        await notify.toAdmins(conn, { event: 'supplier_registered', title: `New supplier waiting for verification: ${s.company_name}`, body: `${s.city}, ${s.state}. Contact: ${u.full_name}, 
          ${u.email}. Open Suppliers to start verification.`, entityType: 'supplier', entityId: supplierId }, ['super_admin', 'verifier']);
    return ur.insertId;
  });
    await sendVerification(userId, u.email, u.full_name);

  const user = await loadContext(userId);
  res.status(201).json({ token: signToken(userId), user });
}));

// ------------------------------------------------------------ Email verification

const VERIFY_HOURS = 24;
const RESEND_SECONDS = 60;

/** Creates a fresh link (older ones stop working) and emails it. Never throws: a failed email must not undo a registration. */
async function sendVerification(userId, em, name) {
  try {
    const token = crypto.randomBytes(32).toString('hex');
    await pool.query(`UPDATE email_verifications SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL`, [userId]);
    await pool.query(
      `INSERT INTO email_verifications (user_id, token_hash, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? HOUR))`,
      [userId, hashToken(token), VERIFY_HOURS]
    );
    const link = `${config.clientOrigin}/verify-email?token=${token}`;
    await sendMail({
      to: em, subject: 'Verify your email for Hospi Bazaar',
      text: `Hello ${name},\n\nPlease confirm this email address by opening the link below. It works once and expires in ${VERIFY_HOURS} hours:\n\n${link}\n\nIf you did not create a Hospi Bazaar account, ignore this email.`,
    });
  } catch (e) { console.error('Verification email failed:', e.message); }
}

// Opening the link signs nobody in; it only marks the email as confirmed.
router.post('/verify-email', asyncHandler(async (req, res) => {
  const { token } = z.object({ token: z.string().min(20).max(200) }).parse(req.body);
  const bad = () => new ApiError(400, 'This verification link is invalid or has expired. Sign in and ask for a new one.');
  await withTransaction(async (conn) => {
    const [[r]] = await conn.query(
      `SELECT ev.id, ev.user_id, ev.used_at, (ev.expires_at > NOW()) AS live, u.email_verified_at
         FROM email_verifications ev JOIN users u ON u.id = ev.user_id WHERE ev.token_hash = ? FOR UPDATE`, [hashToken(token)]);
    if (!r) throw bad();
    // Opening the same link twice (a double click, or a mail scanner) is fine once the email is confirmed.
    if (r.used_at) { if (r.email_verified_at) return; throw bad(); }
    if (!r.live) throw bad();
    await conn.query(`UPDATE users SET email_verified_at = COALESCE(email_verified_at, NOW()) WHERE id = ?`, [r.user_id]);
    await conn.query(`UPDATE email_verifications SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL`, [r.user_id]);
    await audit(conn, { actorId: r.user_id, action: 'auth.email_verified', entityType: 'user', entityId: r.user_id, ip: req.ip });
  });
  res.json({ ok: true });
}));

router.post('/resend-verification', authenticate, asyncHandler(async (req, res) => {
  if (req.user.emailVerified) return res.json({ alreadyVerified: true });
  const [[last]] = await pool.query(
    `SELECT TIMESTAMPDIFF(SECOND, MAX(created_at), NOW()) AS age FROM email_verifications WHERE user_id = ?`, [req.user.id]);
  if (last.age !== null && last.age < RESEND_SECONDS) {
    throw new ApiError(429, `Please wait ${RESEND_SECONDS - last.age} seconds before asking for another email.`);
  }
  await sendVerification(req.user.id, req.user.email, req.user.fullName);
  res.json({ ok: true });
}));
// ------------------------------------------------------------ Login / me


const loginSchema = z.object({ email, password: z.string().min(1).max(100) });

router.post('/login', asyncHandler(async (req, res) => {
  const { email: em, password } = loginSchema.parse(req.body);
  const [[row]] = await pool.query(`SELECT id, password_hash, status FROM users WHERE email = ?`, [em]);
  // Same message for unknown email and wrong password (no account enumeration).
  const ok = row && (await bcrypt.compare(password, row.password_hash));
  if (!ok) throw new ApiError(401, 'Incorrect email or password');
  if (row.status !== 'active') throw new ApiError(403, 'This account is not active');

  await pool.query(`UPDATE users SET last_login_at = NOW() WHERE id = ?`, [row.id]);
  const user = await loadContext(row.id);
  res.json({ token: signToken(row.id), user });
}));

// ------------------------------------------------------------ Password reset

const RESET_MINUTES = 60;
const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

// Always answers the same way, so nobody can use this to find out which emails are registered.
router.post('/forgot-password', asyncHandler(async (req, res) => {
  const { email: em } = z.object({ email }).parse(req.body);
  const [[u]] = await pool.query(`SELECT id, full_name, status FROM users WHERE email = ?`, [em]);
  if (u && u.status === 'active') {
    const token = crypto.randomBytes(32).toString('hex');
    await pool.query(`UPDATE password_resets SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL`, [u.id]);
    await pool.query(
      `INSERT INTO password_resets (user_id, token_hash, expires_at, requested_ip) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE), ?)`,
      [u.id, hashToken(token), RESET_MINUTES, req.ip]
    );
    const link = `${config.clientOrigin}/reset-password?token=${token}`;
    try {
      await sendMail({
        to: em, subject: 'Reset your Hospi Bazaar password',
        text: `Hello ${u.full_name},\n\nUse this link to choose a new password. It works once and expires in ${RESET_MINUTES} minutes:\n\n${link}\n\nIf you did not ask for this, ignore this email. Your password stays the same.`,
      });
    } catch (e) { console.error('Password reset email failed:', e.message); }
  }
  res.json({ ok: true });
}));

router.post('/reset-password', asyncHandler(async (req, res) => {
  const d = z.object({ token: z.string().min(20).max(200), password: passwordRule }).parse(req.body);
  const hash = await bcrypt.hash(d.password, 12);
  await withTransaction(async (conn) => {
    const [[r]] = await conn.query(
      `SELECT id, user_id FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW() FOR UPDATE`, [hashToken(d.token)]);
    if (!r) throw new ApiError(400, 'This reset link is invalid or has expired. Ask for a new one.');
    await conn.query(`UPDATE users SET password_hash = ?, password_changed_at = NOW(), email_verified_at = COALESCE(email_verified_at, NOW()) WHERE id = ?`, [hash, r.user_id]);
    await conn.query(`UPDATE password_resets SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL`, [r.user_id]);
    await audit(conn, { actorId: r.user_id, action: 'auth.password_reset', entityType: 'user', entityId: r.user_id, ip: req.ip });
  });
  res.json({ ok: true });
}));

router.get('/me', authenticate, (req, res) => res.json({ user: req.user }));

module.exports = router;

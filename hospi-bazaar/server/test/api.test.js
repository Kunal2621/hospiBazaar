'use strict';

// Runs against a real MySQL/MariaDB. Prepare it first:
//   DB_NAME=hospi_bazaar_test node ../db/migrate.js --fresh
// then: DB_NAME=hospi_bazaar_test npm test
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const bcrypt = require('bcryptjs');

process.env.NODE_ENV = 'test';
const app = require('../src/app');
const { pool } = require('../src/db');

const run = Date.now().toString().slice(-8);
const hospitalBody = (suffix = 'a') => ({
  hospital: {
    hospital_name: `City Care Hospital ${suffix}`, hospital_type: 'private', registration_number: `CE-${run}-${suffix}`,
    registered_address: '12 MG Road', city: 'Bhopal', state: 'Madhya Pradesh', pincode: '462001',
    phone: '0755123456', email: `info.${suffix}.${run}@citycare.in`,
    contact_person_name: 'Dr Rao', contact_person_designation: 'Medical Superintendent',
    contact_person_mobile: '9876543210', contact_person_email: `rao.${suffix}.${run}@citycare.in`,
    gstin: '23ABCDE1234F1Z5', pan: 'ABCDE1234F',
  },
  user: { full_name: 'Dr Rao', email: `rao.${suffix}.${run}@citycare.in`, mobile: '9876543210', password: 'Secret123' },
  terms_accepted: true,
});

let equipmentCatId; let furnitureCatId;
const supplierBody = async (suffix, overrides = {}) => ({
  supplier: {
    company_name: `MediBeds ${suffix}`, supplier_type: 'manufacturer', registered_address: 'Plot 4, Industrial Area',
    city: 'Pune', state: 'Maharashtra', pincode: '411001', phone: '02012345678', email: `sales.${suffix}.${run}@medibeds.in`,
    pan: 'AAACM1234B', gstin: `27AAACM1234B1Z${suffix === 'a' ? '5' : '6'}`, business_proof_type: 'udyam',
    business_proof_number: 'UDYAM-MH-01-0000001', has_own_factory: true, factory_address: 'Plot 4, Industrial Area, Pune',
    trademark_number: 'TM123456', ...overrides.supplier,
  },
  user: { full_name: 'Asha Sales', email: `sales.${suffix}.${run}@medibeds.in`, mobile: '9123456780', password: 'Secret123' },
  categories: overrides.categories || [furnitureCatId],
  brands: ['MediBeds', 'MediBeds'],
  service_locations: [{ state: 'Madhya Pradesh', city: 'Bhopal' }],
  bank: { account_holder_name: 'MediBeds Pvt Ltd', account_number: '123456789012', ifsc: 'HDFC0001234', cancelled_cheque_url: 'https://files.example.com/cheque.pdf' },
  documents: [{ document_type: 'factory_license', file_url: 'https://files.example.com/factory.pdf' }],
  terms_accepted: true,
});

let adminToken; let verifierToken; let supportToken;

before(async () => {
  const [[eq]] = await pool.query(`SELECT id FROM categories WHERE slug = 'patient-monitors-ecg'`);
  const [[fu]] = await pool.query(`SELECT id FROM categories WHERE slug = 'hospital-beds'`);
  equipmentCatId = eq.id; furnitureCatId = fu.id;

  const hash = await bcrypt.hash('AdminPass1', 4);
  const mk = async (role) => {
    const email = `${role}.${run}@hospibazaar.test`;
    await pool.query(`INSERT INTO users (full_name, email, mobile, password_hash, user_type, admin_role) VALUES (?, ?, '9000000000', ?, 'admin', ?)`, [role, email, hash, role]);
    const res = await request(app).post('/api/auth/login').send({ email, password: 'AdminPass1' });
    return res.body.token;
  };
  adminToken = await mk('super_admin');
  verifierToken = await mk('verifier');
  supportToken = await mk('support');
});

after(async () => { await pool.end(); });

test('health check and public lookups', async () => {
  assert.equal((await request(app).get('/api/health')).status, 200);
  const cats = await request(app).get('/api/categories');
  assert.equal(cats.body.categories.length, 2);
  assert.equal(cats.body.categories[0].children.length, 5);
  const terms = await request(app).get('/api/terms/buyer');
  assert.equal(terms.body.terms.version, '1.0');
  assert.equal((await request(app).get('/api/terms/other')).status, 400);
});

test('hospital registration, login, duplicate GSTIN and validation', async () => {
  const body = hospitalBody('a');
  const reg = await request(app).post('/api/auth/register/hospital').send(body);
  assert.equal(reg.status, 201, JSON.stringify(reg.body));
  assert.equal(reg.body.user.hospitalRole, 'hospital_admin');
  assert.ok(reg.body.token);

  const me = await request(app).get('/api/hospitals/me').set('Authorization', `Bearer ${reg.body.token}`);
  assert.equal(me.body.hospital.verification_status, 'unverified');
  assert.equal(me.body.hospital.account_status, 'active');

  const login = await request(app).post('/api/auth/login').send({ email: body.user.email, password: 'Secret123' });
  assert.equal(login.status, 200);
  assert.equal((await request(app).post('/api/auth/login').send({ email: body.user.email, password: 'wrong' })).status, 401);

  const dup = await request(app).post('/api/auth/register/hospital').send(hospitalBody('b')); // same GSTIN
  assert.equal(dup.status, 409);
  assert.match(dup.body.error, /GSTIN/);

  const bad = hospitalBody('c');
  bad.hospital.pan = 'nope'; bad.terms_accepted = false; bad.user.password = 'short';
  const res = await request(app).post('/api/auth/register/hospital').send(bad);
  assert.equal(res.status, 400);
  assert.ok(res.body.fields['hospital.pan']);
  assert.ok(res.body.fields.terms_accepted);
  assert.ok(res.body.fields['user.password']);
});

test('hospital verification flow (decision 7)', async () => {
  const login = await request(app).post('/api/auth/login').send({ email: `rao.a.${run}@citycare.in`, password: 'Secret123' });
  const hTok = login.body.token;
  const hospitalId = login.body.user.hospitalId;

  // admin cannot verify before the hospital asks
  assert.equal((await request(app).post(`/api/admin/hospitals/${hospitalId}/verify`).set('Authorization', `Bearer ${verifierToken}`)).status, 409);

  assert.equal((await request(app).post('/api/hospitals/me/request-verification').set('Authorization', `Bearer ${hTok}`)).status, 200);
  assert.equal((await request(app).post('/api/hospitals/me/request-verification').set('Authorization', `Bearer ${hTok}`)).status, 409);

  // support role can read but not decide; hospital users cannot touch admin routes
  assert.equal((await request(app).get('/api/admin/hospitals?status=under_review').set('Authorization', `Bearer ${supportToken}`)).status, 200);
  assert.equal((await request(app).post(`/api/admin/hospitals/${hospitalId}/verify`).set('Authorization', `Bearer ${supportToken}`)).status, 403);
  assert.equal((await request(app).get('/api/admin/hospitals').set('Authorization', `Bearer ${hTok}`)).status, 403);

  const ok = await request(app).post(`/api/admin/hospitals/${hospitalId}/verify`).set('Authorization', `Bearer ${verifierToken}`);
  assert.equal(ok.body.verification_status, 'verified');
});

test('supplier registration, checklist, verify / reject / re-apply (§19)', async () => {
  const reg = await request(app).post('/api/auth/register/supplier').send(await supplierBody('a'));
  assert.equal(reg.status, 201, JSON.stringify(reg.body));
  const sTok = reg.body.token;
  const supplierId = reg.body.user.supplierId;

  const mine = await request(app).get('/api/suppliers/me').set('Authorization', `Bearer ${sTok}`);
  assert.equal(mine.body.verification.verification_status, 'pending');
  assert.equal(mine.body.brands.length, 1); // duplicate brand collapsed
  assert.equal(mine.body.documents.length, 2); // factory licence + cancelled cheque

  const admin = (m, p) => request(app)[m](p).set('Authorization', `Bearer ${verifierToken}`);

  // cannot verify straight from pending
  assert.equal((await admin('post', `/api/admin/suppliers/${supplierId}/verify`).send({ checklist: {} })).status, 422);
  assert.equal((await admin('post', `/api/admin/suppliers/${supplierId}/reject`).send({ reason: 'Documents unclear' })).status, 409);

  assert.equal((await admin('post', `/api/admin/suppliers/${supplierId}/start-verification`)).status, 200);

  const detail = await admin('get', `/api/admin/suppliers/${supplierId}`);
  assert.equal(detail.body.bank_accounts[0].account_number, '********9012'); // masked
  const keys = detail.body.required_checks.map((c) => c.key);
  assert.ok(keys.includes('factory_license') && keys.includes('trademark'));
  assert.ok(!keys.includes('dealer_authorisation'));
  assert.ok(!keys.includes('service_capability')); // furniture only

  // an incomplete checklist is refused and names what failed
  const partial = await admin('post', `/api/admin/suppliers/${supplierId}/verify`).send({ checklist: { gstin_verified: true } });
  assert.equal(partial.status, 422);
  assert.ok(partial.body.details.failed.includes('pan_verified'));

  // reject, supplier re-applies, then verified
  assert.equal((await admin('post', `/api/admin/suppliers/${supplierId}/reject`).send({ reason: 'GSTIN does not match name' })).status, 200);
  const rejected = await request(app).get('/api/suppliers/me').set('Authorization', `Bearer ${sTok}`);
  assert.equal(rejected.body.verification.rejection_reason, 'GSTIN does not match name');
  assert.equal((await request(app).post('/api/suppliers/me/reapply').set('Authorization', `Bearer ${sTok}`)).status, 200);
  assert.equal((await request(app).post('/api/suppliers/me/reapply').set('Authorization', `Bearer ${sTok}`)).status, 409);

  await admin('post', `/api/admin/suppliers/${supplierId}/start-verification`);
  const all = Object.fromEntries(keys.map((k) => [k, true]));
  const done = await admin('post', `/api/admin/suppliers/${supplierId}/verify`).send({ checklist: all });
  assert.equal(done.status, 200, JSON.stringify(done.body));

  const final = await request(app).get('/api/suppliers/me').set('Authorization', `Bearer ${sTok}`);
  assert.equal(final.body.verification.verification_status, 'verified');
  assert.equal(final.body.supplier.account_status, 'active');

  const [logs] = await pool.query(`SELECT action FROM audit_logs WHERE entity_type = 'supplier' AND entity_id = ? ORDER BY id`, [supplierId]);
  assert.deepEqual(logs.map((l) => l.action), [
    'supplier.registered', 'supplier.verification_started', 'supplier.rejected',
    'supplier.reapplied', 'supplier.verification_started', 'supplier.verified',
  ]);
});

test('equipment suppliers and dealers get the extra checks', async () => {
  const reg = await request(app).post('/api/auth/register/supplier').send(await supplierBody('b', {
    categories: [equipmentCatId],
    supplier: { supplier_type: 'authorised_dealer', has_own_factory: false, factory_address: undefined, trademark_number: undefined },
  }));
  assert.equal(reg.status, 201, JSON.stringify(reg.body));
  const checks = await request(app).get('/api/suppliers/me/checklist').set('Authorization', `Bearer ${reg.body.token}`);
  const keys = checks.body.checks.map((c) => c.key);
  assert.ok(keys.includes('dealer_authorisation'));
  assert.ok(keys.includes('service_capability'));
  assert.ok(!keys.includes('factory_license'));
});

test('authentication and authorisation guards', async () => {
  assert.equal((await request(app).get('/api/auth/me')).status, 401);
  assert.equal((await request(app).get('/api/auth/me').set('Authorization', 'Bearer junk')).status, 401);
  const sup = await request(app).post('/api/auth/login').send({ email: `sales.a.${run}@medibeds.in`, password: 'Secret123' });
  assert.equal((await request(app).get('/api/admin/suppliers').set('Authorization', `Bearer ${sup.body.token}`)).status, 403);
  assert.equal((await request(app).get('/api/hospitals/me').set('Authorization', `Bearer ${sup.body.token}`)).status, 403);
  assert.equal((await request(app).get('/api/admin/suppliers').set('Authorization', `Bearer ${adminToken}`)).status, 200);
  assert.equal((await request(app).get('/api/nope')).status, 404);
});

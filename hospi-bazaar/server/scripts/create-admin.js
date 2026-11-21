#!/usr/bin/env node
// Create an admin user (admin accounts cannot self-register).
//   npm run create-admin -- --email you@example.com --name "Your Name" --mobile 9876543210 --password 'Str0ngPass1' --role super_admin
'use strict';

const bcrypt = require('bcryptjs');
const { pool } = require('../src/db');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

(async () => {
  const email = (arg('email') || '').toLowerCase();
  const name = arg('name');
  const mobile = arg('mobile');
  const password = arg('password');
  const role = arg('role') || 'super_admin';

  if (!email || !name || !mobile || !password) {
    console.error('Usage: --email --name --mobile --password [--role super_admin|verifier|catalog_manager|support]');
    process.exit(1);
  }
  if (!['super_admin', 'verifier', 'catalog_manager', 'support'].includes(role)) {
    console.error('Invalid role');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('Password must be at least 8 characters');
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 12);
  const [r] = await pool.query(
    `INSERT INTO users (full_name, email, mobile, password_hash, user_type, admin_role) VALUES (?, ?, ?, ?, 'admin', ?)`,
    [name, email, mobile, hash, role]
  );
  console.log(`Admin created: id=${r.insertId} email=${email} role=${role}`);
  await pool.end();
})().catch(async (err) => {
  console.error(err.code === 'ER_DUP_ENTRY' ? 'That email already exists' : err.message);
  await pool.end();
  process.exit(1);
});

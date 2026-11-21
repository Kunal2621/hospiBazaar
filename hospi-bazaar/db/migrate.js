#!/usr/bin/env node
// Minimal forward-only migration runner for MySQL 8.
//   node db/migrate.js            apply all pending migrations
//   node db/migrate.js --status   list applied / pending
//   node db/migrate.js --fresh    DROP the database, recreate it, apply everything (dev only)
'use strict';

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

try { require('dotenv').config({ path: path.join(__dirname, '..', '.env') }); } catch (_) { /* dotenv optional */ }

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

const cfg = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'hospi_bazaar',
};

async function main() {
  const args = new Set(process.argv.slice(2));

  // Connect without a database first so we can create it.
  const admin = await mysql.createConnection({
    host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password,
  });

  if (args.has('--fresh')) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Refusing --fresh when NODE_ENV=production');
    }
    console.log(`Dropping database ${cfg.database}`);
    await admin.query(`DROP DATABASE IF EXISTS \`${cfg.database}\``);
  }
  await admin.query(
    `CREATE DATABASE IF NOT EXISTS \`${cfg.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await admin.end();

  const db = await mysql.createConnection({ ...cfg, multipleStatements: true });

  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   VARCHAR(190) NOT NULL PRIMARY KEY,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB
  `);

  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  const [rows] = await db.query('SELECT filename FROM schema_migrations');
  const applied = new Set(rows.map((r) => r.filename));

  if (args.has('--status')) {
    for (const f of files) console.log(`${applied.has(f) ? 'applied ' : 'pending '} ${f}`);
    await db.end();
    return;
  }

  let count = 0;
  for (const f of files) {
    if (applied.has(f)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
    process.stdout.write(`Applying ${f} ... `);
    try {
      // MySQL DDL auto-commits, so a failed file can be partly applied. Fix the file and
      // re-run with --fresh in dev; never edit a migration that has run in production.
      await db.query(sql);
      await db.query('INSERT INTO schema_migrations (filename) VALUES (?)', [f]);
      console.log('ok');
      count++;
    } catch (err) {
      console.log('FAILED');
      console.error(`  ${err.code || ''} ${err.sqlMessage || err.message}`);
      await db.end();
      process.exit(1);
    }
  }

  console.log(count ? `Done. Applied ${count} migration(s).` : 'Nothing to apply. Database is up to date.');
  await db.end();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

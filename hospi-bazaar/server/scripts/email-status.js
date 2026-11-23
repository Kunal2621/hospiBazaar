#!/usr/bin/env node
// Shows the last email notifications and their status, and can retry failed ones.
//   node scripts/email-status.js          show status
//   node scripts/email-status.js --retry  put failed emails back in the queue
'use strict';

const { pool } = require('../src/db');
const config = require('../src/config');

(async () => {
  console.log('SMTP_HOST:', config.smtp.host || '(empty: emails are NOT queued or sent)');
  console.log('SMTP_USER:', config.smtp.user || '(empty)');
  console.log('RUN_JOBS :', config.runJobs ? 'true' : 'false (background jobs are OFF, emails will not go out)');
  if (process.argv.includes('--retry')) {
    const [r] = await pool.query(`UPDATE notifications SET status = 'pending' WHERE channel = 'email' AND status = 'failed'`);
    console.log(`\nPut ${r.affectedRows} failed email(s) back in the queue. They go out within 15 seconds if the server is running.`);
  }
    if (process.argv.includes('--send')) {
    console.log('\nSending waiting emails now...');
    const n = await require('../src/jobs').sendPendingEmails();
    console.log(`Tried ${n} email(s). Any error is printed above as "Email failed <id> <reason>".`);
  }
  const [rows] = await pool.query(
    `SELECT n.id, u.email AS to_email, n.event_type, n.status, n.created_at
       FROM notifications n JOIN users u ON u.id = n.user_id
      WHERE n.channel = 'email' ORDER BY n.id DESC LIMIT 10`);
  console.log('\nLast 10 email notifications:');
  if (!rows.length) console.log('  none. No email was queued. Check SMTP_HOST in .env and restart the server.');
  for (const r of rows) console.log(`  #${r.id}  ${String(r.status).padEnd(8)} ${r.event_type.padEnd(34)} -> ${r.to_email}`);
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
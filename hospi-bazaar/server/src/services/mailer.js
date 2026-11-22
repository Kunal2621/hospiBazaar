'use strict';

// Sends one email now (used for password reset). With no SMTP_HOST the message is printed
// to the server console instead, so you can still test the flow on your own computer.
const nodemailer = require('nodemailer');
const config = require('../config');

let transport;

async function sendMail({ to, subject, text }) {
  if (!config.smtp.host) {
    if (config.env !== 'test') console.log(`\n[email not sent, SMTP_HOST is empty]\nTo: ${to}\nSubject: ${subject}\n${text}\n`);
    return { sent: false };
  }
  transport ||= nodemailer.createTransport({
    host: config.smtp.host, port: config.smtp.port, secure: config.smtp.port === 465,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });
  await transport.sendMail({ from: config.smtp.from, to, subject, text });
  return { sent: true };
}

module.exports = { sendMail };
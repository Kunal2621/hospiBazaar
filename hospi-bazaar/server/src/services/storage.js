'use strict';

// File storage. Default: local disk under server/uploads (public files) and server/uploads/private.
// To use S3 or another provider, keep these functions and change what they do; the rest of the app only calls these.
// Public files (product photos, brochures) are served to everyone at /uploads/<name>.
// Private files (verification documents, cancelled cheques, invoices) are served only through a short-lived signed link.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');

const ROOT = path.resolve(config.uploadsDir);
const DIRS = { public: ROOT, private: path.join(ROOT, 'private') };
for (const dir of Object.values(DIRS)) fs.mkdirSync(dir, { recursive: true });

const ALLOWED = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

const NAME = /^[a-f0-9]{32}\.[a-z]+$/;
const isAllowed = (mime) => Object.prototype.hasOwnProperty.call(ALLOWED, mime);
const isValidName = (name) => NAME.test(name);

/** Save a buffer. Returns { storedName, url }. Names are random, so links cannot be guessed. */
async function save(buffer, mime, visibility = 'private') {
  const storedName = `${crypto.randomBytes(16).toString('hex')}${ALLOWED[mime]}`;
  await fs.promises.writeFile(path.join(DIRS[visibility], storedName), buffer);
  return { storedName, url: visibility === 'public' ? `/uploads/${storedName}` : `/files/${storedName}` };
}

const localPath = (storedName, visibility = 'private') => path.join(DIRS[visibility], path.basename(storedName));

// Signed, short-lived links for private files. The signature covers the name and the expiry time.
const key = crypto.createHash('sha256').update(`file-links:${config.jwt.secret}`).digest();
const sign = (name, exp) => crypto.createHmac('sha256', key).update(`${name}.${exp}`).digest('hex');

function signedPath(storedName, seconds = 300) {
  const exp = Math.floor(Date.now() / 1000) + seconds;
  return `/files/${storedName}?exp=${exp}&sig=${sign(storedName, exp)}`;
}

function linkIsValid(storedName, exp, sig) {
  const e = Number(exp);
  if (!Number.isInteger(e) || e < Math.floor(Date.now() / 1000) || typeof sig !== 'string') return false;
  const want = Buffer.from(sign(storedName, e)); const got = Buffer.from(sig);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

module.exports = { save, isAllowed, isValidName, localPath, signedPath, linkIsValid, ALLOWED };
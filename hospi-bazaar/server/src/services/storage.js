'use strict';

// File storage. Default: local disk under server/uploads. To use S3 or another provider,
// keep these three functions and change what they do; the rest of the app only calls these.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');

fs.mkdirSync(config.uploadsDir, { recursive: true });

const ALLOWED = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

const isAllowed = (mime) => Object.prototype.hasOwnProperty.call(ALLOWED, mime);

/** Save a buffer. Returns { storedName, url }. Names are random, so links cannot be guessed. */
async function save(buffer, mime) {
  const storedName = `${crypto.randomBytes(16).toString('hex')}${ALLOWED[mime]}`;
  await fs.promises.writeFile(path.join(config.uploadsDir, storedName), buffer);
  return { storedName, url: `/uploads/${storedName}` };
}

const localPath = (storedName) => path.join(config.uploadsDir, path.basename(storedName));

module.exports = { save, isAllowed, localPath, ALLOWED };

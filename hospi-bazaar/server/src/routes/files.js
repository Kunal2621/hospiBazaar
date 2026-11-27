'use strict';

// Serves stored files. Mounted at the site root (not under /api) because these are plain links.
const express = require('express');
const storage = require('../services/storage');
const { pool } = require('../db');
const { asyncHandler } = require('../utils/errors');

const router = express.Router();
const notFound = (res) => res.status(404).type('text').send('File not found');

// Public files: anyone with the link. Private files are never served from here.
router.get('/uploads/:name', asyncHandler(async (req, res) => {
  const name = req.params.name;
  if (!storage.isValidName(name)) return notFound(res);
  const [[file]] = await pool.query(`SELECT visibility FROM uploaded_files WHERE stored_name = ?`, [name]);
  if (!file || file.visibility !== 'public') return notFound(res);
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'cross-origin' });
  res.sendFile(storage.localPath(name, 'public'), (err) => { if (err && !res.headersSent) notFound(res); });
}));

// Private files: only with a valid, unexpired signature (the signed link is issued after a permission check).
router.get('/files/:name', asyncHandler(async (req, res) => {
  const name = req.params.name;
  if (!storage.isValidName(name) || !storage.linkIsValid(name, req.query.exp, req.query.sig)) {
    return res.status(403).type('text').send('This link has expired. Go back and open the file again.');
  }
  const [[file]] = await pool.query(`SELECT mime_type FROM uploaded_files WHERE stored_name = ? AND visibility = 'private'`, [name]);
  if (!file) return notFound(res);
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store', 'Content-Disposition': 'inline', 'Content-Type': file.mime_type });
  res.sendFile(storage.localPath(name, 'private'), (err) => { if (err && !res.headersSent) notFound(res); });
}));

module.exports = router;
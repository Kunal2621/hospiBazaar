'use strict';

const express = require('express');
const multer = require('multer');
const config = require('../config');
const storage = require('../services/storage');
const { canView } = require('../services/fileAccess');
const { pool } = require('../db');
const { ApiError, asyncHandler } = require('../utils/errors');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 1 },
});

const readFile = (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err?.code === 'LIMIT_FILE_SIZE') return next(new ApiError(413, `The file is larger than ${config.maxUploadMb} MB`));
    if (err) return next(new ApiError(400, 'Upload failed'));
    next();
  });
};

async function store(req, res, { owner, visibility }) {
  const f = req.file;
  if (!f) throw new ApiError(400, 'Choose a file to upload');
  if (!storage.isAllowed(f.mimetype)) throw new ApiError(415, 'Upload a PDF, JPG, PNG or WebP file');
  const saved = await storage.save(f.buffer, f.mimetype, visibility);
  await pool.query(
    `INSERT INTO uploaded_files (uploaded_by, original_name, stored_name, mime_type, size_bytes, visibility) VALUES (?, ?, ?, ?, ?, ?)`,
    [owner, f.originalname.slice(0, 255), saved.storedName, f.mimetype, f.size, visibility]
  );
  res.status(201).json({ url: saved.url, name: f.originalname });
}

// POST /api/uploads?visibility=public|private  (multipart, field "file")  ->  { url, name }
// Private is the default. Public is for product photos and brochures, so only suppliers and admins may use it.
router.post('/', authenticate, readFile, asyncHandler(async (req, res) => {
  const visibility = req.query.visibility === 'public' ? 'public' : 'private';
  if (visibility === 'public' && req.user.type === 'hospital_user') throw new ApiError(403, 'Not allowed');
  await store(req, res, { owner: req.user.id, visibility });
}));

// POST /api/uploads/registration  (no sign-in: a supplier attaches documents while registering)
// The file is private and has no owner until the new account claims it. Rate limited in app.js.
router.post('/registration', readFile, asyncHandler(async (req, res) => {
  await store(req, res, { owner: null, visibility: 'private' });
}));

// GET /api/uploads/link/:name -> { url }  A short-lived link, only if this user may open the file.
router.get('/link/:name', authenticate, asyncHandler(async (req, res) => {
  const name = req.params.name;
  if (!storage.isValidName(name)) throw new ApiError(404, 'File not found');
  const [[file]] = await pool.query(`SELECT stored_name, uploaded_by, visibility FROM uploaded_files WHERE stored_name = ?`, [name]);
  if (!file) throw new ApiError(404, 'File not found');
  if (!(await canView(req.user, file))) throw new ApiError(403, 'You do not have access to this file');
  res.json({ url: file.visibility === 'public' ? `/uploads/${name}` : storage.signedPath(name) });
}));

module.exports = router;
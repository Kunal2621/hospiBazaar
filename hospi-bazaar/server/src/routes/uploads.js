'use strict';

const express = require('express');
const multer = require('multer');
const config = require('../config');
const storage = require('../services/storage');
const { pool } = require('../db');
const { ApiError, asyncHandler } = require('../utils/errors');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 1 },
});

// POST /api/uploads  (multipart, field "file")  ->  { url, name }
router.post('/', authenticate, (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err?.code === 'LIMIT_FILE_SIZE') return next(new ApiError(413, `The file is larger than ${config.maxUploadMb} MB`));
    if (err) return next(new ApiError(400, 'Upload failed'));
    next();
  });
}, asyncHandler(async (req, res) => {
  const f = req.file;
  if (!f) throw new ApiError(400, 'Choose a file to upload');
  if (!storage.isAllowed(f.mimetype)) throw new ApiError(415, 'Upload a PDF, JPG, PNG or WebP file');
  const saved = await storage.save(f.buffer, f.mimetype);
  await pool.query(
    `INSERT INTO uploaded_files (uploaded_by, original_name, stored_name, mime_type, size_bytes) VALUES (?, ?, ?, ?, ?)`,
    [req.user.id, f.originalname.slice(0, 255), saved.storedName, f.mimetype, f.size]
  );
  res.status(201).json({ url: saved.url, name: f.originalname });
}));

module.exports = router;

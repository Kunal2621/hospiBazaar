'use strict';

const express = require('express');
const { pool } = require('../db');
const { ApiError, asyncHandler } = require('../utils/errors');

const router = express.Router();

// GET /api/categories -> tree of active categories (group -> categories)
router.get('/categories', asyncHandler(async (_req, res) => {
  const [rows] = await pool.query(
    `SELECT id, parent_id, name, slug FROM categories WHERE is_active = 1 ORDER BY sort_order, id`
  );
  const byId = new Map(rows.map((r) => [r.id, { ...r, children: [] }]));
  const roots = [];
  for (const node of byId.values()) {
    if (node.parent_id && byId.has(node.parent_id)) byId.get(node.parent_id).children.push(node);
    else roots.push(node);
  }
  res.json({ categories: roots });
}));

// GET /api/brands
router.get('/brands', asyncHandler(async (_req, res) => {
  const [rows] = await pool.query(`SELECT id, name, slug FROM brands WHERE is_active = 1 ORDER BY name`);
  res.json({ brands: rows });
}));

// GET /api/terms/:audience -> latest T&C version for 'buyer' or 'supplier'
router.get('/terms/:audience', asyncHandler(async (req, res) => {
  const { audience } = req.params;
  if (!['buyer', 'supplier'].includes(audience)) throw new ApiError(400, 'audience must be buyer or supplier');
  const [[row]] = await pool.query(
    `SELECT id, audience, version, document_url, published_at
       FROM terms_versions WHERE audience = ? ORDER BY published_at DESC, id DESC LIMIT 1`,
    [audience]
  );
  if (!row) throw new ApiError(404, 'No terms published');
  res.json({ terms: row });
}));

module.exports = router;

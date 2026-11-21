'use strict';

// Business rules live in the platform_settings table (see db/migrations/007 and 009).
const { pool } = require('../db');

let cache = null;
let loadedAt = 0;
const TTL_MS = 15 * 1000;

async function all() {
  if (!cache || Date.now() - loadedAt > TTL_MS) {
    const [rows] = await pool.query('SELECT setting_key, setting_value FROM platform_settings');
    cache = Object.fromEntries(rows.map((r) => [r.setting_key, r.setting_value]));
    loadedAt = Date.now();
  }
  return cache;
}

async function get(key, fallback = null) {
  const s = await all();
  return key in s ? s[key] : fallback;
}

async function num(key, fallback = 0) {
  const v = Number(await get(key, fallback));
  return Number.isFinite(v) ? v : fallback;
}

function clear() { cache = null; }

module.exports = { all, get, num, clear };

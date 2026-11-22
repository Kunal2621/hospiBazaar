'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');
const { pool } = require('../db');
const { ApiError, asyncHandler } = require('../utils/errors');

function signToken(userId) {
  return jwt.sign({ sub: userId }, config.jwt.secret, { expiresIn: config.jwt.expiresIn });
}

/** Load the user plus their hospital/supplier membership (the "context" used for permissions). */
async function loadContext(userId) {
  const [[user]] = await pool.query(
    `SELECT id, full_name, email, mobile, user_type, admin_role, status FROM users WHERE id = ?`,
    [userId]
  );
  if (!user) return null;

  const ctx = {
    id: user.id,
    fullName: user.full_name,
    email: user.email,
    mobile: user.mobile,
    type: user.user_type,
    adminRole: user.admin_role,
    status: user.status,
    hospitalId: null,
    hospitalRole: null,
    supplierId: null,
    supplierRole: null,
  };

  if (user.user_type === 'hospital_user') {
    const [[m]] = await pool.query(
      `SELECT hospital_id, role FROM hospital_users WHERE user_id = ? AND status = 'active' LIMIT 1`,
      [userId]
    );
    if (m) { ctx.hospitalId = m.hospital_id; ctx.hospitalRole = m.role; }
  } else if (user.user_type === 'supplier_user') {
    const [[m]] = await pool.query(
      `SELECT supplier_id, role FROM supplier_users WHERE user_id = ? AND status = 'active' LIMIT 1`,
      [userId]
    );
    if (m) { ctx.supplierId = m.supplier_id; ctx.supplierRole = m.role; }
  }
  return ctx;
}

const authenticate = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) throw new ApiError(401, 'Authentication required');

  let payload;
  try {
    payload = jwt.verify(token, config.jwt.secret);
  } catch (_) {
    throw new ApiError(401, 'Invalid or expired token');
  }

  const ctx = await loadContext(payload.sub);
  if (!ctx || ctx.status !== 'active') throw new ApiError(401, 'Account not available');
    // A password change or reset signs out every session that started before it.
  // UNIX_TIMESTAMP is read in the same database time zone that NOW() wrote it in, so the
  // comparison stays right even when Node and MySQL run in different time zones.
  const [[pw]] = await pool.query('SELECT UNIX_TIMESTAMP(password_changed_at) AS changed_at FROM users WHERE id = ?', [ctx.id]);
  if (pw.changed_at && payload.iat < Math.floor(Number(pw.changed_at))) {
    throw new ApiError(401, 'Your password was changed. Please sign in again.');
  }
  req.user = ctx;
  next();
});

/** Allow only the listed user types: requireType('admin'), requireType('hospital_user', 'admin') */
const requireType = (...types) => (req, _res, next) => {
  if (!req.user || !types.includes(req.user.type)) return next(new ApiError(403, 'Not allowed'));
  next();
};

/** Admin sub-roles. super_admin passes every check. */
const requireAdminRole = (...roles) => (req, _res, next) => {
  const u = req.user;
  if (!u || u.type !== 'admin') return next(new ApiError(403, 'Not allowed'));
  if (u.adminRole === 'super_admin' || roles.includes(u.adminRole)) return next();
  next(new ApiError(403, 'Your admin role cannot do this'));
};

/** Hospital org roles (§4): requireHospitalRole('hospital_admin', 'purchase_manager') */
const requireHospitalRole = (...roles) => (req, _res, next) => {
  const u = req.user;
  if (!u || u.type !== 'hospital_user' || !u.hospitalId) return next(new ApiError(403, 'Not allowed'));
  if (roles.length && !roles.includes(u.hospitalRole)) return next(new ApiError(403, 'Your role cannot do this'));
  next();
};

module.exports = { signToken, loadContext, authenticate, requireType, requireAdminRole, requireHospitalRole };

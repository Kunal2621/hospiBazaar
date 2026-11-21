'use strict';

const { pool } = require('../db');
const { ApiError, asyncHandler } = require('../utils/errors');

// Hospital roles that may spend money or raise requests (spec section 4).
const BUYER_ROLES = ['hospital_admin', 'purchase_manager', 'purchase_executive'];

/** Any hospital member. */
const hospitalMember = (req, _res, next) => {
  const u = req.user;
  if (!u || u.type !== 'hospital_user' || !u.hospitalId) return next(new ApiError(403, 'Not allowed'));
  next();
};

/** Hospital member allowed to buy (admin, purchase manager, purchase executive). */
const hospitalBuyer = (req, _res, next) => {
  const u = req.user;
  if (!u || u.type !== 'hospital_user' || !u.hospitalId || !BUYER_ROLES.includes(u.hospitalRole)) {
    return next(new ApiError(403, 'Your role cannot do this'));
  }
  next();
};

/** Hospital must be verified (decision 7). Browsing, RFQs and negotiation do not need this. */
const verifiedHospital = asyncHandler(async (req, _res, next) => {
  const [[h]] = await pool.query('SELECT verification_status FROM hospitals WHERE id = ?', [req.user.hospitalId]);
  if (!h || h.verification_status !== 'verified') {
    throw new ApiError(403, 'Your hospital must be verified before you can place an order', { code: 'HOSPITAL_NOT_VERIFIED', status: h?.verification_status });
  }
  next();
});

const supplierMember = (req, _res, next) => {
  const u = req.user;
  if (!u || u.type !== 'supplier_user' || !u.supplierId) return next(new ApiError(403, 'Not allowed'));
  next();
};

/** Supplier must be verified before listing products or quoting. */
const verifiedSupplier = asyncHandler(async (req, _res, next) => {
  const [[v]] = await pool.query('SELECT verification_status FROM supplier_verification WHERE supplier_id = ?', [req.user.supplierId]);
  if (!v || v.verification_status !== 'verified') {
    throw new ApiError(403, 'Your supplier account must be verified first', { code: 'SUPPLIER_NOT_VERIFIED' });
  }
  next();
});

const idParam = (req, name = 'id') => {
  const id = Number(req.params[name]);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, 'Invalid id');
  return id;
};

module.exports = { BUYER_ROLES, hospitalMember, hospitalBuyer, verifiedHospital, supplierMember, verifiedSupplier, idParam };

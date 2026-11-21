'use strict';

const { z } = require('zod');

const upper = (s) => (typeof s === 'string' ? s.trim().toUpperCase() : s);
const trimmed = (s) => (typeof s === 'string' ? s.trim() : s);

const str = (max = 255) => z.preprocess(trimmed, z.string().min(1, 'Required').max(max));
const optionalStr = (max = 255) =>
  z.preprocess((v) => (v === '' || v === null ? undefined : trimmed(v)), z.string().max(max).optional());

const email = z.preprocess(
  (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
  z.string().email('Invalid email').max(190)
);
const mobile = z.preprocess(trimmed, z.string().regex(/^[6-9]\d{9}$/, 'Enter a 10-digit Indian mobile number'));
const phone = z.preprocess(trimmed, z.string().regex(/^[0-9+\-\s]{8,20}$/, 'Invalid phone number'));
const pincode = z.preprocess(trimmed, z.string().regex(/^\d{6}$/, 'Pincode must be 6 digits'));
const pan = z.preprocess(upper, z.string().regex(/^[A-Z]{5}\d{4}[A-Z]$/, 'Invalid PAN'));
const gstin = z.preprocess(
  upper,
  z.string().regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'Invalid GSTIN')
);
const ifsc = z.preprocess(upper, z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Invalid IFSC'));
const url = z.preprocess(trimmed, z.string().url('Must be a valid URL').max(500));
const password = z
  .string()
  .min(8, 'At least 8 characters')
  .max(100)
  .regex(/[A-Za-z]/, 'Must contain a letter')
  .regex(/\d/, 'Must contain a number');

const userSchema = z.object({
  full_name: str(150),
  email,
  mobile,
  password,
});

module.exports = { z, str, optionalStr, email, mobile, phone, pincode, pan, gstin, ifsc, url, password, userSchema };

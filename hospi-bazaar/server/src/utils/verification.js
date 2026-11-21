'use strict';

/**
 * Supplier verification checklist (spec §19).
 * Returns the checks an admin must pass for this supplier before marking it "verified".
 *
 * hasEquipmentCategory: supplier registered for a Medical Equipment category -> service
 * capability must be checked (§19 "Service capability (for equipment categories)").
 */
function requiredChecks(supplier, { hasEquipmentCategory = false } = {}) {
  const checks = [
    { key: 'gstin_verified', label: 'GSTIN cross-checked on the GST portal' },
    { key: 'pan_verified', label: 'PAN matches company' },
    { key: 'business_proof', label: 'Business proof valid (Incorporation / Udyam / Shop & Establishment / Trade License)' },
    { key: 'bank_details', label: 'Bank account and cancelled cheque match' },
    { key: 'terms_accepted', label: 'Terms & Conditions accepted' },
  ];

  const isDealer = supplier.supplier_type === 'authorised_dealer' || supplier.supplier_type === 'distributor';
  const hasFactory = Boolean(supplier.has_own_factory);

  if (hasFactory && !isDealer) {
    checks.push(
      { key: 'factory_license', label: 'Factory / manufacturing license' },
      { key: 'udyam', label: 'Udyam registration' },
      { key: 'trademark', label: 'Trademark registration (proof of own brand)' }
    );
  } else if (!isDealer) {
    // Trader / reseller sourcing from another factory
    checks.push({ key: 'sourcing_proof', label: 'Sample purchase invoice / proof of sourcing from the manufacturer' });
  }

  if (isDealer) {
    checks.push({ key: 'dealer_authorisation', label: 'Dealer authorisation letter from brand/OEM (on letterhead, with validity dates)' });
  }

  if (hasEquipmentCategory) {
    checks.push({ key: 'service_capability', label: 'Service centre address, locations covered and technician contact' });
  }

  return checks;
}

/** Returns the labels of required checks that are not true in the submitted checklist. */
function failedChecks(required, checklist = {}) {
  return required.filter((c) => checklist[c.key] !== true).map((c) => c.key);
}

module.exports = { requiredChecks, failedChecks };

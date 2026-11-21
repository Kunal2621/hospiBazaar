-- 007_seed_reference.sql
-- Reference data: business-rule settings and the Phase 1 category master (§2).

INSERT INTO platform_settings (setting_key, setting_value, description) VALUES
  ('online_order_cap',                '500000', 'Max order/cart total (INR) payable online. Above this, checkout is blocked and the team creates the order manually (§17, decision 2).'),
  ('online_cap_message',              'We cannot process this amount online. Please wait while our team connects with you.', 'Message shown to the buyer when the cap is exceeded (§17).'),
  ('negotiation_min_unit_price',      '5000',   'Counter offer is allowed only when unit price is above this value (§18).'),
  ('negotiation_inactivity_days',     '7',      'Open negotiation auto-closes as no-deal after this many days with no message (decision 4; value to be confirmed).'),
  ('price_lock_hours',                '72',     'How long a negotiated price stays in the cart after agreement (decision 5; value to be confirmed).'),
  ('delivery_auto_confirm_days',      '7',      'If the buyer never confirms delivery, it is auto-confirmed after this many days so the payout can release (decision 3; value to be confirmed).'),
  ('platform_fee_percent',            '3.00',   'Illustrative platform fee on completed GMV (§15). Pricing to be validated during the pilot.'),
  ('buyer_verification_required_for', 'first_order', 'Decision 7: hospitals must be verified before their first order.');

-- Phase 1 categories. Top level = group, children = categories listed in §2.
INSERT INTO categories (id, parent_id, name, slug, sort_order) VALUES
  (1,  NULL, 'Hospital Furniture', 'hospital-furniture', 1),
  (2,  NULL, 'Medical Equipment',  'medical-equipment',  2);

INSERT INTO categories (parent_id, name, slug, sort_order) VALUES
  (1, 'Hospital Beds (ICU / Fowler / Electric)',   'hospital-beds',              1),
  (1, 'Examination Couches',                       'examination-couches',        2),
  (1, 'OT Tables',                                 'ot-tables',                  3),
  (1, 'Stretchers & Trolleys',                     'stretchers-trolleys',        4),
  (1, 'Bedside Lockers / Patient Furniture',       'bedside-lockers-patient-furniture', 5),
  (2, 'Patient Monitors & ECG',                    'patient-monitors-ecg',       1),
  (2, 'Defibrillators & Suction',                  'defibrillators-suction',     2),
  (2, 'Infusion / Syringe Pumps',                  'infusion-syringe-pumps',     3),
  (2, 'Autoclaves & OT Equipment',                 'autoclaves-ot-equipment',    4),
  (2, 'Anaesthesia / Neonatal',                    'anaesthesia-neonatal',       5),
  (2, 'Laboratory / Physiotherapy / Emergency',    'laboratory-physiotherapy-emergency', 6);

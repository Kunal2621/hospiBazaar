'use strict';
const bcrypt = require('bcryptjs');
const { pool } = require('../src/db');

async function seed() {
  console.log('Seeding demo accounts and products...');
  const passHash = await bcrypt.hash('Secret123', 10);

  // 1. Create Supplier User
  const [userSupRes] = await pool.query(
    `INSERT INTO users (full_name, email, mobile, password_hash, user_type, status)
     VALUES ('Rajesh Sharma', 'supplier@example.com', '9823012345', ?, 'supplier_user', 'active')`,
    [passHash]
  );
  const supplierUserId = userSupRes.insertId;

  // Create Supplier
  const [supRes] = await pool.query(
    `INSERT INTO suppliers (
      company_name, supplier_type, registered_address, city, state, pincode,
      phone, email, pan, gstin, business_proof_type, business_proof_number,
      has_own_factory, factory_address, account_status
    ) VALUES (
      'Apex MediTech Pvt Ltd', 'manufacturer', 'Plot 42, MIDC Industrial Area',
      'Pune', 'Maharashtra', '411018', '02027471234', 'sales@apexmeditech.com',
      'AAACA1234M', '27AAACA1234M1Z5', 'udyam', 'UDYAM-MH-26-0012345',
      1, 'Plot 42, MIDC Bhosari, Pune', 'active'
    )`
  );
  const supplierId = supRes.insertId;

  await pool.query(
    `INSERT INTO supplier_users (supplier_id, user_id, role, status)
     VALUES (?, ?, 'owner', 'active')`,
    [supplierId, supplierUserId]
  );

  await pool.query(
    `INSERT INTO supplier_verification (supplier_id, verification_status, verified_at, verified_by)
     VALUES (?, 'verified', NOW(), 1)`,
    [supplierId]
  );

  await pool.query(
    `INSERT INTO supplier_bank_accounts (supplier_id, account_holder_name, account_number, ifsc, cancelled_cheque_url, is_primary)
     VALUES (?, 'Apex MediTech Pvt Ltd', '91802001234567', 'HDFC0000123', 'https://example.com/cheque.pdf', 1)`,
    [supplierId]
  );

  // Categories
  const [cats] = await pool.query(`SELECT id FROM categories WHERE parent_id IS NOT NULL`);
  for (const c of cats) {
    await pool.query(`INSERT IGNORE INTO supplier_categories (supplier_id, category_id) VALUES (?, ?)`, [supplierId, c.id]);
  }

  // Terms acceptance for supplier
  const [[supTerms]] = await pool.query(`SELECT id FROM terms_versions WHERE audience = 'supplier' LIMIT 1`);
  if (supTerms) {
    await pool.query(
      `INSERT INTO terms_acceptances (terms_version_id, supplier_id, accepted_by) VALUES (?, ?, ?)`,
      [supTerms.id, supplierId, supplierUserId]
    );
  }

  // 2. Create Hospital User
  const [userHospRes] = await pool.query(
    `INSERT INTO users (full_name, email, mobile, password_hash, user_type, status)
     VALUES ('Dr. Ananya Roy', 'hospital@example.com', '9871122334', ?, 'hospital_user', 'active')`,
    [passHash]
  );
  const hospitalUserId = userHospRes.insertId;

  // Create Hospital
  const [hospRes] = await pool.query(
    `INSERT INTO hospitals (
      hospital_name, hospital_type, registration_number, registered_address,
      city, state, pincode, phone, email, contact_person_name, contact_person_designation,
      contact_person_mobile, contact_person_email, gstin, pan, account_status,
      verification_status, verified_at, verified_by
    ) VALUES (
      'City Care Multi-Speciality Hospital', 'private', 'HOSP-MP-2024-9981',
      '15 Arera Hills, Near Link Road', 'Bhopal', 'Madhya Pradesh', '462011',
      '07554001234', 'procurement@citycarehospital.in', 'Dr. Ananya Roy', 'Medical Director',
      '9871122334', 'hospital@example.com', '23AAACH8765K1Z8', 'AAACH8765K', 'active',
      'verified', NOW(), 1
    )`
  );
  const hospitalId = hospRes.insertId;

  await pool.query(
    `INSERT INTO hospital_users (hospital_id, user_id, full_name, mobile, email, role, status)
     VALUES (?, ?, 'Dr. Ananya Roy', '9871122334', 'hospital@example.com', 'hospital_admin', 'active')`,
    [hospitalId, hospitalUserId]
  );

  // Terms acceptance for buyer
  const [[buyerTerms]] = await pool.query(`SELECT id FROM terms_versions WHERE audience = 'buyer' LIMIT 1`);
  if (buyerTerms) {
    await pool.query(
      `INSERT INTO terms_acceptances (terms_version_id, hospital_id, accepted_by) VALUES (?, ?, ?)`,
      [buyerTerms.id, hospitalId, hospitalUserId]
    );
  }

  // 3. Create Demo Products
  const [[bedCat]] = await pool.query(`SELECT id FROM categories WHERE slug = 'hospital-beds'`);
  const [[monitorCat]] = await pool.query(`SELECT id FROM categories WHERE slug = 'patient-monitors-ecg'`);
  const [[otCat]] = await pool.query(`SELECT id FROM categories WHERE slug = 'ot-tables'`);
  const [[couchCat]] = await pool.query(`SELECT id FROM categories WHERE slug = 'examination-couches'`);
  const [[stretcherCat]] = await pool.query(`SELECT id FROM categories WHERE slug = 'stretchers-trolleys'`);

  const demoProducts = [
    {
      name: 'ICU 5-Function Motorized Hospital Bed',
      slug: 'icu-5-function-motorized-bed',
      category_id: bedCat?.id,
      model_number: 'APEX-HB-500',
      sku: 'HB-500-ICU',
      short_description: 'Full electric ICU bed with Linak actuators, CPR quick release, and cardiac chair position.',
      description: 'Manufactured with high-grade anti-bacterial ABS side rails and epoxy-coated steel frame. Features 5 motorized functions including backrest, knee rest, trendelenburg, reverse trendelenburg and height adjustment.',
      unit_price: 58000.00,
      gst_rate: 12.00,
      min_order_qty: 1,
      stock_status: 'in_stock',
      lead_time_days: 5,
      warranty_months: 24,
      installation_available: 1,
      specifications: JSON.stringify({ "Safe Working Load": "250 kg", "Actuators": "Linak (Denmark)", "Castors": "125mm Central Locking", "CPR": "Manual Instant Release" }),
      imageUrl: 'https://images.unsplash.com/photo-1586773860418-d37222d8fce3?auto=format&fit=crop&w=800&q=80'
    },
    {
      name: '12.1-inch Multi-Parameter Patient Monitor',
      slug: '12-inch-multi-parameter-patient-monitor',
      category_id: monitorCat?.id,
      model_number: 'APEX-MON-12',
      sku: 'MON-12-MP',
      short_description: 'Standard 6-parameter vital signs monitor with high-res TFT touch display and rechargeable battery.',
      description: 'Parameters include ECG, Respiration, SpO2, NIBP, 2-Channel Temperature, and Pulse Rate. Includes 72-hour trend storage, arrhythmia detection, and ST segment analysis.',
      unit_price: 32500.00,
      gst_rate: 12.00,
      min_order_qty: 1,
      stock_status: 'in_stock',
      lead_time_days: 3,
      warranty_months: 12,
      installation_available: 1,
      specifications: JSON.stringify({ "Display": "12.1-inch Color TFT", "Battery Backup": "4 hours", "Parameters": "ECG, NIBP, SpO2, Resp, Temp, PR", "Alarms": "Visual & Audible 3 levels" }),
      imageUrl: 'https://images.unsplash.com/photo-1516549655169-df83a0774514?auto=format&fit=crop&w=800&q=80'
    },
    {
      name: 'Electro-Hydraulic Operating Table (Universal OT)',
      slug: 'electro-hydraulic-operating-table',
      category_id: otCat?.id,
      model_number: 'APEX-OT-900',
      sku: 'OT-900-EH',
      short_description: 'Universal surgical table with longitudinal sliding for C-arm access and kidney bridge elevator.',
      description: 'Fully automated electro-hydraulic movements with hand-held remote control and auxiliary floor panel. Radiotranslucent table top suitable for fluoroscopy and radiography.',
      unit_price: 135000.00,
      gst_rate: 12.00,
      min_order_qty: 1,
      stock_status: 'in_stock',
      lead_time_days: 7,
      warranty_months: 36,
      installation_available: 1,
      specifications: JSON.stringify({ "Table Length": "2050 mm", "Max Patient Weight": "300 kg", "Slide Travel": "300 mm", "Hydraulic Unit": "German solenoid system" }),
      imageUrl: 'https://images.unsplash.com/photo-1579684385127-1ef15d508118?auto=format&fit=crop&w=800&q=80'
    },
    {
      name: '2-Section Clinical Examination Couch with Paper Dispenser',
      slug: '2-section-clinical-examination-couch',
      category_id: couchCat?.id,
      model_number: 'APEX-EC-100',
      sku: 'EC-100-2S',
      short_description: 'Heavy duty examination couch with gas-spring ratchet backrest and seamless upholstered cushion.',
      description: 'Constructed with precision CRCA rectangular steel tubes, anti-microbial leatherette upholstery, and adjustable feet for floor leveling.',
      unit_price: 9500.00,
      gst_rate: 12.00,
      min_order_qty: 1,
      stock_status: 'in_stock',
      lead_time_days: 3,
      warranty_months: 12,
      installation_available: 0,
      specifications: JSON.stringify({ "Dimensions": "1830 x 600 x 780 mm", "Cushion Thickness": "60 mm high-density foam", "Finish": "Pre-treated epoxy powder coated" }),
      imageUrl: 'https://images.unsplash.com/photo-1538108149393-fbbd81895907?auto=format&fit=crop&w=800&q=80'
    },
    {
      name: 'Emergency Patient Transfer Stretcher Trolley',
      slug: 'emergency-transfer-stretcher-trolley',
      category_id: stretcherCat?.id,
      model_number: 'APEX-STR-200',
      sku: 'STR-200-EM',
      short_description: 'Removable stretcher top with collapsible drop-down safety side rails and IV pole.',
      description: 'Lightweight yet rugged tubular construction with 150mm diagonal locking castors for smooth transit over hospital thresholds.',
      unit_price: 18500.00,
      gst_rate: 12.00,
      min_order_qty: 1,
      stock_status: 'in_stock',
      lead_time_days: 2,
      warranty_months: 12,
      installation_available: 0,
      specifications: JSON.stringify({ "Weight Capacity": "180 kg", "Wheels": "150 mm non-marking PU wheels", "Accessories": "SS IV Rod, Cylinder Cage" }),
      imageUrl: 'https://images.unsplash.com/photo-1519494026892-80bbd2d6fd0d?auto=format&fit=crop&w=800&q=80'
    }
  ];

  for (const p of demoProducts) {
    if (!p.category_id) continue;
    const [exist] = await pool.query(`SELECT id FROM products WHERE slug = ?`, [p.slug]);
    let prodId;
    if (exist.length === 0) {
      const [r] = await pool.query(
        `INSERT INTO products (
          supplier_id, category_id, name, slug, model_number, sku,
          short_description, description, unit_price, gst_rate, min_order_qty,
          stock_status, lead_time_days, warranty_months, installation_available,
          specifications, status, approved_by, approved_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, 'approved', 1, NOW()
        )`,
        [
          supplierId, p.category_id, p.name, p.slug, p.model_number, p.sku,
          p.short_description, p.description, p.unit_price, p.gst_rate, p.min_order_qty,
          p.stock_status, p.lead_time_days, p.warranty_months, p.installation_available,
          p.specifications
        ]
      );
      prodId = r.insertId;
      await pool.query(
        `INSERT INTO product_images (product_id, image_url, sort_order) VALUES (?, ?, 0)`,
        [prodId, p.imageUrl]
      );
      console.log(`Product created: ${p.name} (id=${prodId})`);
    } else {
      console.log(`Product exists: ${p.name}`);
    }
  }

  console.log('Demo data seeded successfully!');
  await pool.end();
}

seed().catch(err => {
  console.error('Error seeding demo data:', err);
  process.exit(1);
});

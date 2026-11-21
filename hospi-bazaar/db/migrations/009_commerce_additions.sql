-- 009_commerce_additions.sql
-- Columns and tables the commerce modules need on top of the original design.

-- RFQs need a street address for the delivery site (city/state/pincode already exist).
ALTER TABLE rfqs ADD COLUMN delivery_address VARCHAR(500) NULL AFTER title;

-- Quotations may offer an item that is not in the supplier's catalogue, so product links are optional.
ALTER TABLE order_items MODIFY product_id BIGINT UNSIGNED NULL;
ALTER TABLE warranties  MODIFY product_id BIGINT UNSIGNED NULL;

-- GST split (spec section 22, first step): intra-state = CGST + SGST, inter-state = IGST.
-- Supplier invoice details are recorded at dispatch. E-invoicing is not included.
ALTER TABLE orders
  ADD COLUMN service_charge          DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER installation_charge,
  ADD COLUMN gst_type                ENUM('intra_state','inter_state') NOT NULL DEFAULT 'intra_state' AFTER gst_total,
  ADD COLUMN cgst_total              DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER gst_type,
  ADD COLUMN sgst_total              DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER cgst_total,
  ADD COLUMN igst_total              DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER sgst_total,
  ADD COLUMN supplier_invoice_number VARCHAR(60)  NULL,
  ADD COLUMN supplier_invoice_url    VARCHAR(500) NULL;

-- Disputes keep the supplier payout on hold until an admin decides.
CREATE TABLE order_disputes (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id     BIGINT UNSIGNED NOT NULL,
  raised_by    BIGINT UNSIGNED NOT NULL,
  reason       TEXT NOT NULL,
  status       ENUM('open','resolved_release','resolved_refund','closed') NOT NULL DEFAULT 'open',
  resolution_note TEXT NULL,
  resolved_by  BIGINT UNSIGNED NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at  DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_disp_order (order_id),
  KEY idx_disp_status (status),
  CONSTRAINT fk_disp_order FOREIGN KEY (order_id) REFERENCES orders (id),
  CONSTRAINT fk_disp_user FOREIGN KEY (raised_by) REFERENCES users (id),
  CONSTRAINT fk_disp_admin FOREIGN KEY (resolved_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Uploaded files, so a download link can be checked and old files tidied up later.
CREATE TABLE uploaded_files (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uploaded_by   BIGINT UNSIGNED NULL,
  original_name VARCHAR(255) NOT NULL,
  stored_name   VARCHAR(100) NOT NULL,
  mime_type     VARCHAR(100) NOT NULL,
  size_bytes    INT UNSIGNED NOT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_uploaded_stored (stored_name),
  CONSTRAINT fk_upl_user FOREIGN KEY (uploaded_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO platform_settings (setting_key, setting_value, description) VALUES
  ('default_gst_rate',          '12',  'GST percent suggested when a supplier adds a product.'),
  ('rfq_default_quote_days',    '7',   'Days suppliers have to quote when the hospital does not set a deadline.'),
  ('dispute_window_note',       'Raise a dispute before confirming delivery or installation.', 'Shown to buyers next to the dispute button.');

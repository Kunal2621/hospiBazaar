-- 003_rfq.sql
-- RFQ engine and structured quotations (§6, §7). Decision 1: RFQ is for bulk / custom /
-- installation-heavy requirements; ready catalogue items use cart + counter-offer (004).

CREATE TABLE rfqs (
  id                     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  -- HB-RFQ-000001. Filled by the app right after insert, in the same transaction:
  --   UPDATE rfqs SET rfq_number = CONCAT('HB-RFQ-', LPAD(id, 6, '0')) WHERE id = ?
  rfq_number             VARCHAR(20) NULL,
  hospital_id            BIGINT UNSIGNED NOT NULL,
  created_by             BIGINT UNSIGNED NOT NULL,
  title                  VARCHAR(250) NOT NULL,
  delivery_city          VARCHAR(100) NOT NULL,
  delivery_state         VARCHAR(100) NOT NULL,
  delivery_pincode       VARCHAR(10)  NOT NULL,
  required_within_days   INT UNSIGNED NULL COMMENT 'e.g. 30-day requirement',
  warranty_years_required DECIMAL(3,1) NULL,
  installation_required  TINYINT(1) NOT NULL DEFAULT 0,
  notes                  TEXT NULL,
  quotes_due_by          DATETIME NULL,
  status                 ENUM('draft','open','quotes_received','awarded','closed','cancelled') NOT NULL DEFAULT 'draft',
  awarded_quotation_id   BIGINT UNSIGNED NULL,
  created_at             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_rfqs_number (rfq_number),
  KEY idx_rfqs_hospital (hospital_id, status),
  CONSTRAINT fk_rfqs_hospital FOREIGN KEY (hospital_id) REFERENCES hospitals (id),
  CONSTRAINT fk_rfqs_created_by FOREIGN KEY (created_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE rfq_items (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  rfq_id       BIGINT UNSIGNED NOT NULL,
  category_id  BIGINT UNSIGNED NOT NULL,
  product_id   BIGINT UNSIGNED NULL COMMENT 'Set when the RFQ started from a product page',
  item_name    VARCHAR(250) NOT NULL,
  quantity     INT UNSIGNED NOT NULL,
  specifications TEXT NULL,
  PRIMARY KEY (id),
  KEY idx_ri_rfq (rfq_id),
  CONSTRAINT fk_ri_rfq FOREIGN KEY (rfq_id) REFERENCES rfqs (id) ON DELETE CASCADE,
  CONSTRAINT fk_ri_category FOREIGN KEY (category_id) REFERENCES categories (id),
  CONSTRAINT fk_ri_product FOREIGN KEY (product_id) REFERENCES products (id),
  CONSTRAINT chk_ri_qty CHECK (quantity > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Relevant verified suppliers that receive the RFQ.
CREATE TABLE rfq_recipients (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  rfq_id        BIGINT UNSIGNED NOT NULL,
  supplier_id   BIGINT UNSIGNED NOT NULL,
  status        ENUM('sent','viewed','quoted','declined') NOT NULL DEFAULT 'sent',
  sent_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  responded_at  DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_rr (rfq_id, supplier_id),
  KEY idx_rr_supplier (supplier_id, status),
  CONSTRAINT fk_rr_rfq FOREIGN KEY (rfq_id) REFERENCES rfqs (id) ON DELETE CASCADE,
  CONSTRAINT fk_rr_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Comparison fields (§7): unit price + GST per line; freight, installation, service,
-- warranty, delivery time, payment terms and validity on the header.
-- The platform never labels a quotation "best" - no score/rank column on purpose.
CREATE TABLE quotations (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  rfq_id                BIGINT UNSIGNED NOT NULL,
  supplier_id           BIGINT UNSIGNED NOT NULL,
  submitted_by          BIGINT UNSIGNED NOT NULL,
  freight_charge        DECIMAL(14,2) NOT NULL DEFAULT 0,
  installation_charge   DECIMAL(14,2) NOT NULL DEFAULT 0,
  service_charge        DECIMAL(14,2) NOT NULL DEFAULT 0,
  warranty_months       INT UNSIGNED NULL,
  service_terms         TEXT NULL,
  delivery_days         INT UNSIGNED NOT NULL,
  payment_terms         VARCHAR(500) NULL,
  valid_until           DATE NOT NULL,
  notes                 TEXT NULL,
  subtotal              DECIMAL(14,2) NOT NULL DEFAULT 0,
  gst_total             DECIMAL(14,2) NOT NULL DEFAULT 0,
  total_amount          DECIMAL(14,2) NOT NULL DEFAULT 0,
  status                ENUM('submitted','withdrawn','accepted','rejected','expired') NOT NULL DEFAULT 'submitted',
  submitted_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_quotation_rfq_supplier (rfq_id, supplier_id),
  KEY idx_quotations_supplier (supplier_id),
  CONSTRAINT fk_q_rfq FOREIGN KEY (rfq_id) REFERENCES rfqs (id),
  CONSTRAINT fk_q_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers (id),
  CONSTRAINT fk_q_user FOREIGN KEY (submitted_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE quotation_items (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  quotation_id  BIGINT UNSIGNED NOT NULL,
  rfq_item_id   BIGINT UNSIGNED NOT NULL,
  product_id    BIGINT UNSIGNED NULL COMMENT 'Supplier catalogue product offered, if any',
  brand_model   VARCHAR(250) NULL,
  quantity      INT UNSIGNED NOT NULL,
  unit_price    DECIMAL(14,2) NOT NULL,
  gst_rate      DECIMAL(5,2) NOT NULL,
  line_subtotal DECIMAL(14,2) NOT NULL,
  line_gst      DECIMAL(14,2) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_qi (quotation_id, rfq_item_id),
  CONSTRAINT fk_qi_quotation FOREIGN KEY (quotation_id) REFERENCES quotations (id) ON DELETE CASCADE,
  CONSTRAINT fk_qi_rfq_item FOREIGN KEY (rfq_item_id) REFERENCES rfq_items (id),
  CONSTRAINT fk_qi_product FOREIGN KEY (product_id) REFERENCES products (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE rfqs
  ADD CONSTRAINT fk_rfqs_awarded FOREIGN KEY (awarded_quotation_id) REFERENCES quotations (id);

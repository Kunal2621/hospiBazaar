-- 005_orders_payments.sql
-- Orders, payments (Razorpay), payouts, deliveries, manual-order requests (§8, §17).
-- Decision 2: the online cap applies to cart AND RFQ orders; above it, admin creates the order.
-- Decision 3: supplier payout is held until delivery (and installation, where required) is confirmed.

-- Cart checkout blocked by the cap lands here so the team can connect with the buyer (§17).
CREATE TABLE manual_order_requests (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  hospital_id        BIGINT UNSIGNED NOT NULL,
  requested_by       BIGINT UNSIGNED NOT NULL,
  source             ENUM('cart','rfq') NOT NULL,
  rfq_id             BIGINT UNSIGNED NULL,
  quotation_id       BIGINT UNSIGNED NULL,
  cart_snapshot      JSON NULL,
  total_amount       DECIMAL(14,2) NOT NULL,
  status             ENUM('new','contacted','converted','closed') NOT NULL DEFAULT 'new',
  assigned_admin_id  BIGINT UNSIGNED NULL,
  admin_notes        TEXT NULL,
  converted_order_id BIGINT UNSIGNED NULL,
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_mor_status (status),
  CONSTRAINT fk_mor_hospital FOREIGN KEY (hospital_id) REFERENCES hospitals (id),
  CONSTRAINT fk_mor_user FOREIGN KEY (requested_by) REFERENCES users (id),
  CONSTRAINT fk_mor_rfq FOREIGN KEY (rfq_id) REFERENCES rfqs (id),
  CONSTRAINT fk_mor_quotation FOREIGN KEY (quotation_id) REFERENCES quotations (id),
  CONSTRAINT fk_mor_admin FOREIGN KEY (assigned_admin_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One order per supplier. A mixed-supplier cart is split into several orders at checkout.
CREATE TABLE orders (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_number          VARCHAR(20) NULL COMMENT 'HB-ORD-000001, set by app after insert',
  po_number             VARCHAR(20) NULL COMMENT 'Purchase Order reference sent to supplier',
  hospital_id           BIGINT UNSIGNED NOT NULL,
  supplier_id           BIGINT UNSIGNED NOT NULL,
  placed_by             BIGINT UNSIGNED NOT NULL COMMENT 'Hospital user, or admin when created_via = manual_admin',
  source                ENUM('cart','rfq') NOT NULL,
  created_via           ENUM('online','manual_admin') NOT NULL DEFAULT 'online',
  rfq_id                BIGINT UNSIGNED NULL,
  quotation_id          BIGINT UNSIGNED NULL,
  manual_request_id     BIGINT UNSIGNED NULL,
  status                ENUM(
                          'pending_supplier_confirmation','confirmed','payment_pending','paid',
                          'dispatched','delivered','installed','completed','cancelled'
                        ) NOT NULL DEFAULT 'pending_supplier_confirmation',
  subtotal              DECIMAL(14,2) NOT NULL,
  gst_total             DECIMAL(14,2) NOT NULL DEFAULT 0,
  freight_charge        DECIMAL(14,2) NOT NULL DEFAULT 0,
  installation_charge   DECIMAL(14,2) NOT NULL DEFAULT 0,
  total_amount          DECIMAL(14,2) NOT NULL,
  installation_required TINYINT(1) NOT NULL DEFAULT 0,
  delivery_address      VARCHAR(500) NOT NULL,
  delivery_city         VARCHAR(100) NOT NULL,
  delivery_state        VARCHAR(100) NOT NULL,
  delivery_pincode      VARCHAR(10)  NOT NULL,
  payment_terms         VARCHAR(500) NULL,
  cancelled_reason      VARCHAR(500) NULL,
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_orders_number (order_number),
  KEY idx_orders_hospital (hospital_id, status),
  KEY idx_orders_supplier (supplier_id, status),
  CONSTRAINT fk_orders_hospital FOREIGN KEY (hospital_id) REFERENCES hospitals (id),
  CONSTRAINT fk_orders_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers (id),
  CONSTRAINT fk_orders_placed_by FOREIGN KEY (placed_by) REFERENCES users (id),
  CONSTRAINT fk_orders_rfq FOREIGN KEY (rfq_id) REFERENCES rfqs (id),
  CONSTRAINT fk_orders_quotation FOREIGN KEY (quotation_id) REFERENCES quotations (id),
  CONSTRAINT fk_orders_manual FOREIGN KEY (manual_request_id) REFERENCES manual_order_requests (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE manual_order_requests
  ADD CONSTRAINT fk_mor_order FOREIGN KEY (converted_order_id) REFERENCES orders (id);

CREATE TABLE order_items (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id        BIGINT UNSIGNED NOT NULL,
  product_id      BIGINT UNSIGNED NOT NULL,
  negotiation_id  BIGINT UNSIGNED NULL,
  item_name       VARCHAR(250) NOT NULL COMMENT 'Snapshot at order time',
  model_number    VARCHAR(100) NULL,
  quantity        INT UNSIGNED NOT NULL,
  unit_price      DECIMAL(14,2) NOT NULL,
  gst_rate        DECIMAL(5,2) NOT NULL,
  line_subtotal   DECIMAL(14,2) NOT NULL,
  line_gst        DECIMAL(14,2) NOT NULL,
  warranty_months INT UNSIGNED NULL,
  PRIMARY KEY (id),
  KEY idx_oi_order (order_id),
  CONSTRAINT fk_oi_order FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE,
  CONSTRAINT fk_oi_product FOREIGN KEY (product_id) REFERENCES products (id),
  CONSTRAINT fk_oi_negotiation FOREIGN KEY (negotiation_id) REFERENCES negotiations (negotiation_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE order_status_history (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id     BIGINT UNSIGNED NOT NULL,
  from_status  VARCHAR(40) NULL,
  to_status    VARCHAR(40) NOT NULL,
  changed_by   BIGINT UNSIGNED NULL,
  note         VARCHAR(500) NULL,
  changed_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_osh_order (order_id, changed_at),
  CONSTRAINT fk_osh_order FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE,
  CONSTRAINT fk_osh_user FOREIGN KEY (changed_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- Payments (Razorpay)
-- The platform receives the full amount from Razorpay even for EMI (§17); is_emi is
-- informational only and carries no credit risk.
CREATE TABLE payments (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id              BIGINT UNSIGNED NOT NULL,
  razorpay_order_id     VARCHAR(64) NOT NULL,
  razorpay_payment_id   VARCHAR(64) NULL,
  razorpay_signature    VARCHAR(128) NULL,
  amount                DECIMAL(14,2) NOT NULL,
  currency              CHAR(3) NOT NULL DEFAULT 'INR',
  method                VARCHAR(30) NULL COMMENT 'card, upi, netbanking, wallet, emi',
  is_emi                TINYINT(1) NOT NULL DEFAULT 0,
  status                ENUM('created','authorized','captured','failed','refunded','partially_refunded') NOT NULL DEFAULT 'created',
  failure_reason        VARCHAR(500) NULL,
  captured_at           DATETIME NULL,
  gateway_payload       JSON NULL,
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_payments_rzp_order (razorpay_order_id),
  UNIQUE KEY uq_payments_rzp_payment (razorpay_payment_id),
  KEY idx_payments_order (order_id),
  CONSTRAINT fk_payments_order FOREIGN KEY (order_id) REFERENCES orders (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE refunds (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  payment_id           BIGINT UNSIGNED NOT NULL,
  razorpay_refund_id   VARCHAR(64) NULL,
  amount               DECIMAL(14,2) NOT NULL,
  reason               VARCHAR(500) NULL,
  status               ENUM('requested','processed','failed') NOT NULL DEFAULT 'requested',
  requested_by         BIGINT UNSIGNED NULL,
  created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at         DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_refunds_rzp (razorpay_refund_id),
  CONSTRAINT fk_refunds_payment FOREIGN KEY (payment_id) REFERENCES payments (id),
  CONSTRAINT fk_refunds_user FOREIGN KEY (requested_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Decision 3: funds are held, then released after delivery confirmation, minus platform fee.
CREATE TABLE supplier_payouts (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id            BIGINT UNSIGNED NOT NULL,
  supplier_id         BIGINT UNSIGNED NOT NULL,
  gross_amount        DECIMAL(14,2) NOT NULL,
  platform_fee_rate   DECIMAL(5,2) NOT NULL COMMENT 'Percent, snapshot of setting at order time',
  platform_fee        DECIMAL(14,2) NOT NULL,
  net_amount          DECIMAL(14,2) NOT NULL,
  status              ENUM('held','eligible','released','failed','reversed') NOT NULL DEFAULT 'held',
  eligible_at         DATETIME NULL COMMENT 'Set when delivery (and installation) is confirmed',
  released_at         DATETIME NULL,
  bank_reference      VARCHAR(100) NULL,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_payout_order (order_id),
  KEY idx_payout_status (status, eligible_at),
  CONSTRAINT fk_payout_order FOREIGN KEY (order_id) REFERENCES orders (id),
  CONSTRAINT fk_payout_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- Deliveries
-- Detailed logistics design is reserved (§21); this keeps only what the lifecycle needs.
CREATE TABLE deliveries (
  id                       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id                 BIGINT UNSIGNED NOT NULL,
  delivery_type            ENUM('small_parcel','large_equipment') NOT NULL,
  carrier_name             VARCHAR(150) NULL,
  tracking_reference       VARCHAR(150) NULL,
  dispatched_at            DATETIME NULL,
  delivered_at             DATETIME NULL,
  buyer_confirmed_at       DATETIME NULL,
  auto_confirm_at          DATETIME NULL COMMENT 'delivered_at + delivery_auto_confirm_days if the buyer never confirms',
  confirmed_by_system      TINYINT(1) NOT NULL DEFAULT 0,
  installed_at             DATETIME NULL,
  installation_confirmed_at DATETIME NULL,
  notes                    TEXT NULL,
  created_at               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_deliveries_order (order_id),
  KEY idx_deliveries_auto (auto_confirm_at),
  CONSTRAINT fk_deliveries_order FOREIGN KEY (order_id) REFERENCES orders (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

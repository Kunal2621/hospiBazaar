-- 004_negotiation_cart.sql
-- Per-item counter-offer negotiation (§18) and the cart.
-- Decisions: 4 = auto-close after inactivity, 5 = time-limited price lock after agreement,
-- 6 = quantity fixed per negotiation (a different quantity means a new negotiation).

CREATE TABLE negotiations (
  negotiation_id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  product_id             BIGINT UNSIGNED NOT NULL,
  buyer_id               BIGINT UNSIGNED NOT NULL COMMENT 'hospitals.id',
  supplier_id            BIGINT UNSIGNED NOT NULL,
  started_by_user_id     BIGINT UNSIGNED NOT NULL,
  quantity               INT UNSIGNED NOT NULL,
  listed_price           DECIMAL(14,2) NOT NULL COMMENT 'Unit price at the moment negotiation started',
  status                 ENUM('open','agreed','closed_no_deal') NOT NULL DEFAULT 'open',
  close_reason           ENUM('walked_away','expired','withdrawn_by_admin') NULL,
  agreed_price           DECIMAL(14,2) NULL COMMENT 'Per unit',
  last_activity_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at             DATETIME NOT NULL COMMENT 'last_activity_at + negotiation_inactivity_days; pushed forward on each message',
  created_at             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at              DATETIME NULL,
  PRIMARY KEY (negotiation_id),
  KEY idx_neg_product (product_id),
  KEY idx_neg_buyer (buyer_id, status),
  KEY idx_neg_supplier (supplier_id, status),
  KEY idx_neg_expiry (status, expires_at),
  CONSTRAINT fk_neg_product FOREIGN KEY (product_id) REFERENCES products (id),
  CONSTRAINT fk_neg_buyer FOREIGN KEY (buyer_id) REFERENCES hospitals (id),
  CONSTRAINT fk_neg_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers (id),
  CONSTRAINT fk_neg_user FOREIGN KEY (started_by_user_id) REFERENCES users (id),
  CONSTRAINT chk_neg_qty CHECK (quantity > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Open-ended, chat-style: each row is an offer (amount + note) or a plain note.
CREATE TABLE negotiation_messages (
  message_id      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  negotiation_id  BIGINT UNSIGNED NOT NULL,
  sender          ENUM('buyer','supplier') NOT NULL,
  sender_user_id  BIGINT UNSIGNED NOT NULL,
  offer_amount    DECIMAL(14,2) NULL COMMENT 'Per unit; NULL for a note-only message',
  note            TEXT NULL,
  is_acceptance   TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Sender accepts the other side''s latest offer',
  sent_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (message_id),
  KEY idx_nm_negotiation (negotiation_id, sent_at),
  CONSTRAINT fk_nm_negotiation FOREIGN KEY (negotiation_id) REFERENCES negotiations (negotiation_id) ON DELETE CASCADE,
  CONSTRAINT fk_nm_user FOREIGN KEY (sender_user_id) REFERENCES users (id),
  CONSTRAINT chk_nm_content CHECK (offer_amount IS NOT NULL OR note IS NOT NULL OR is_acceptance = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- Cart

CREATE TABLE carts (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  hospital_id  BIGINT UNSIGNED NOT NULL,
  user_id      BIGINT UNSIGNED NOT NULL,
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_carts_user (hospital_id, user_id),
  CONSTRAINT fk_carts_hospital FOREIGN KEY (hospital_id) REFERENCES hospitals (id),
  CONSTRAINT fk_carts_user FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A negotiated item enters the cart at the agreed price (§18) and keeps it only until
-- price_locked_until (decision 5). After that the app reverts it to the listed price or
-- removes it; negotiation_id stays for traceability.
CREATE TABLE cart_items (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  cart_id             BIGINT UNSIGNED NOT NULL,
  product_id          BIGINT UNSIGNED NOT NULL,
  quantity            INT UNSIGNED NOT NULL,
  unit_price          DECIMAL(14,2) NOT NULL,
  negotiation_id      BIGINT UNSIGNED NULL,
  price_locked_until  DATETIME NULL,
  added_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_cart_product_neg (cart_id, product_id, negotiation_id),
  KEY idx_ci_lock (price_locked_until),
  CONSTRAINT fk_ci_cart FOREIGN KEY (cart_id) REFERENCES carts (id) ON DELETE CASCADE,
  CONSTRAINT fk_ci_product FOREIGN KEY (product_id) REFERENCES products (id),
  CONSTRAINT fk_ci_negotiation FOREIGN KEY (negotiation_id) REFERENCES negotiations (negotiation_id),
  CONSTRAINT chk_ci_qty CHECK (quantity > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

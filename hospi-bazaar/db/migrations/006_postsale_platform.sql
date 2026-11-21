-- 006_postsale_platform.sql
-- Warranty, service, notifications, audit logs, platform settings (§8, §9).

CREATE TABLE warranties (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_item_id     BIGINT UNSIGNED NOT NULL,
  hospital_id       BIGINT UNSIGNED NOT NULL,
  supplier_id       BIGINT UNSIGNED NOT NULL,
  product_id        BIGINT UNSIGNED NOT NULL,
  model_number      VARCHAR(100) NULL,
  serial_number     VARCHAR(100) NULL,
  purchase_date     DATE NOT NULL,
  installation_date DATE NULL,
  warranty_months   INT UNSIGNED NOT NULL,
  expires_on        DATE NULL COMMENT 'Computed by the app from installation_date (or delivery) + warranty_months',
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_war_hospital (hospital_id, expires_on),
  KEY idx_war_serial (serial_number),
  CONSTRAINT fk_war_order_item FOREIGN KEY (order_item_id) REFERENCES order_items (id),
  CONSTRAINT fk_war_hospital FOREIGN KEY (hospital_id) REFERENCES hospitals (id),
  CONSTRAINT fk_war_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers (id),
  CONSTRAINT fk_war_product FOREIGN KEY (product_id) REFERENCES products (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE service_requests (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ticket_number VARCHAR(20) NULL COMMENT 'HB-SR-000001, set by app after insert',
  hospital_id   BIGINT UNSIGNED NOT NULL,
  supplier_id   BIGINT UNSIGNED NOT NULL,
  warranty_id   BIGINT UNSIGNED NULL,
  raised_by     BIGINT UNSIGNED NOT NULL,
  issue_summary VARCHAR(300) NOT NULL,
  description   TEXT NULL,
  priority      ENUM('low','normal','high','critical') NOT NULL DEFAULT 'normal',
  status        ENUM('open','acknowledged','in_progress','resolved','closed') NOT NULL DEFAULT 'open',
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  resolved_at   DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sr_ticket (ticket_number),
  KEY idx_sr_hospital (hospital_id, status),
  KEY idx_sr_supplier (supplier_id, status),
  CONSTRAINT fk_sr_hospital FOREIGN KEY (hospital_id) REFERENCES hospitals (id),
  CONSTRAINT fk_sr_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers (id),
  CONSTRAINT fk_sr_warranty FOREIGN KEY (warranty_id) REFERENCES warranties (id),
  CONSTRAINT fk_sr_user FOREIGN KEY (raised_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE service_request_updates (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  service_request_id  BIGINT UNSIGNED NOT NULL,
  user_id             BIGINT UNSIGNED NOT NULL,
  message             TEXT NOT NULL,
  new_status          VARCHAR(30) NULL,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_sru_request (service_request_id, created_at),
  CONSTRAINT fk_sru_request FOREIGN KEY (service_request_id) REFERENCES service_requests (id) ON DELETE CASCADE,
  CONSTRAINT fk_sru_user FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Channels are still to be finalised (§16); 'channel' is kept open as a string-backed enum.
CREATE TABLE notifications (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id       BIGINT UNSIGNED NOT NULL,
  channel       ENUM('in_app','email','sms','whatsapp') NOT NULL DEFAULT 'in_app',
  event_type    VARCHAR(60) NOT NULL COMMENT 'e.g. rfq_received, quotation_received, negotiation_offer, order_status',
  title         VARCHAR(200) NOT NULL,
  body          TEXT NULL,
  entity_type   VARCHAR(40) NULL,
  entity_id     BIGINT UNSIGNED NULL,
  status        ENUM('pending','sent','failed','read') NOT NULL DEFAULT 'pending',
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at       DATETIME NULL,
  read_at       DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_notif_user (user_id, status, created_at),
  CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE audit_logs (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_id     BIGINT UNSIGNED NULL COMMENT 'NULL for system actions (e.g. negotiation expiry job)',
  action       VARCHAR(80) NOT NULL,
  entity_type  VARCHAR(40) NOT NULL,
  entity_id    BIGINT UNSIGNED NULL,
  old_values   JSON NULL,
  new_values   JSON NULL,
  ip_address   VARCHAR(45) NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_audit_entity (entity_type, entity_id),
  KEY idx_audit_actor (actor_id, created_at),
  CONSTRAINT fk_audit_actor FOREIGN KEY (actor_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tunable business rules live in the database so they can change without a deploy.
CREATE TABLE platform_settings (
  setting_key    VARCHAR(80) NOT NULL,
  setting_value  VARCHAR(255) NOT NULL,
  description    VARCHAR(500) NULL,
  updated_by     BIGINT UNSIGNED NULL,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (setting_key),
  CONSTRAINT fk_ps_user FOREIGN KEY (updated_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

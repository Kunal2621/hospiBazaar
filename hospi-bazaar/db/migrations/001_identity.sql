-- 001_identity.sql
-- Users, hospitals (buyers), suppliers, verification, terms acceptance.
-- Spec refs: §5, §19, §20. Decision 7: light buyer verification before first order.

CREATE TABLE users (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  full_name      VARCHAR(150) NOT NULL,
  email          VARCHAR(190) NOT NULL,
  mobile         VARCHAR(20)  NOT NULL,
  password_hash  VARCHAR(255) NOT NULL,
  user_type      ENUM('hospital_user','supplier_user','admin') NOT NULL,
  admin_role     ENUM('super_admin','verifier','catalog_manager','support') NULL,
  status         ENUM('active','suspended','invited') NOT NULL DEFAULT 'active',
  last_login_at  DATETIME NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email),
  KEY idx_users_mobile (mobile),
  KEY idx_users_type (user_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Versioned T&C documents (spec §20): every acceptance records which version was signed.
CREATE TABLE terms_versions (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  audience      ENUM('buyer','supplier') NOT NULL,
  version       VARCHAR(20) NOT NULL,
  document_url  VARCHAR(500) NOT NULL,
  published_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_terms_audience_version (audience, version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- Hospitals (buyers)

CREATE TABLE hospitals (
  id                          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  hospital_name               VARCHAR(200) NOT NULL,
  hospital_type               ENUM('government','private','trust','clinic','nursing_home') NOT NULL,
  registration_number         VARCHAR(100) NOT NULL COMMENT 'Clinical establishment / hospital licence no.',
  registered_address          VARCHAR(500) NOT NULL,
  city                        VARCHAR(100) NOT NULL,
  state                       VARCHAR(100) NOT NULL,
  pincode                     VARCHAR(10)  NOT NULL,
  phone                       VARCHAR(20)  NOT NULL,
  email                       VARCHAR(190) NOT NULL,
  website                     VARCHAR(255) NULL,
  contact_person_name         VARCHAR(150) NOT NULL,
  contact_person_designation  VARCHAR(100) NOT NULL,
  contact_person_mobile       VARCHAR(20)  NOT NULL,
  contact_person_email        VARCHAR(190) NOT NULL,
  gstin                       VARCHAR(15)  NOT NULL,
  pan                         VARCHAR(10)  NOT NULL,
  account_status              ENUM('pending','active','suspended') NOT NULL DEFAULT 'pending',
  -- Decision 7: browse / RFQ / negotiate right after sign-up; must be verified before first order.
  verification_status         ENUM('unverified','under_review','verified','rejected') NOT NULL DEFAULT 'unverified',
  verified_at                 DATETIME NULL,
  verified_by                 BIGINT UNSIGNED NULL,
  rejection_reason            VARCHAR(500) NULL,
  created_at                  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_hospitals_gstin (gstin),
  KEY idx_hospitals_city (city),
  KEY idx_hospitals_verification (verification_status),
  CONSTRAINT fk_hospitals_verified_by FOREIGN KEY (verified_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE hospital_users (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  hospital_id  BIGINT UNSIGNED NOT NULL,
  user_id      BIGINT UNSIGNED NOT NULL,
  full_name    VARCHAR(150) NOT NULL,
  mobile       VARCHAR(20)  NOT NULL,
  email        VARCHAR(190) NOT NULL,
  role         ENUM('hospital_admin','purchase_manager','purchase_executive','doctor','biomedical_engineer') NOT NULL,
  status       ENUM('active','invited','suspended') NOT NULL DEFAULT 'active',
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_hospital_users (hospital_id, user_id),
  CONSTRAINT fk_hu_hospital FOREIGN KEY (hospital_id) REFERENCES hospitals (id),
  CONSTRAINT fk_hu_user FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- Suppliers

CREATE TABLE suppliers (
  id                     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_name           VARCHAR(200) NOT NULL,
  supplier_type          ENUM('manufacturer','brand_oem','authorised_dealer','distributor') NOT NULL,
  registered_address     VARCHAR(500) NOT NULL,
  city                   VARCHAR(100) NOT NULL,
  state                  VARCHAR(100) NOT NULL,
  pincode                VARCHAR(10)  NOT NULL,
  phone                  VARCHAR(20)  NOT NULL,
  email                  VARCHAR(190) NOT NULL,
  website                VARCHAR(255) NULL,
  pan                    VARCHAR(10)  NOT NULL,
  gstin                  VARCHAR(15)  NOT NULL,
  business_proof_type    ENUM('incorporation_certificate','udyam','shop_establishment','trade_license') NOT NULL,
  business_proof_number  VARCHAR(100) NOT NULL,
  has_own_factory        TINYINT(1) NOT NULL DEFAULT 0,
  factory_address        VARCHAR(500) NULL,
  trademark_number       VARCHAR(100) NULL,
  service_capability_note TEXT NULL,
  account_status         ENUM('pending','active','suspended') NOT NULL DEFAULT 'pending',
  created_at             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_suppliers_gstin (gstin),
  KEY idx_suppliers_type (supplier_type),
  KEY idx_suppliers_state (state)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE supplier_users (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  supplier_id  BIGINT UNSIGNED NOT NULL,
  user_id      BIGINT UNSIGNED NOT NULL,
  role         ENUM('owner','sales','operations','service') NOT NULL DEFAULT 'owner',
  status       ENUM('active','invited','suspended') NOT NULL DEFAULT 'active',
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_supplier_users (supplier_id, user_id),
  CONSTRAINT fk_su_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers (id),
  CONSTRAINT fk_su_user FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Bank details kept apart from the main supplier row: sensitive, used for payouts/refunds (§19).
CREATE TABLE supplier_bank_accounts (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  supplier_id           BIGINT UNSIGNED NOT NULL,
  account_holder_name   VARCHAR(200) NOT NULL,
  account_number        VARCHAR(40)  NOT NULL,
  ifsc                  VARCHAR(11)  NOT NULL,
  cancelled_cheque_url  VARCHAR(500) NOT NULL,
  is_primary            TINYINT(1) NOT NULL DEFAULT 1,
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_sba_supplier (supplier_id),
  CONSTRAINT fk_sba_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE supplier_service_locations (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  supplier_id  BIGINT UNSIGNED NOT NULL,
  state        VARCHAR(100) NOT NULL,
  city         VARCHAR(100) NULL,
  address      VARCHAR(500) NULL COMMENT 'Service centre address, if any',
  contact_name VARCHAR(150) NULL,
  contact_phone VARCHAR(20) NULL,
  PRIMARY KEY (id),
  KEY idx_ssl_supplier (supplier_id),
  KEY idx_ssl_state (state),
  CONSTRAINT fk_ssl_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE supplier_documents (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  supplier_id    BIGINT UNSIGNED NOT NULL,
  document_type  ENUM(
                   'business_proof','factory_license','udyam','trademark','iso_13485','cdsco_licence',
                   'dealer_authorisation','distribution_agreement','sourcing_invoice',
                   'cancelled_cheque','service_proof','other'
                 ) NOT NULL,
  file_url       VARCHAR(500) NOT NULL,
  valid_until    DATE NULL COMMENT 'e.g. dealer authorisation validity',
  uploaded_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_sd_supplier (supplier_id),
  CONSTRAINT fk_sd_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One current verification record per supplier. Re-application after rejection resets it
-- to 'pending'; past outcomes are kept in audit_logs (see 006).
CREATE TABLE supplier_verification (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  supplier_id          BIGINT UNSIGNED NOT NULL,
  verification_status  ENUM('pending','under_verification','verified','rejected') NOT NULL DEFAULT 'pending',
  checklist            JSON NULL COMMENT 'Per-document pass/fail',
  verified_at          DATETIME NULL,
  verified_by          BIGINT UNSIGNED NULL,
  rejection_reason     VARCHAR(500) NULL,
  updated_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sv_supplier (supplier_id),
  KEY idx_sv_status (verification_status),
  CONSTRAINT fk_sv_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers (id),
  CONSTRAINT fk_sv_verified_by FOREIGN KEY (verified_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- Terms acceptance (§20)

CREATE TABLE terms_acceptances (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  terms_version_id  BIGINT UNSIGNED NOT NULL,
  hospital_id       BIGINT UNSIGNED NULL,
  supplier_id       BIGINT UNSIGNED NULL,
  accepted_by       BIGINT UNSIGNED NOT NULL,
  accepted_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ip_address        VARCHAR(45) NULL,
  PRIMARY KEY (id),
  KEY idx_ta_hospital (hospital_id),
  KEY idx_ta_supplier (supplier_id),
  CONSTRAINT fk_ta_version FOREIGN KEY (terms_version_id) REFERENCES terms_versions (id),
  CONSTRAINT fk_ta_hospital FOREIGN KEY (hospital_id) REFERENCES hospitals (id),
  CONSTRAINT fk_ta_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers (id),
  CONSTRAINT fk_ta_user FOREIGN KEY (accepted_by) REFERENCES users (id),
  CONSTRAINT chk_ta_one_party CHECK ((hospital_id IS NOT NULL) <> (supplier_id IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 002_catalog.sql
-- Category master, brands, products and product documents (§2, §3, §5, §9).

CREATE TABLE categories (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  parent_id   BIGINT UNSIGNED NULL,
  name        VARCHAR(150) NOT NULL,
  slug        VARCHAR(160) NOT NULL,
  sort_order  INT NOT NULL DEFAULT 0,
  is_active   TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_categories_slug (slug),
  KEY idx_categories_parent (parent_id),
  CONSTRAINT fk_categories_parent FOREIGN KEY (parent_id) REFERENCES categories (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE brands (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name       VARCHAR(150) NOT NULL,
  slug       VARCHAR(160) NOT NULL,
  logo_url   VARCHAR(500) NULL,
  is_active  TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_brands_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Which categories / brands a supplier registered for (§5, §20: categories[], brands[]).
CREATE TABLE supplier_categories (
  supplier_id  BIGINT UNSIGNED NOT NULL,
  category_id  BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (supplier_id, category_id),
  CONSTRAINT fk_sc_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers (id),
  CONSTRAINT fk_sc_category FOREIGN KEY (category_id) REFERENCES categories (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE supplier_brands (
  supplier_id  BIGINT UNSIGNED NOT NULL,
  brand_id     BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (supplier_id, brand_id),
  CONSTRAINT fk_sb_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers (id),
  CONSTRAINT fk_sb_brand FOREIGN KEY (brand_id) REFERENCES brands (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Products are listed by a verified supplier and approved by admin before going public.
-- unit_price is the single displayed price (§18). Negotiation eligibility is NOT stored:
-- it is derived at runtime as unit_price > platform_settings.negotiation_min_unit_price.
CREATE TABLE products (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  supplier_id        BIGINT UNSIGNED NOT NULL,
  category_id        BIGINT UNSIGNED NOT NULL,
  brand_id           BIGINT UNSIGNED NULL,
  name               VARCHAR(250) NOT NULL,
  slug               VARCHAR(270) NOT NULL,
  model_number       VARCHAR(100) NULL,
  sku                VARCHAR(100) NULL,
  short_description  VARCHAR(500) NULL,
  description        TEXT NULL,
  specifications     JSON NULL,
  unit_price         DECIMAL(14,2) NOT NULL,
  gst_rate           DECIMAL(5,2) NOT NULL DEFAULT 12.00,
  hsn_code           VARCHAR(10) NULL,
  min_order_qty      INT UNSIGNED NOT NULL DEFAULT 1,
  stock_status       ENUM('in_stock','made_to_order','out_of_stock') NOT NULL DEFAULT 'in_stock',
  lead_time_days     INT UNSIGNED NULL,
  warranty_months    INT UNSIGNED NULL,
  installation_available TINYINT(1) NOT NULL DEFAULT 0,
  logistics_type     ENUM('small_parcel','large_equipment') NOT NULL DEFAULT 'large_equipment'
                     COMMENT 'Placeholder for §21 logistics design',
  status             ENUM('draft','pending_approval','approved','rejected','inactive') NOT NULL DEFAULT 'draft',
  approved_by        BIGINT UNSIGNED NULL,
  approved_at        DATETIME NULL,
  rejection_reason   VARCHAR(500) NULL,
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_products_slug (slug),
  KEY idx_products_supplier (supplier_id),
  KEY idx_products_category (category_id, status),
  KEY idx_products_brand (brand_id),
  FULLTEXT KEY ft_products_search (name, short_description),
  CONSTRAINT fk_products_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers (id),
  CONSTRAINT fk_products_category FOREIGN KEY (category_id) REFERENCES categories (id),
  CONSTRAINT fk_products_brand FOREIGN KEY (brand_id) REFERENCES brands (id),
  CONSTRAINT fk_products_approved_by FOREIGN KEY (approved_by) REFERENCES users (id),
  CONSTRAINT chk_products_price CHECK (unit_price >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE product_images (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  product_id  BIGINT UNSIGNED NOT NULL,
  image_url   VARCHAR(500) NOT NULL,
  sort_order  INT NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_pi_product (product_id),
  CONSTRAINT fk_pi_product FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE product_documents (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  product_id     BIGINT UNSIGNED NOT NULL,
  document_type  ENUM('brochure','datasheet','certificate','manual','other') NOT NULL,
  file_url       VARCHAR(500) NOT NULL,
  uploaded_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_pd_product (product_id),
  CONSTRAINT fk_pd_product FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

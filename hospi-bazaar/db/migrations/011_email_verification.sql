-- Email verification: a marker on the user and single-use, expiring links (only a hash is stored).
-- Everyone who already has an account is treated as verified so nobody is locked out by the upgrade.
ALTER TABLE users ADD COLUMN email_verified_at DATETIME NULL AFTER email;
UPDATE users SET email_verified_at = NOW() WHERE email_verified_at IS NULL;

CREATE TABLE email_verifications (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     BIGINT UNSIGNED NOT NULL,
  token_hash  CHAR(64) NOT NULL,
  expires_at  DATETIME NOT NULL,
  used_at     DATETIME NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_email_verifications_hash (token_hash),
  KEY idx_email_verifications_user (user_id),
  CONSTRAINT fk_email_verifications_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
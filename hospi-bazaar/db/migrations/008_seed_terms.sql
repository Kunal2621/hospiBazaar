-- 008_seed_terms.sql
-- First version of the buyer and supplier Terms & Conditions.
-- document_url is a placeholder: replace with the real hosted T&C documents before launch.
INSERT INTO terms_versions (audience, version, document_url) VALUES
  ('buyer',    '1.0', 'https://example.com/terms/buyer-v1.0'),
  ('supplier', '1.0', 'https://example.com/terms/supplier-v1.0');

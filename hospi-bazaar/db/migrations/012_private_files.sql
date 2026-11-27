-- Private files: documents, cancelled cheques and invoices are no longer open to anyone with the link.
-- Product photos and brochures stay public. Files uploaded before this change stay public so nothing breaks.
ALTER TABLE uploaded_files ADD COLUMN visibility ENUM('public','private') NOT NULL DEFAULT 'private' AFTER size_bytes;
UPDATE uploaded_files SET visibility = 'public';
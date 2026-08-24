-- Bind uploads to the authenticated uploader (prevents attachment hijacking).
ALTER TABLE attachments ADD COLUMN uploader_id TEXT REFERENCES users(id) ON DELETE SET NULL;

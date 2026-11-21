-- Refresh-token rotation with reuse detection: a used token is kept (marked
-- used_at) so presenting it again revokes its whole login family.
ALTER TABLE refresh_tokens ADD COLUMN family_id TEXT;
ALTER TABLE refresh_tokens ADD COLUMN used_at TEXT;
UPDATE refresh_tokens SET family_id = id WHERE family_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family ON refresh_tokens(family_id);

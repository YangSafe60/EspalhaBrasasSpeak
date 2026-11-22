-- Encrypted attachments that went to Litterbox (72 h) because Catbox was
-- down. The server moves them to Catbox in the background; until then this
-- is when the Litterbox copy expires. NULL = permanent.
ALTER TABLE attachments ADD COLUMN temporary_until TEXT;
CREATE INDEX IF NOT EXISTS idx_attachments_temporary ON attachments(temporary_until)
    WHERE temporary_until IS NOT NULL;

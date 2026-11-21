-- Pinned channel messages.
ALTER TABLE messages ADD COLUMN pinned_at TEXT;
ALTER TABLE messages ADD COLUMN pinned_by TEXT;
CREATE INDEX IF NOT EXISTS idx_messages_channel_pinned ON messages(channel_id, pinned_at)
    WHERE pinned_at IS NOT NULL;

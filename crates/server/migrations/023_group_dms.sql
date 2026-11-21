-- Group DMs: several people in one encrypted conversation.
ALTER TABLE dm_channels ADD COLUMN is_group INTEGER NOT NULL DEFAULT 0;
ALTER TABLE dm_channels ADD COLUMN name TEXT;
ALTER TABLE dm_channels ADD COLUMN owner_id TEXT REFERENCES users(id) ON DELETE SET NULL;
-- Group messages: the message key wrapped once per member (JSON array).
ALTER TABLE dm_messages ADD COLUMN key_envelopes TEXT;

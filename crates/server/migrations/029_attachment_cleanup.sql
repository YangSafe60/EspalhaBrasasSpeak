-- Attachments go with their message. attachments.message_id points at either
-- messages or dm_messages, so it can't be a foreign key; triggers do it
-- instead (they also fire for cascades: deleting a channel, server, DM or
-- user). The file stays on Catbox (anonymous uploads can't be deleted), but
-- without the row its key is gone, so an encrypted file can't be read.
CREATE TRIGGER IF NOT EXISTS trg_messages_delete_attachments
AFTER DELETE ON messages
BEGIN
    DELETE FROM attachments WHERE message_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_dm_messages_delete_attachments
AFTER DELETE ON dm_messages
BEGIN
    DELETE FROM attachments WHERE message_id = OLD.id;
END;

-- Rows already left behind by deleted messages.
DELETE FROM attachments
WHERE message_id IS NOT NULL
  AND message_id NOT IN (SELECT id FROM messages)
  AND message_id NOT IN (SELECT id FROM dm_messages);

-- When an upload was made, so ones never sent can be cleaned up later.
ALTER TABLE attachments ADD COLUMN uploaded_at TEXT;
UPDATE attachments SET uploaded_at = strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now') WHERE message_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_attachments_unsent ON attachments(uploaded_at) WHERE message_id IS NULL;

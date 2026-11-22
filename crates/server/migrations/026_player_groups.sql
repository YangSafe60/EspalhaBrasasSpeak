-- "Find players" groups (e.g. a 5-stack): a card people join until it's full.
CREATE TABLE IF NOT EXISTS lfg_groups (
    message_id TEXT PRIMARY KEY NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    game TEXT NOT NULL,
    slots INTEGER NOT NULL,
    -- NULL = no time limit
    expires_at TEXT,
    -- When it filled up (NULL = still open).
    completed_at TEXT
);
CREATE TABLE IF NOT EXISTS lfg_members (
    message_id TEXT NOT NULL REFERENCES lfg_groups(message_id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at TEXT NOT NULL,
    PRIMARY KEY (message_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_lfg_members_message ON lfg_members(message_id, joined_at);

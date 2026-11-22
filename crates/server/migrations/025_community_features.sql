-- Slow mode, threads, forwarded messages, profile bio, word filter, audit
-- log and polls.

-- Seconds between two messages from the same person (0 = off).
ALTER TABLE channels ADD COLUMN slowmode_seconds INTEGER NOT NULL DEFAULT 0;
-- Threads are text channels hanging off a message of another channel; they
-- use the parent channel's permissions.
ALTER TABLE channels ADD COLUMN parent_channel_id TEXT REFERENCES channels(id) ON DELETE CASCADE;
ALTER TABLE channels ADD COLUMN thread_message_id TEXT;
CREATE INDEX IF NOT EXISTS idx_channels_parent ON channels(parent_channel_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_channels_thread_message ON channels(thread_message_id)
    WHERE thread_message_id IS NOT NULL;

ALTER TABLE messages ADD COLUMN forwarded INTEGER NOT NULL DEFAULT 0;

ALTER TABLE users ADD COLUMN bio TEXT;
ALTER TABLE users ADD COLUMN accent_color TEXT;

-- Word filter: JSON array of lowercase words/phrases.
ALTER TABLE servers ADD COLUMN blocked_words TEXT;

CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY NOT NULL,
    server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    actor_id TEXT NOT NULL,
    action TEXT NOT NULL,
    target_id TEXT,
    details TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_log_server ON audit_log(server_id, created_at DESC);

CREATE TABLE IF NOT EXISTS polls (
    message_id TEXT PRIMARY KEY NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    question TEXT NOT NULL,
    multi INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS poll_options (
    id TEXT PRIMARY KEY NOT NULL,
    message_id TEXT NOT NULL REFERENCES polls(message_id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    label TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_poll_options_message ON poll_options(message_id, position);
CREATE TABLE IF NOT EXISTS poll_votes (
    option_id TEXT NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
    message_id TEXT NOT NULL REFERENCES polls(message_id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (option_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_poll_votes_message ON poll_votes(message_id);

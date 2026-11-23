-- Private notes about other users (only the owner sees them).
CREATE TABLE IF NOT EXISTS user_notes (
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    note TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (owner_id, target_id)
);

-- Welcome message posted when someone joins a server.
ALTER TABLE servers ADD COLUMN welcome_channel_id TEXT;
ALTER TABLE servers ADD COLUMN welcome_message TEXT;
-- Messages written by the app itself ("member_join"), not typed by a person.
ALTER TABLE messages ADD COLUMN system_kind TEXT;

-- "Seen" in DMs: the last message each person has read.
CREATE TABLE IF NOT EXISTS dm_reads (
    dm_channel_id TEXT NOT NULL REFERENCES dm_channels(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message_id TEXT NOT NULL,
    read_at TEXT NOT NULL,
    PRIMARY KEY (dm_channel_id, user_id)
);

-- Scheduled events ("Friday 21h - CS2") and who's going.
CREATE TABLE IF NOT EXISTS server_events (
    id TEXT PRIMARY KEY NOT NULL,
    server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    creator_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    starts_at TEXT NOT NULL,
    channel_id TEXT REFERENCES channels(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_server_events_server ON server_events(server_id, starts_at);

CREATE TABLE IF NOT EXISTS server_event_rsvps (
    event_id TEXT NOT NULL REFERENCES server_events(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY (event_id, user_id)
);

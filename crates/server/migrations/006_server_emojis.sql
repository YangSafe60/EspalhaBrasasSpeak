-- Custom emojis per server (Discord-style). Members can use them in any server/DM.
CREATE TABLE IF NOT EXISTS server_emojis (
    id TEXT PRIMARY KEY NOT NULL,
    server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    name TEXT NOT NULL COLLATE NOCASE,
    image_url TEXT NOT NULL,
    animated INTEGER NOT NULL DEFAULT 0,
    creator_id TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    UNIQUE (server_id, name)
);

CREATE INDEX IF NOT EXISTS idx_server_emojis_server ON server_emojis(server_id);

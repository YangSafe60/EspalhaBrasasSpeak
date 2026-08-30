-- Channel webhooks and server bots

CREATE TABLE IF NOT EXISTS channel_webhooks (
    id TEXT PRIMARY KEY NOT NULL,
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    avatar_url TEXT,
    creator_id TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_channel_webhooks_channel ON channel_webhooks(channel_id);

CREATE TABLE IF NOT EXISTS server_bots (
    id TEXT PRIMARY KEY NOT NULL,
    server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    creator_id TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_server_bots_server ON server_bots(server_id);

ALTER TABLE messages ADD COLUMN webhook_id TEXT;
ALTER TABLE messages ADD COLUMN webhook_name TEXT;
ALTER TABLE messages ADD COLUMN bot_id TEXT;
ALTER TABLE messages ADD COLUMN bot_name TEXT;

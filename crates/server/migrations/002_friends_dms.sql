-- Friends, identity keys, and 1:1 E2E DMs

CREATE TABLE IF NOT EXISTS user_identity_keys (
    user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    public_key TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS friendships (
    id TEXT PRIMARY KEY NOT NULL,
    user_low TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_high TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    requested_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (user_low, user_high),
    CHECK (user_low < user_high),
    CHECK (status IN ('pending', 'accepted', 'declined'))
);

CREATE INDEX IF NOT EXISTS idx_friendships_user_low ON friendships(user_low);
CREATE INDEX IF NOT EXISTS idx_friendships_user_high ON friendships(user_high);
CREATE INDEX IF NOT EXISTS idx_friendships_status ON friendships(status);

CREATE TABLE IF NOT EXISTS dm_channels (
    id TEXT PRIMARY KEY NOT NULL,
    friendship_id TEXT UNIQUE REFERENCES friendships(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dm_participants (
    dm_channel_id TEXT NOT NULL REFERENCES dm_channels(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (dm_channel_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_dm_participants_user ON dm_participants(user_id);

CREATE TABLE IF NOT EXISTS dm_messages (
    id TEXT PRIMARY KEY NOT NULL,
    dm_channel_id TEXT NOT NULL REFERENCES dm_channels(id) ON DELETE CASCADE,
    author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ciphertext TEXT NOT NULL,
    nonce TEXT NOT NULL,
    reply_to_id TEXT REFERENCES dm_messages(id) ON DELETE SET NULL,
    edited_at TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_dm_messages_channel_created
    ON dm_messages(dm_channel_id, created_at DESC);

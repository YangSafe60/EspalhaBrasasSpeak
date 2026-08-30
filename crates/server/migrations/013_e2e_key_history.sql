-- E2E identity key history + per-message public keys for reliable decrypt after rotation.

CREATE TABLE IF NOT EXISTS user_identity_key_history (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    public_key TEXT NOT NULL,
    active_from TEXT NOT NULL,
    retired_at TEXT NOT NULL,
    UNIQUE (user_id, public_key)
);

CREATE INDEX IF NOT EXISTS idx_identity_key_history_user
    ON user_identity_key_history(user_id, retired_at DESC);

ALTER TABLE dm_messages ADD COLUMN sender_public_key TEXT;
ALTER TABLE dm_messages ADD COLUMN recipient_public_key TEXT;

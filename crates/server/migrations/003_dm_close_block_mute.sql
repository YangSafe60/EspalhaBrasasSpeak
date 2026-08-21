-- DM close (per-user) + friend mute/block prefs

ALTER TABLE dm_participants ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS user_blocks (
    blocker_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY (blocker_id, blocked_id),
    CHECK (blocker_id != blocked_id)
);

CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked ON user_blocks(blocked_id);

CREATE TABLE IF NOT EXISTS friend_mutes (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    peer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, peer_id),
    CHECK (user_id != peer_id)
);

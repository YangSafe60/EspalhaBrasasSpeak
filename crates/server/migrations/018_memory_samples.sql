-- Desktop memory diagnostics (opt-in per device): one row per 10 s sample.
CREATE TABLE IF NOT EXISTS memory_samples (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    app_version TEXT,
    total_mb INTEGER NOT NULL,
    -- JSON array of {"kind","label","mb"}
    processes TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memory_samples_user_created
    ON memory_samples(user_id, created_at);

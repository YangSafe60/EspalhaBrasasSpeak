-- Account disable + persisted email edits
ALTER TABLE users ADD COLUMN disabled_at TEXT;

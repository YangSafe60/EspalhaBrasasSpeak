-- Persisted presence preference (online / idle / dnd / offline=invisible).
ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'online';

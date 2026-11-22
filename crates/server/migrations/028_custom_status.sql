-- Custom status ("Watermelon" bubble on the profile card).
ALTER TABLE users ADD COLUMN custom_status_text TEXT;
ALTER TABLE users ADD COLUMN custom_status_emoji TEXT;
-- NULL = until cleared.
ALTER TABLE users ADD COLUMN custom_status_expires_at TEXT;

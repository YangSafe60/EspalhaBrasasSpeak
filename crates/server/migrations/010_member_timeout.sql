-- Member timeouts (Discord-style temporary chat/voice restriction)

ALTER TABLE members ADD COLUMN timeout_until TEXT;
ALTER TABLE members ADD COLUMN timeout_reason TEXT;

-- Bots get their own permission bits instead of inheriting the creator's.
-- Existing bots start at the @everyone default (no admin / moderation powers).
-- 57403 = VIEW_CHANNEL | SEND_MESSAGES | CONNECT | SPEAK | STREAM
--       | CREATE_INVITE | ATTACH_FILES | ADD_REACTIONS  (Permissions::EVERYONE_DEFAULT)
ALTER TABLE server_bots ADD COLUMN permissions INTEGER NOT NULL DEFAULT 57403;

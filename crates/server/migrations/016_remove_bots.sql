-- Bots were removed. Messages they posted stay, attributed to the bot's creator.
DROP INDEX IF EXISTS idx_server_bots_server;
DROP TABLE IF EXISTS server_bots;
ALTER TABLE messages DROP COLUMN bot_id;
ALTER TABLE messages DROP COLUMN bot_name;

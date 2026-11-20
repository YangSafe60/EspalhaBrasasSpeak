-- Webhooks were removed. Messages they posted stay, attributed to the
-- webhook's creator.
DROP INDEX IF EXISTS idx_channel_webhooks_channel;
DROP TABLE IF EXISTS channel_webhooks;
ALTER TABLE messages DROP COLUMN webhook_id;
ALTER TABLE messages DROP COLUMN webhook_name;

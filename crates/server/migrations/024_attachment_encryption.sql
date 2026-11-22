-- Attachments encrypted in the app before upload (Catbox / Litterbox only
-- ever see ciphertext). The AES-256-GCM key, base64url; NULL = plain file.
ALTER TABLE attachments ADD COLUMN enc_key TEXT;

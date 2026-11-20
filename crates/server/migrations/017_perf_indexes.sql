-- Indexes for lookups that were full table scans.
-- Attachments of a message (message list, message load, FK cascades).
CREATE INDEX IF NOT EXISTS idx_attachments_message ON attachments(message_id);
-- A user's servers (login, WebSocket connect, server list).
CREATE INDEX IF NOT EXISTS idx_members_user ON members(user_id);
-- A server's roles (every permission check).
CREATE INDEX IF NOT EXISTS idx_roles_server ON roles(server_id);
-- Who is in a voice channel.
CREATE INDEX IF NOT EXISTS idx_voice_states_channel ON voice_states(channel_id);
-- Revoking a user's sessions.
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);

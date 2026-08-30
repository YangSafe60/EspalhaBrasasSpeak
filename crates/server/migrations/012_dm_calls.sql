-- Private 1:1 DM voice calls (LiveKit room per dm_channel).
ALTER TABLE voice_states ADD COLUMN dm_channel_id TEXT REFERENCES dm_channels(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_voice_states_dm ON voice_states(dm_channel_id);

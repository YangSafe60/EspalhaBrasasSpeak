-- Server mute/deafen flags on voice presence

ALTER TABLE voice_states ADD COLUMN server_muted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE voice_states ADD COLUMN server_deafened INTEGER NOT NULL DEFAULT 0;

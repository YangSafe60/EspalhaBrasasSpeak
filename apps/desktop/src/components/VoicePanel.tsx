import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { useVoice } from "../hooks/useVoice";
import { mediaCssUrl } from "../lib/mediaUrl";
import { useAppStore } from "../store/appStore";
import { ScreenSharePicker } from "./ScreenSharePicker";

type VoiceApi = ReturnType<typeof useVoice>;

type Props = {
  voice: VoiceApi;
};

type ShareMode = "new" | "add" | "replace";

function IconMic({ off }: { off?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden fill="currentColor">
      {off ? (
        <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3 3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z" />
      ) : (
        <path d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z" />
      )}
    </svg>
  );
}

function IconDeaf({ off }: { off?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden fill="currentColor">
      {off ? (
        <path d="M12 4.5c-3.03 0-5.5 2.47-5.5 5.5v.67l8.33 8.33c.48-.4.8-.99.8-1.67v-1.67l-1.5-1.5V10c0-1.93-1.57-3.5-3.5-3.5-.4 0-.78.07-1.14.2L7.9 4.9C9.07 4.05 10.47 3.5 12 3.5c4.14 0 7.5 3.36 7.5 7.5v2.17l1.5 1.5V11c0-4.97-4.03-9-9-9-1.66 0-3.21.45-4.54 1.23L8.6 4.87C9.58 4.3 10.74 4 12 4zm-7.5 6.5c0-.55.07-1.08.2-1.59L3.1 7.8C3.04 8.52 3 9.25 3 10v4c0 1.1.9 2 2 2h1.5v-5.5zM21 18.5l-2.5-2.5H19c.55 0 1-.45 1-1v-1.17l2 2V16c0 .74-.4 1.38-1 1.73V21h-2v-2.27c-.6-.35-1-.99-1-1.73v-.67L3.5 4.5 2.1 5.9l16.5 16.5 1.4-1.4z" />
      ) : (
        <path d="M12 3c-4.97 0-9 4.03-9 9v4c0 1.1.9 2 2 2h2v-8c0-2.76 2.24-5 5-5s5 2.24 5 5v8h2c1.1 0 2-.9 2-2v-4c0-4.97-4.03-9-9-9zm-5 13H5v-4c0-3.87 3.13-7 7-7s7 3.13 7 7v4h-2v-4c0-2.76-2.24-5-5-5s-5 2.24-5 5v4z" />
      )}
    </svg>
  );
}

function IconScreen() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden fill="currentColor">
      <path d="M21 3H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h7v2H8v2h8v-2h-2v-2h7c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 14H3V5h18v12z" />
    </svg>
  );
}

function IconDisconnect() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden fill="currentColor">
      <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.995.995 0 0 1 0-1.41C3.34 8.69 7.46 7 12 7s8.66 1.69 11.71 4.67c.39.39.39 1.02 0 1.41l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.1-.7-.28-.79-.73-1.68-1.36-2.66-1.85a1.02 1.02 0 0 1-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z" />
      <path d="M3.71 3.56 2.3 4.97l16.73 16.73 1.41-1.41L3.71 3.56z" />
    </svg>
  );
}

function IconSettings() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden fill="currentColor">
      <path d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96a7.2 7.2 0 0 0-1.62-.94l-.36-2.54A.49.49 0 0 0 13.98 2h-3.96a.49.49 0 0 0-.48.41l-.36 2.54c-.59.24-1.13.55-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.66 8.87a.49.49 0 0 0 .12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94L2.78 14.5a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.39.3.59.22l2.39-.96c.5.39 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.96c.24 0 .44-.17.48-.41l.36-2.54c.59-.24 1.13-.55 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 0 0-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z" />
    </svg>
  );
}

function IconSignal() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden fill="currentColor">
      <path d="M3 17h2v4H3zm4-4h2v8H7zm4-4h2v12h-2zm4-4h2v16h-2zm4-4h2v20h-2z" />
    </svg>
  );
}

export function VoicePanel({ voice }: Props) {
  const channelsByServer = useAppStore((s) => s.channelsByServer);
  const user = useAppStore((s) => s.user);
  const streaming = useAppStore((s) => s.streaming);
  const selectChannel = useAppStore((s) => s.selectChannel);
  const setModal = useAppStore((s) => s.setModal);

  const shareBtnRef = useRef<HTMLButtonElement>(null);
  const [liveMenuOpen, setLiveMenuOpen] = useState(false);
  const [shareMode, setShareMode] = useState<ShareMode>("new");
  const [menuPos, setMenuPos] = useState<{
    bottom: number;
    left: number;
  } | null>(null);

  const channel = Object.values(channelsByServer)
    .flat()
    .find((c) => c.id === voice.voiceChannelId);

  const inVoice = Boolean(voice.voiceChannelId && channel);

  useLayoutEffect(() => {
    if (!liveMenuOpen || !shareBtnRef.current) {
      setMenuPos(null);
      return;
    }
    const rect = shareBtnRef.current.getBoundingClientRect();
    const menuWidth = 220;
    const left = Math.min(
      Math.max(8, rect.right - menuWidth),
      window.innerWidth - menuWidth - 8,
    );
    setMenuPos({
      bottom: Math.max(8, window.innerHeight - rect.top + 6),
      left,
    });
  }, [liveMenuOpen]);

  useEffect(() => {
    if (!liveMenuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLiveMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [liveMenuOpen]);

  useEffect(() => {
    if (!streaming) setLiveMenuOpen(false);
  }, [streaming]);

  function openSharePicker(mode: ShareMode) {
    setLiveMenuOpen(false);
    setShareMode(mode);
    voice.openScreenPicker();
  }

  function onShareClick() {
    if (streaming) {
      setLiveMenuOpen((open) => !open);
      return;
    }
    openSharePicker("new");
  }

  return (
    <div className="user-voice-dock">
      {inVoice && channel && (
        <div className="voice-connection-bar">
          <button
            type="button"
            className="voice-connection-info"
            title="Open lobby"
            onClick={() => void selectChannel(channel.id)}
          >
            <span className={`voice-signal ${voice.connected ? "on" : ""}`}>
              <IconSignal />
            </span>
            <div className="voice-connection-text">
              <strong>
                {voice.connected
                  ? "Voice Connected"
                  : voice.joining
                    ? "Connecting…"
                    : "Voice"}
              </strong>
              <p>{channel.name}</p>
            </div>
          </button>
          <div className="voice-icon-controls">
            <button
              ref={shareBtnRef}
              type="button"
              className={`voice-icon-btn${streaming ? " active accent" : ""}${liveMenuOpen ? " menu-open" : ""}`}
              title={streaming ? "Screen share options" : "Share screen"}
              aria-label={streaming ? "Screen share options" : "Share screen"}
              aria-expanded={streaming ? liveMenuOpen : undefined}
              aria-haspopup={streaming ? "menu" : undefined}
              disabled={voice.pickerBusy}
              onClick={onShareClick}
            >
              <IconScreen />
            </button>
            <button
              type="button"
              className="voice-icon-btn disconnect"
              title="Disconnect"
              aria-label="Disconnect"
              onClick={() => void voice.leave()}
            >
              <IconDisconnect />
            </button>
          </div>
        </div>
      )}

      <div className="user-panel">
        <button
          type="button"
          className="user-panel-identity"
          title={
            user
              ? `${user.display_name} (@${user.username}) — User settings`
              : "User settings"
          }
          onClick={() => setModal("user-settings")}
        >
          <span
            className="user-panel-avatar"
            style={
              user?.avatar_url
                ? { backgroundImage: mediaCssUrl(user.avatar_url) }
                : undefined
            }
          >
            {!user?.avatar_url &&
              (user?.display_name?.charAt(0)?.toUpperCase() || "?")}
          </span>
          <span className="user-panel-meta">
            <strong>{user?.display_name || "User"}</strong>
            <em>@{user?.username || "…"}</em>
          </span>
        </button>

        <div className="voice-icon-controls user-panel-controls">
          <button
            type="button"
            className={`voice-icon-btn${voice.muted ? " active danger" : ""}`}
            title={voice.muted ? "Unmute" : "Mute"}
            aria-label={voice.muted ? "Unmute" : "Mute"}
            onClick={() => void voice.toggleMute()}
          >
            <IconMic off={voice.muted} />
          </button>
          <button
            type="button"
            className={`voice-icon-btn${voice.deafened ? " active danger" : ""}`}
            title={voice.deafened ? "Undeafen" : "Deafen"}
            aria-label={voice.deafened ? "Undeafen" : "Deafen"}
            onClick={() => void voice.toggleDeafen()}
          >
            <IconDeaf off={voice.deafened} />
          </button>
          <button
            type="button"
            className="voice-icon-btn"
            title="User settings"
            aria-label="User settings"
            onClick={() => setModal("user-settings")}
          >
            <IconSettings />
          </button>
        </div>
      </div>

      {voice.error && <p className="form-error voice-error">{voice.error}</p>}

      <ScreenSharePicker
        open={voice.pickerOpen}
        busy={voice.pickerBusy}
        mode={shareMode}
        activeSourceIds={voice.activeShareIds}
        onClose={voice.closeScreenPicker}
        onPickSource={(source, opts) => {
          void voice.publishElectronShare({
            sourceId: source.id,
            systemAudio: opts.systemAudio,
            fps: opts.fps,
            replaceAll: shareMode === "replace",
          });
        }}
      />

      {liveMenuOpen &&
        menuPos &&
        createPortal(
          <div
            className="live-share-menu-layer"
            onMouseDown={() => setLiveMenuOpen(false)}
          >
            <div
              className="live-share-menu"
              style={{ bottom: menuPos.bottom, left: menuPos.left }}
              role="menu"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                role="menuitem"
                disabled={voice.pickerBusy}
                onClick={() => openSharePicker("replace")}
              >
                Change screen
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={voice.pickerBusy}
                onClick={() => openSharePicker("add")}
              >
                Share another screen
              </button>
              <button
                type="button"
                role="menuitem"
                className="danger"
                onClick={() => {
                  setLiveMenuOpen(false);
                  void voice.stopScreenShare();
                }}
              >
                Stop sharing
              </button>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

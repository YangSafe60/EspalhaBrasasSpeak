import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { useVoice } from "../hooks/useVoice";
import { mediaCssUrl } from "../lib/mediaUrl";
import { sameId } from "../lib/serverPerms";
import { useAppStore } from "../store/appStore";
import { ScreenSharePicker } from "./ScreenSharePicker";
import { StatusPicker } from "./StatusPicker";
import {
  IconCamera,
  IconDeaf,
  IconDisconnect,
  IconMic,
  IconScreen,
  IconSettings,
} from "./voice/CallIcons";

type VoiceApi = ReturnType<typeof useVoice>;

type Props = {
  voice: VoiceApi;
};

type ShareMode = "new" | "add" | "replace";

function IconSignal() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden fill="currentColor">
      <path d="M3 17h2v4H3zm4-4h2v8H7zm4-4h2v12h-2zm4-4h2v16h-2zm4-4h2v20h-2z" />
    </svg>
  );
}

export function VoicePanel({ voice }: Props) {
  const channelsByServer = useAppStore((s) => s.channelsByServer);
  const dmChannels = useAppStore((s) => s.dmChannels);
  const servers = useAppStore((s) => s.servers);
  const user = useAppStore((s) => s.user);
  const activeServerId = useAppStore((s) => s.activeServerId);
  const streaming = useAppStore((s) => s.streaming);
  const selectChannel = useAppStore((s) => s.selectChannel);
  const setModal = useAppStore((s) => s.setModal);
  const openMiniProfile = useAppStore((s) => s.openMiniProfile);

  const shareBtnRef = useRef<HTMLButtonElement>(null);
  const [liveMenuOpen, setLiveMenuOpen] = useState(false);
  const [shareMode, setShareMode] = useState<ShareMode>("new");
  const [signalHover, setSignalHover] = useState(false);
  const [menuPos, setMenuPos] = useState<{
    bottom: number;
    left: number;
  } | null>(null);

  const channel = Object.values(channelsByServer)
    .flat()
    .find((c) => c.id === voice.voiceChannelId);
  const dmCall = voice.dmCallId
    ? dmChannels.find((d) => sameId(d.id, voice.dmCallId))
    : undefined;

  const server = servers.find((s) => sameId(s.id, activeServerId));
  const inVoice = Boolean(
    (voice.voiceChannelId || voice.dmCallId || voice.joining) &&
      (channel || dmCall || voice.joining),
  );
  const connectionSubtitle = dmCall
    ? `${dmCall.peer.display_name} · Private call`
    : channel
      ? server
        ? `${server.name} / ${channel.name}`
        : channel.name
      : "";
  const connectionTitle = dmCall
    ? "Private call"
    : channel
      ? "Open voice channel"
      : "";

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

  // The dock now spans the server rail too; tell the rail how tall it is so
  // its last icons stay above it.
  const dockRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = dockRef.current;
    const shell = el?.closest(".app-shell") as HTMLElement | null;
    if (!el || !shell) return;
    const update = () =>
      shell.style.setProperty("--user-dock-height", `${Math.ceil(el.getBoundingClientRect().height)}px`);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      ro.disconnect();
      shell.style.removeProperty("--user-dock-height");
    };
  }, []);

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
    <div className="user-voice-dock" ref={dockRef}>
      {inVoice && (channel || dmCall) && (
        <div className="voice-connection-dock">
          <div className="voice-connection-bar">
            <button
              type="button"
              className="voice-connection-info"
              title={connectionTitle}
              onClick={() => {
                if (channel) void selectChannel(channel.id);
              }}
            >
              <span
                className={`voice-signal ${voice.connected ? "on" : ""}${signalHover ? " show-ping" : ""}`}
                title={
                  voice.connected
                    ? voice.pingMs != null
                      ? `${voice.pingMs} ms ping`
                      : "Measuring ping…"
                    : "Not connected"
                }
                onMouseEnter={() => setSignalHover(true)}
                onMouseLeave={() => setSignalHover(false)}
                onClick={(e) => e.stopPropagation()}
              >
                {signalHover && voice.connected ? (
                  <span className="voice-ping-label">
                    {voice.pingMs != null ? `${voice.pingMs} ms` : "…"}
                  </span>
                ) : (
                  <IconSignal />
                )}
              </span>
              <div className="voice-connection-text">
                <strong>
                  {voice.connected
                    ? "Voice Connected"
                    : voice.joining
                      ? "Connecting…"
                      : "Voice"}
                </strong>
                <p>{connectionSubtitle}</p>
              </div>
            </button>
          </div>

          <div className="voice-connection-actions">
            <button
              type="button"
              className={`voice-icon-btn${voice.cameraOn ? " active accent" : ""}`}
              title={voice.cameraOn ? "Turn off camera" : "Turn on camera"}
              aria-label={voice.cameraOn ? "Turn off camera" : "Turn on camera"}
              disabled={!voice.connected || voice.pickerBusy}
              onClick={() => void voice.toggleCamera()}
            >
              <IconCamera off={!voice.cameraOn} />
            </button>
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
        <div className="user-panel-identity-wrap">
          <button
            type="button"
            className="user-panel-identity"
            title={
              user
                ? `${user.display_name} (@${user.username}) — Profile`
                : "Profile"
            }
            onClick={(e) => {
              if (!user) return;
              openMiniProfile({
                userId: user.id,
                serverId: activeServerId,
                x: e.clientX,
                y: e.clientY,
              });
            }}
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
          <StatusPicker className="user-panel-status" />
        </div>

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
            resolution: opts.resolution,
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

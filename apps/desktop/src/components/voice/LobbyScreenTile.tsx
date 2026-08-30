import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  registerScreenCapture,
  unregisterScreenCapture,
} from "../../lib/screenBridge";

export type LobbyScreenTileProps = {
  trackSid: string;
  track: {
    attach: (el: HTMLMediaElement) => void;
    detach: (el?: HTMLMediaElement) => void;
  };
  name: string;
  badge?: string;
  busy: boolean;
  onPopout: () => void;
  hoverActionLabel: string;
  onHoverAction: () => void;
  audioControls?: {
    volume: number;
    muted: boolean;
    onVolume: (v: number) => void;
    onMute: (muted: boolean) => void;
  };
};

/**
 * Single screen-share stage tile with in-app fullscreen, pop-out, and optional
 * stream-audio controls. Registers the visible `<video>` for pop-out JPEG relay.
 */
export function LobbyScreenTile({
  trackSid,
  track,
  name,
  badge,
  busy,
  onPopout,
  hoverActionLabel,
  onHoverAction,
  audioControls,
}: LobbyScreenTileProps) {
  const tileRef = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLVideoElement>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [track]);

  useEffect(() => {
    registerScreenCapture(trackSid, () => ref.current);
    return () => unregisterScreenCapture(trackSid);
  }, [trackSid]);

  useEffect(() => {
    if (!expanded) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [expanded]);

  function toggleExpanded() {
    setExpanded((v) => !v);
  }

  return (
    <div
      className={`lobby-screen-tile${expanded ? " is-expanded" : ""}`}
      ref={tileRef}
    >
      <video
        ref={ref}
        autoPlay
        playsInline
        muted
        onDoubleClick={() => toggleExpanded()}
      />
      <div
        className="lobby-screen-meta"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <span>
          {badge && <em className="you-badge">{badge}</em>}
          {name}
        </span>
        <div className="lobby-screen-meta-actions">
          {audioControls && (
            <div
              className="lobby-screen-audio"
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                className={`btn ghost sm lobby-screen-icon-btn${audioControls.muted ? " is-muted" : ""}`}
                title={audioControls.muted ? "Unmute stream audio" : "Mute stream audio"}
                aria-label={
                  audioControls.muted ? "Unmute stream audio" : "Mute stream audio"
                }
                onClick={() => audioControls.onMute(!audioControls.muted)}
              >
                {audioControls.muted ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
                    <path
                      fill="currentColor"
                      d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z"
                    />
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
                    <path
                      fill="currentColor"
                      d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"
                    />
                  </svg>
                )}
              </button>
              <input
                type="range"
                className="lobby-screen-volume"
                min={0}
                max={100}
                value={Math.round(audioControls.volume * 100)}
                style={
                  {
                    "--range-fill": `${Math.round(audioControls.volume * 100)}%`,
                  } as CSSProperties
                }
                aria-label="Stream audio volume"
                title="Stream volume"
                onChange={(e) =>
                  audioControls.onVolume(Number(e.target.value) / 100)
                }
              />
            </div>
          )}
          <button
            type="button"
            className="btn ghost sm lobby-screen-icon-btn"
            title={expanded ? "Exit fullscreen" : "Fullscreen"}
            aria-label={expanded ? "Exit fullscreen" : "Fullscreen"}
            onClick={() => toggleExpanded()}
          >
            {expanded ? (
              <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
                <path
                  fill="currentColor"
                  d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"
                />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
                <path
                  fill="currentColor"
                  d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"
                />
              </svg>
            )}
          </button>
          <button
            type="button"
            className="btn ghost sm"
            disabled={busy}
            onClick={onPopout}
          >
            {busy ? "…" : "Pop out"}
          </button>
          <button
            type="button"
            className="btn danger sm"
            onClick={onHoverAction}
          >
            {hoverActionLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";

const YT_HOSTS = ["https://www.youtube-nocookie.com", "https://www.youtube.com"];

type Info = { time: number; duration: number; state: number; volume: number; muted: boolean };

function fmt(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/**
 * A YouTube video with our own controls (like a regular video player):
 * seek bar, play/pause, back/forward 10 s, volume, time, pop out and
 * fullscreen. The embed runs with YouTube's controls hidden and is driven
 * over postMessage.
 */
export function YouTubePlayer({
  videoId,
  title,
  start = 0,
  onPopOut,
}: {
  videoId: string;
  title?: string;
  /** Seconds to start at. */
  start?: number;
  /** Shown as a button when set; gets the current time. */
  onPopOut?: (time: number) => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [info, setInfo] = useState<Info>({ time: start, duration: 0, state: -1, volume: 100, muted: false });
  const [showUi, setShowUi] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [seekPreview, setSeekPreview] = useState<number | null>(null);
  const hideTimer = useRef<number | null>(null);
  const [src] = useState(() => {
    const p = new URLSearchParams({
      enablejsapi: "1",
      autoplay: "1",
      controls: "0",
      playsinline: "1",
      rel: "0",
      iv_load_policy: "3",
      disablekb: "1",
      start: String(Math.floor(start)),
    });
    if (location.origin && location.origin !== "null") p.set("origin", location.origin);
    return `https://www.youtube-nocookie.com/embed/${videoId}?${p}`;
  });

  const send = (func: string, args: unknown[] = []) =>
    frame.current?.contentWindow?.postMessage(JSON.stringify({ event: "command", func, args, id: 1, channel: "widget" }), "*");

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (!YT_HOSTS.includes(e.origin) || e.source !== frame.current?.contentWindow) return;
      let d: { event?: string; info?: unknown };
      try {
        d = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
      } catch {
        return;
      }
      if (d.event === "infoDelivery" && d.info && typeof d.info === "object") {
        const i = d.info as { currentTime?: number; duration?: number; playerState?: number; volume?: number; muted?: boolean };
        setInfo((prev) => ({
          time: typeof i.currentTime === "number" ? i.currentTime : prev.time,
          duration: typeof i.duration === "number" && i.duration > 0 ? i.duration : prev.duration,
          state: typeof i.playerState === "number" ? i.playerState : prev.state,
          volume: typeof i.volume === "number" ? i.volume : prev.volume,
          muted: typeof i.muted === "boolean" ? i.muted : prev.muted,
        }));
      } else if (d.event === "onStateChange" && typeof d.info === "number") {
        const state = d.info;
        setInfo((prev) => ({ ...prev, state }));
      }
    };
    window.addEventListener("message", onMessage);
    const onFs = () => setFullscreen(document.fullscreenElement === wrap.current);
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      window.removeEventListener("message", onMessage);
      document.removeEventListener("fullscreenchange", onFs);
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
    };
  }, []);

  const playing = info.state === 1 || info.state === 3;

  // Controls hide while playing and the mouse is still.
  function poke() {
    setShowUi(true);
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setShowUi(false), 2500);
  }

  function toggle() {
    send(playing ? "pauseVideo" : "playVideo");
    poke();
  }

  function seek(to: number) {
    const t = Math.max(0, info.duration ? Math.min(info.duration - 0.5, to) : to);
    send("seekTo", [t, true]);
    setInfo((p) => ({ ...p, time: t }));
    poke();
  }

  function toggleMute() {
    send(info.muted ? "unMute" : "mute");
    setInfo((p) => ({ ...p, muted: !p.muted }));
  }

  function setVolume(v: number) {
    send("setVolume", [v]);
    if (v > 0 && info.muted) send("unMute");
    setInfo((p) => ({ ...p, volume: v, muted: v === 0 ? p.muted : false }));
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void wrap.current?.requestFullscreen().catch(() => {});
  }

  function barTime(e: MouseEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    return (Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) || 0) * info.duration;
  }

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.target instanceof HTMLInputElement) return;
    if (e.key === " " || e.key === "k") {
      e.preventDefault();
      toggle();
    } else if (e.key === "ArrowLeft" || e.key === "j") {
      e.preventDefault();
      seek(info.time - 10);
    } else if (e.key === "ArrowRight" || e.key === "l") {
      e.preventDefault();
      seek(info.time + 10);
    } else if (e.key === "m") {
      toggleMute();
    } else if (e.key === "f") {
      toggleFullscreen();
    }
  }

  const pct = info.duration ? Math.min(100, (info.time / info.duration) * 100) : 0;
  const volumeShown = info.muted ? 0 : info.volume;
  const uiVisible = showUi || !playing;

  return (
    <div
      ref={wrap}
      className={`yt-player${uiVisible ? " ui-visible" : ""}${fullscreen ? " is-fullscreen" : ""}`}
      tabIndex={0}
      onMouseMove={poke}
      onMouseLeave={() => playing && setShowUi(false)}
      onKeyDown={onKey}
    >
      <iframe
        ref={frame}
        src={src}
        title={title || "YouTube video"}
        allow="autoplay; encrypted-media; fullscreen"
        referrerPolicy="strict-origin-when-cross-origin"
        onLoad={() => frame.current?.contentWindow?.postMessage(JSON.stringify({ event: "listening", id: 1, channel: "widget" }), "*")}
      />
      {/* Catches clicks (the iframe would take them): click = play/pause, double-click = fullscreen. */}
      <div className="yt-click" onClick={toggle} onDoubleClick={toggleFullscreen} />

      <div className="yt-controls" onClick={(e) => e.stopPropagation()}>
        <div
          className="yt-bar"
          role="slider"
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={Math.round(info.duration)}
          aria-valuenow={Math.round(info.time)}
          onClick={(e) => seek(barTime(e))}
          onMouseMove={(e) => setSeekPreview(barTime(e))}
          onMouseLeave={() => setSeekPreview(null)}
        >
          <div className="yt-bar-fill" style={{ width: `${pct}%` }} />
          <div className="yt-bar-knob" style={{ left: `${pct}%` }} />
          {seekPreview !== null && info.duration > 0 && (
            <span className="yt-bar-tip" style={{ left: `${(seekPreview / info.duration) * 100}%` }}>
              {fmt(seekPreview)}
            </span>
          )}
        </div>
        <div className="yt-row">
          <button type="button" onClick={toggle} aria-label={playing ? "Pause" : "Play"} title={playing ? "Pause (k)" : "Play (k)"}>
            {playing ? (
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden>
                <rect x="6" y="5" width="4" height="14" rx="1.2" />
                <rect x="14" y="5" width="4" height="14" rx="1.2" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden>
                <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.2-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" />
              </svg>
            )}
          </button>
          <button type="button" onClick={() => seek(info.time - 10)} aria-label="Back 10 seconds" title="Back 10 s (←)">
            <SkipIcon back />
          </button>
          <button type="button" onClick={() => seek(info.time + 10)} aria-label="Forward 10 seconds" title="Forward 10 s (→)">
            <SkipIcon />
          </button>
          <div className="yt-volume">
            <button type="button" onClick={toggleMute} aria-label={volumeShown ? "Mute" : "Unmute"} title={volumeShown ? "Mute (m)" : "Unmute (m)"}>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden>
                <path d="M4 9.5v5a1 1 0 0 0 1 1h3l4.3 3.6a.8.8 0 0 0 1.3-.6V5.5a.8.8 0 0 0-1.3-.6L8 8.5H5a1 1 0 0 0-1 1z" />
                {volumeShown === 0 ? (
                  <path d="M16.3 9.3a.9.9 0 0 1 1.3 0l1.4 1.4 1.4-1.4a.9.9 0 1 1 1.3 1.3L20.3 12l1.4 1.4a.9.9 0 1 1-1.3 1.3L19 13.3l-1.4 1.4a.9.9 0 1 1-1.3-1.3l1.4-1.4-1.4-1.4a.9.9 0 0 1 0-1.3z" />
                ) : (
                  <path d="M15.6 9.2a.9.9 0 0 1 1.27.05 4 4 0 0 1 0 5.5.9.9 0 1 1-1.32-1.22 2.2 2.2 0 0 0 0-3.06.9.9 0 0 1 .05-1.27zM18.2 6.6a.9.9 0 0 1 1.27.02 7.8 7.8 0 0 1 0 10.76.9.9 0 1 1-1.3-1.25 6 6 0 0 0 0-8.26.9.9 0 0 1 .03-1.27z" />
                )}
              </svg>
            </button>
            <input
              type="range"
              min={0}
              max={100}
              value={volumeShown}
              aria-label="Volume"
              style={{ ["--vol" as string]: `${volumeShown}%` }}
              onChange={(e) => setVolume(Number(e.target.value))}
            />
          </div>
          <span className="yt-time">
            {fmt(info.time)}
            {info.duration > 0 && <em> / {fmt(info.duration)}</em>}
          </span>
          <span className="yt-spacer" />
          {onPopOut && !fullscreen && (
            <button type="button" onClick={() => onPopOut(info.time)} aria-label="Pop out" title="Pop out (keeps playing while you browse)">
              <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden>
                <rect x="3" y="7" width="13" height="13" rx="2" />
                <path d="M8 4h11a2 2 0 0 1 2 2v11" strokeLinecap="round" />
              </svg>
            </button>
          )}
          <button type="button" onClick={toggleFullscreen} aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"} title={fullscreen ? "Exit fullscreen (f)" : "Fullscreen (f)"}>
            {fullscreen ? (
              <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M9 4v4a1 1 0 0 1-1 1H4M15 4v4a1 1 0 0 0 1 1h4M20 15h-4a1 1 0 0 0-1 1v4M4 15h4a1 1 0 0 1 1 1v4" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function SkipIcon({ back = false }: { back?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={back ? undefined : { transform: "scaleX(-1)" }}>
      <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" />
      <path d="M4 3.5v4h4" />
      <text x="12" y="15.2" textAnchor="middle" fontSize="7.5" fontWeight="700" fill="currentColor" stroke="none" style={back ? undefined : { transform: "scaleX(-1)", transformOrigin: "12px 12px" }}>
        10
      </text>
    </svg>
  );
}

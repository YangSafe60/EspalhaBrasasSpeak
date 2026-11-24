import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMini } from "../lib/miniStore";
import { livePosition, loadWatch, watchAction, watchKey, watchStates, type PlayKind, type WatchAction } from "../lib/watchTogether";
import { useAppStore } from "../store/appStore";
import type { WatchState } from "../types";

const YT_HOSTS = ["https://www.youtube-nocookie.com", "https://www.youtube.com"];
/** Out of sync by more than this (seconds) = jump to the shared position. */
const DRIFT = 2;

type PlayerInfo = { time: number; state: number; duration: number };

/**
 * A YouTube embed driven over postMessage (no external script): play, pause,
 * seek, and the player's own time/state events.
 */
function useYouTube(frame: React.RefObject<HTMLIFrameElement | null>, onInfo: (i: Partial<PlayerInfo>) => void) {
  const onInfoRef = useRef(onInfo);
  onInfoRef.current = onInfo;

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (!YT_HOSTS.includes(e.origin) || e.source !== frame.current?.contentWindow) return;
      let data: { event?: string; info?: unknown };
      try {
        data = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
      } catch {
        return;
      }
      if (data.event === "infoDelivery" && data.info && typeof data.info === "object") {
        const info = data.info as { currentTime?: number; playerState?: number; duration?: number };
        onInfoRef.current({
          ...(typeof info.currentTime === "number" ? { time: info.currentTime } : {}),
          ...(typeof info.playerState === "number" ? { state: info.playerState } : {}),
          ...(typeof info.duration === "number" && info.duration > 0 ? { duration: info.duration } : {}),
        });
      } else if (data.event === "onStateChange" && typeof data.info === "number") {
        onInfoRef.current({ state: data.info });
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [frame]);

  return (func: string, args: unknown[] = []) => {
    frame.current?.contentWindow?.postMessage(JSON.stringify({ event: "command", func, args, id: 1, channel: "widget" }), "*");
  };
}

function embedUrl(videoId: string, start: number) {
  const params = new URLSearchParams({
    enablejsapi: "1",
    autoplay: "1",
    playsinline: "1",
    rel: "0",
    start: String(Math.floor(start)),
  });
  if (location.origin && location.origin !== "null") params.set("origin", location.origin);
  return `https://www.youtube-nocookie.com/embed/${videoId}?${params}`;
}

/** Watch YouTube together in a voice channel, with a shared queue. */
export function WatchTogether({
  channelId,
  onClose,
  kind = "watch",
}: {
  channelId: string;
  onClose: () => void;
  /** "listen" = audio only (Listen Together). */
  kind?: PlayKind;
}) {
  const state = useMini(watchStates, (all) => all[watchKey(channelId, kind)]);
  const listen = kind === "listen";
  const authors = useAppStore((s) => s.authors);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadWatch(channelId, kind);
  }, [channelId, kind]);

  async function act(body: WatchAction) {
    setError(null);
    try {
      await watchAction(channelId, body, kind);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    }
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await watchAction(channelId, { action: "add", url: url.trim() }, kind);
      setUrl("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add that video");
    } finally {
      setBusy(false);
    }
  }

  const current = state?.queue.find((i) => i.id === state.current) ?? null;
  const upNext = state?.queue.filter((i) => i.id !== state.current) ?? [];

  function fullscreen() {
    const frame = document.querySelector<HTMLIFrameElement>(`.watch[data-channel="${channelId}"] .watch-player iframe`);
    void frame?.requestFullscreen?.().catch(() => {});
  }

  const togglePlay = () =>
    state &&
    void act(state.playing ? { action: "pause", position: livePosition(state) } : { action: "play", position: livePosition(state) });

  return (
    <section className={`watch kind-${kind}${current ? " has-video" : ""}`} data-channel={channelId}>
      <header className="watch-header">
        <h3>
          <span className="watch-logo">{listen ? <HeadphonesIcon /> : <YouTubeIcon />}</span>
          {listen ? "Listen Together" : "Watch Together"}
        </h3>
        <button type="button" className="watch-icon-btn" title="Leave (it keeps going for the others)" aria-label="Leave activity" onClick={onClose}>
          <CloseIcon />
        </button>
      </header>

      <div className="watch-layout">
        <div className="watch-stage">
          {current && state && listen ? (
            <ListenStage
              key={current.id}
              channelId={channelId}
              state={state}
              item={current}
              addedBy={authors[current.added_by]?.display_name || "someone"}
              hasNext={upNext.length > 0}
              act={act}
            />
          ) : current && state ? (
            <>
              <SyncedPlayer key={current.id} channelId={channelId} kind={kind} state={state} videoId={current.video_id} itemId={current.id} />
              <div className="watch-controls">
                <button
                  type="button"
                  className="watch-play"
                  title={state.playing ? "Pause for everyone" : "Play for everyone"}
                  aria-label={state.playing ? "Pause" : "Play"}
                  onClick={togglePlay}
                >
                  {state.playing ? <PauseIcon /> : <PlayIcon />}
                </button>
                <button
                  type="button"
                  className="watch-icon-btn"
                  title={upNext.length ? "Next video" : "Nothing next: stops the video"}
                  aria-label="Next video"
                  onClick={() => void act({ action: "next", item_id: current.id })}
                >
                  <NextIcon />
                </button>
                <div className="watch-now-text">
                  <strong title={current.title}>{current.title}</strong>
                  <span>Added by {authors[current.added_by]?.display_name || "someone"}</span>
                </div>
                <button type="button" className="watch-icon-btn" title="Fullscreen" aria-label="Fullscreen" onClick={fullscreen}>
                  <FullscreenIcon />
                </button>
                <button
                  type="button"
                  className="watch-icon-btn danger"
                  title="End for everyone (stops the video and empties the queue)"
                  aria-label="End for everyone"
                  onClick={() => void act({ action: "clear" })}
                >
                  <StopIcon />
                </button>
              </div>
            </>
          ) : (
            <div className="watch-empty">
              <span className="watch-empty-logo">{listen ? <HeadphonesIcon /> : <YouTubeIcon />}</span>
              <strong>Nothing playing</strong>
              <span>
                {listen
                  ? "Paste a YouTube link (a song, a mix, a podcast) to listen with everyone here."
                  : "Paste a YouTube link to start watching with everyone here."}
              </span>
            </div>
          )}
        </div>

        <aside className="watch-side">
          <form className="watch-add" onSubmit={(e) => void add(e)}>
            <input
              value={url}
              placeholder={current ? "Add a YouTube link" : "Paste a YouTube link"}
              onChange={(e) => setUrl(e.target.value)}
            />
            <button
              type="submit"
              className="watch-add-btn"
              disabled={busy || !url.trim()}
              title={current ? "Add to queue" : "Play"}
              aria-label={current ? "Add to queue" : "Play"}
            >
              {busy ? <span className="watch-spinner" /> : current ? <PlusIcon /> : <PlayIcon />}
            </button>
          </form>
          {error && <p className="form-error">{error}</p>}
          <p className="watch-side-title">
            Up next <span>{upNext.length}</span>
          </p>
          {upNext.length === 0 ? (
            <p className="watch-side-empty">The queue is empty.</p>
          ) : (
            <ol className="watch-queue">
              {upNext.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className="watch-queue-thumb"
                    title="Play now"
                    aria-label={`Play now: ${item.title}`}
                    onClick={() => void act({ action: "select", item_id: item.id })}
                  >
                    <img src={`https://i.ytimg.com/vi/${item.video_id}/mqdefault.jpg`} alt="" referrerPolicy="no-referrer" />
                    <span className="watch-queue-play">
                      <PlayIcon />
                    </span>
                  </button>
                  <span className="watch-queue-title" title={item.title}>
                    {item.title}
                    <em>{authors[item.added_by]?.display_name || "someone"}</em>
                  </span>
                  <button
                    type="button"
                    className="watch-icon-btn sm"
                    title="Remove from queue"
                    aria-label="Remove from queue"
                    onClick={() => void act({ action: "remove", item_id: item.id })}
                  >
                    <TrashIcon />
                  </button>
                </li>
              ))}
            </ol>
          )}
        </aside>
      </div>
    </section>
  );
}

function YouTubeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden>
      <path d="M21.6 7.2a2.6 2.6 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4a2.6 2.6 0 0 0-1.8 1.8A27 27 0 0 0 2 12a27 27 0 0 0 .4 4.8 2.6 2.6 0 0 0 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4a2.6 2.6 0 0 0 1.8-1.8A27 27 0 0 0 22 12a27 27 0 0 0-.4-4.8zM10 15V9l5.2 3L10 15z" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden>
      <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.2-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden>
      <rect x="6" y="5" width="4" height="14" rx="1.2" />
      <rect x="14" y="5" width="4" height="14" rx="1.2" />
    </svg>
  );
}

function NextIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden>
      <path d="M5 6.2v11.6a1 1 0 0 0 1.53.85l8.6-5.8a1 1 0 0 0 0-1.7l-8.6-5.8A1 1 0 0 0 5 6.2z" />
      <rect x="16.5" y="5.5" width="2.6" height="13" rx="1" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden>
      <rect x="6" y="6" width="12" height="12" rx="2.2" />
    </svg>
  );
}

function FullscreenIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
    </svg>
  );
}

/**
 * The embed for the current video, kept in sync with the shared state:
 * other people's play/pause/seek move it, and using the player's own
 * controls tells everyone else.
 */
function SyncedPlayer({
  channelId,
  kind,
  state,
  videoId,
  itemId,
  audioOnly = false,
  volume,
  onProgress,
}: {
  channelId: string;
  kind: PlayKind;
  state: WatchState;
  videoId: string;
  itemId: string;
  /** Listen Together: the player is there for the sound, not shown. */
  audioOnly?: boolean;
  /** 0-100 (sent to the player when it changes). */
  volume?: number;
  onProgress?: (time: number, duration: number) => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const info = useRef<PlayerInfo>({ time: 0, state: -1, duration: 0 });
  // Changes we made ourselves; player events until then aren't the user's.
  const ours = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;
  // The first src starts where everyone is; later changes are done by commands.
  const [src] = useState(() => embedUrl(videoId, livePosition(state)));

  const send = useYouTube(frame, (i) => {
    const prev = info.current;
    info.current = { ...prev, ...i };
    if (i.time !== undefined || i.duration !== undefined) onProgress?.(info.current.time, info.current.duration);
    const w = stateRef.current;
    if (i.state === undefined || i.state === prev.state || Date.now() < ours.current) return;
    if (i.state === 0) {
      // Ended: next in the queue (the server ignores repeats from other apps).
      void watchAction(channelId, { action: "next", item_id: itemId }, kind).catch(() => {});
    } else if (i.state === 2 && w.playing) {
      void watchAction(channelId, { action: "pause", position: info.current.time }, kind).catch(() => {});
    } else if (i.state === 1 && !w.playing) {
      void watchAction(channelId, { action: "play", position: info.current.time }, kind).catch(() => {});
    }
  });

  function apply() {
    const w = stateRef.current;
    const target = livePosition(w);
    ours.current = Date.now() + 1500;
    if (Math.abs(info.current.time - target) > DRIFT) send("seekTo", [target, true]);
    send(w.playing ? "playVideo" : "pauseVideo");
  }

  // Follow the shared state whenever it changes, and re-check drift every few seconds.
  useEffect(() => {
    apply();
    const t = window.setInterval(() => {
      const w = stateRef.current;
      if (w.playing && Math.abs(info.current.time - livePosition(w)) > DRIFT + 1) apply();
    }, 4000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.playing, state.position, state.updated_at]);

  useEffect(() => {
    if (volume !== undefined) send("setVolume", [volume]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [volume]);

  return (
    <div className={`watch-player${audioOnly ? " audio-only" : ""}`} aria-hidden={audioOnly || undefined}>
      <iframe
        key={itemId}
        ref={frame}
        src={src}
        title="YouTube video"
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
        onLoad={() => {
          // Ask the player to start sending its time and state.
          frame.current?.contentWindow?.postMessage(JSON.stringify({ event: "listening", id: 1, channel: "widget" }), "*");
          window.setTimeout(() => {
            apply();
            if (volume !== undefined) send("setVolume", [volume]);
          }, 800);
        }}
      />
    </div>
  );
}

const VOLUME_KEY = "listenTogetherVolume";

function loadVolume(): number {
  try {
    const v = Number(localStorage.getItem(VOLUME_KEY));
    return Number.isFinite(v) && localStorage.getItem(VOLUME_KEY) !== null ? Math.min(100, Math.max(0, v)) : 80;
  } catch {
    return 80;
  }
}

function fmtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/**
 * Listen Together: the YouTube player plays hidden; this is a music player
 * (artwork, progress you can click to seek, play/pause, next, volume).
 */
function ListenStage({
  channelId,
  state,
  item,
  addedBy,
  hasNext,
  act,
}: {
  channelId: string;
  state: WatchState;
  item: { id: string; video_id: string; title: string };
  addedBy: string;
  hasNext: boolean;
  act: (body: WatchAction) => Promise<void>;
}) {
  const [time, setTime] = useState(() => livePosition(state));
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(loadVolume);
  const muted = volume === 0;
  const lastVolume = useRef(volume || 80);
  const art = `https://i.ytimg.com/vi/${item.video_id}/hqdefault.jpg`;

  function changeVolume(v: number) {
    setVolume(v);
    if (v > 0) lastVolume.current = v;
    try {
      localStorage.setItem(VOLUME_KEY, String(v));
    } catch {
      /* ignore */
    }
  }

  function seekFrom(e: React.MouseEvent<HTMLDivElement>) {
    if (!duration) return;
    const r = e.currentTarget.getBoundingClientRect();
    const pos = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * duration;
    setTime(pos);
    void act({ action: "seek", position: pos });
  }

  const pct = duration ? Math.min(100, (time / duration) * 100) : 0;

  return (
    <div className="listen">
      <div className="listen-bg" style={{ backgroundImage: `url(${art})` }} aria-hidden />
      <SyncedPlayer
        key={item.id}
        channelId={channelId}
        kind="listen"
        state={state}
        videoId={item.video_id}
        itemId={item.id}
        audioOnly
        volume={volume}
        onProgress={(t, d) => {
          // Whole seconds are enough for the bar and the clock.
          setTime((prev) => (Math.floor(prev) === Math.floor(t) ? prev : t));
          if (d) setDuration(d);
        }}
      />
      <div className="listen-body">
        <div className={`listen-art${state.playing ? " is-playing" : ""}`}>
          <img src={art} alt="" referrerPolicy="no-referrer" />
        </div>
        <div className="listen-info">
          <span className="listen-label">{state.playing ? "Now playing" : "Paused"}</span>
          <strong className="listen-title" title={item.title}>
            {item.title}
          </strong>
          <span className="listen-by">Added by {addedBy}</span>

          <div className="listen-progress">
            <span>{fmtTime(time)}</span>
            <div className="listen-bar" role="slider" aria-label="Seek" aria-valuemin={0} aria-valuemax={Math.round(duration)} aria-valuenow={Math.round(time)} onClick={seekFrom}>
              <div className="listen-bar-fill" style={{ width: `${pct}%` }} />
              <div className="listen-bar-knob" style={{ left: `${pct}%` }} />
            </div>
            <span>{duration ? fmtTime(duration) : "--:--"}</span>
          </div>

          <div className="listen-controls">
            <button
              type="button"
              className="watch-play"
              title={state.playing ? "Pause for everyone" : "Play for everyone"}
              aria-label={state.playing ? "Pause" : "Play"}
              onClick={() =>
                void act(state.playing ? { action: "pause", position: livePosition(state) } : { action: "play", position: livePosition(state) })
              }
            >
              {state.playing ? <PauseIcon /> : <PlayIcon />}
            </button>
            <button
              type="button"
              className="watch-icon-btn"
              title={hasNext ? "Next" : "Nothing next: stops"}
              aria-label="Next"
              onClick={() => void act({ action: "next", item_id: item.id })}
            >
              <NextIcon />
            </button>
            <div className="listen-volume">
              <button
                type="button"
                className="watch-icon-btn sm"
                title={muted ? "Unmute" : "Mute"}
                aria-label={muted ? "Unmute" : "Mute"}
                onClick={() => changeVolume(muted ? lastVolume.current : 0)}
              >
                <SpeakerIcon muted={muted} />
              </button>
              <input
                type="range"
                min={0}
                max={100}
                value={volume}
                aria-label="Volume (only for you)"
                title="Volume (only for you)"
                style={{ ["--vol" as string]: `${volume}%` }}
                onChange={(e) => changeVolume(Number(e.target.value))}
              />
            </div>
            <button
              type="button"
              className="watch-icon-btn danger"
              title="End for everyone (stops and empties the queue)"
              aria-label="End for everyone"
              onClick={() => void act({ action: "clear" })}
            >
              <StopIcon />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function HeadphonesIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 15v-3a8 8 0 0 1 16 0v3" />
      <rect x="3" y="14" width="5" height="7" rx="2" fill="currentColor" />
      <rect x="16" y="14" width="5" height="7" rx="2" fill="currentColor" />
    </svg>
  );
}

function SpeakerIcon({ muted }: { muted: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor" aria-hidden>
      <path d="M4 9.5v5a1 1 0 0 0 1 1h3l4.3 3.6a.8.8 0 0 0 1.3-.6V5.5a.8.8 0 0 0-1.3-.6L8 8.5H5a1 1 0 0 0-1 1z" />
      {muted ? (
        <path d="M16.3 9.3a.9.9 0 0 1 1.3 0l1.4 1.4 1.4-1.4a.9.9 0 1 1 1.3 1.3L20.3 12l1.4 1.4a.9.9 0 1 1-1.3 1.3L19 13.3l-1.4 1.4a.9.9 0 1 1-1.3-1.3l1.4-1.4-1.4-1.4a.9.9 0 0 1 0-1.3z" />
      ) : (
        <path d="M15.6 9.2a.9.9 0 0 1 1.27.05 4 4 0 0 1 0 5.5.9.9 0 1 1-1.32-1.22 2.2 2.2 0 0 0 0-3.06.9.9 0 0 1 .05-1.27zM18.2 6.6a.9.9 0 0 1 1.27.02 7.8 7.8 0 0 1 0 10.76.9.9 0 1 1-1.3-1.25 6 6 0 0 0 0-8.26.9.9 0 0 1 .03-1.27z" />
      )}
    </svg>
  );
}

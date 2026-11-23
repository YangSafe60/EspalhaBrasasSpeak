import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMini } from "../lib/miniStore";
import { livePosition, loadWatch, watchAction, watchStates, type WatchAction } from "../lib/watchTogether";
import { useAppStore } from "../store/appStore";
import type { WatchState } from "../types";

const YT_HOSTS = ["https://www.youtube-nocookie.com", "https://www.youtube.com"];
/** Out of sync by more than this (seconds) = jump to the shared position. */
const DRIFT = 2;

type PlayerInfo = { time: number; state: number };

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
        const info = data.info as { currentTime?: number; playerState?: number };
        onInfoRef.current({
          ...(typeof info.currentTime === "number" ? { time: info.currentTime } : {}),
          ...(typeof info.playerState === "number" ? { state: info.playerState } : {}),
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
export function WatchTogether({ channelId }: { channelId: string }) {
  const state = useMini(watchStates, (all) => all[channelId]);
  const authors = useAppStore((s) => s.authors);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadWatch(channelId);
  }, [channelId]);

  async function act(body: WatchAction) {
    setError(null);
    try {
      await watchAction(channelId, body);
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
      await watchAction(channelId, { action: "add", url: url.trim() });
      setUrl("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add that video");
    } finally {
      setBusy(false);
    }
  }

  const current = state?.queue.find((i) => i.id === state.current) ?? null;
  const upNext = state?.queue.filter((i) => i.id !== state.current) ?? [];

  return (
    <section className="watch">
      <header className="watch-header">
        <h3>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden>
            <path d="M21.6 7.2a2.6 2.6 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4a2.6 2.6 0 0 0-1.8 1.8A27 27 0 0 0 2 12a27 27 0 0 0 .4 4.8 2.6 2.6 0 0 0 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4a2.6 2.6 0 0 0 1.8-1.8A27 27 0 0 0 22 12a27 27 0 0 0-.4-4.8zM10 15V9l5.2 3L10 15z" />
          </svg>
          Watch together
        </h3>
        {state && state.queue.length > 0 && (
          <button type="button" className="btn ghost sm" onClick={() => void act({ action: "clear" })}>
            Stop &amp; clear
          </button>
        )}
      </header>

      {current && state && <SyncedPlayer key={current.id} channelId={channelId} state={state} videoId={current.video_id} itemId={current.id} />}

      {current && state && (
        <div className="watch-now">
          <div className="watch-now-text">
            <strong title={current.title}>{current.title}</strong>
            <span className="muted tiny">Added by {authors[current.added_by]?.display_name || "someone"}</span>
          </div>
          <div className="row gap-sm">
            <button
              type="button"
              className="btn sm"
              onClick={() =>
                void act(state.playing ? { action: "pause", position: livePosition(state) } : { action: "play", position: livePosition(state) })
              }
            >
              {state.playing ? "Pause" : "Play"}
            </button>
            <button type="button" className="btn sm" onClick={() => void act({ action: "next", item_id: current.id })}>
              {upNext.length ? "Skip" : "Stop"}
            </button>
          </div>
        </div>
      )}

      <form className="watch-add" onSubmit={(e) => void add(e)}>
        <input
          value={url}
          placeholder={current ? "Add a YouTube link to the queue" : "Paste a YouTube link to start watching"}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button type="submit" className="btn primary" disabled={busy || !url.trim()}>
          {busy ? "Adding…" : current ? "Add to queue" : "Play"}
        </button>
      </form>
      {error && <p className="form-error">{error}</p>}

      {upNext.length > 0 && (
        <ol className="watch-queue">
          {upNext.map((item, i) => (
            <li key={item.id}>
              <span className="watch-queue-n">{i + 1}</span>
              <img src={`https://i.ytimg.com/vi/${item.video_id}/mqdefault.jpg`} alt="" referrerPolicy="no-referrer" />
              <span className="watch-queue-title" title={item.title}>
                {item.title}
                <em className="muted tiny">{authors[item.added_by]?.display_name || "someone"}</em>
              </span>
              <button type="button" className="icon-btn" title="Play now" aria-label="Play now" onClick={() => void act({ action: "select", item_id: item.id })}>
                ▶
              </button>
              <button type="button" className="icon-btn" title="Remove" aria-label="Remove" onClick={() => void act({ action: "remove", item_id: item.id })}>
                ✕
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/**
 * The embed for the current video, kept in sync with the shared state:
 * other people's play/pause/seek move it, and using the player's own
 * controls tells everyone else.
 */
function SyncedPlayer({ channelId, state, videoId, itemId }: { channelId: string; state: WatchState; videoId: string; itemId: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const info = useRef<PlayerInfo>({ time: 0, state: -1 });
  // Changes we made ourselves; player events until then aren't the user's.
  const ours = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;
  // The first src starts where everyone is; later changes are done by commands.
  const [src] = useState(() => embedUrl(videoId, livePosition(state)));

  const send = useYouTube(frame, (i) => {
    const prev = info.current;
    info.current = { ...prev, ...i };
    const w = stateRef.current;
    if (i.state === undefined || i.state === prev.state || Date.now() < ours.current) return;
    if (i.state === 0) {
      // Ended: next in the queue (the server ignores repeats from other apps).
      void watchAction(channelId, { action: "next", item_id: itemId }).catch(() => {});
    } else if (i.state === 2 && w.playing) {
      void watchAction(channelId, { action: "pause", position: info.current.time }).catch(() => {});
    } else if (i.state === 1 && !w.playing) {
      void watchAction(channelId, { action: "play", position: info.current.time }).catch(() => {});
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

  return (
    <div className="watch-player">
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
          window.setTimeout(apply, 800);
        }}
      />
    </div>
  );
}

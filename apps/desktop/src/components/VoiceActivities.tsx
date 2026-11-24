import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { ActivityId } from "../lib/voiceActivity";
import { useMini } from "../lib/miniStore";
import { watchKey, watchStates } from "../lib/watchTogether";
import type { WatchState } from "../types";

export type { ActivityId };

type Activity = {
  id: ActivityId;
  name: string;
  description: string;
  /** Card art: a gradient and an icon. */
  art: string;
  icon: ReactNode;
};

function YouTubeIcon({ size = 30 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden>
      <path d="M21.6 7.2a2.6 2.6 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4a2.6 2.6 0 0 0-1.8 1.8A27 27 0 0 0 2 12a27 27 0 0 0 .4 4.8 2.6 2.6 0 0 0 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4a2.6 2.6 0 0 0 1.8-1.8A27 27 0 0 0 22 12a27 27 0 0 0-.4-4.8zM10 15V9l5.2 3L10 15z" />
    </svg>
  );
}

export const ACTIVITIES: Activity[] = [
  {
    id: "watch",
    name: "Watch Together",
    description: "Watch YouTube in sync with everyone in the channel, with a shared queue.",
    art: "linear-gradient(135deg, #e31b23 0%, #7a0d12 60%, #1a0507 100%)",
    icon: <YouTubeIcon />,
  },
  {
    id: "listen",
    name: "Listen Together",
    description: "Music, mixes or podcasts from YouTube, audio only, in sync for everyone in the channel.",
    art: "linear-gradient(135deg, #7c3aed 0%, #3b1a7a 55%, #120726 100%)",
    icon: <HeadphonesIcon />,
  },
];

function HeadphonesIcon({ size = 30 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
      <path d="M4 15v-3a8 8 0 0 1 16 0v3" />
      <rect x="3" y="14" width="5" height="7" rx="2" fill="currentColor" />
      <rect x="16" y="14" width="5" height="7" rx="2" fill="currentColor" />
    </svg>
  );
}

function RocketIcon() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 15c-1.5 1.3-2 5-2 5s3.7-.5 5-2c.7-.8.7-2.1-.1-2.9-.8-.8-2.1-.8-2.9-.1z" />
      <path d="M12 15l-3-3a22 22 0 0 1 2-3.9A12.9 12.9 0 0 1 22 2c0 2.7-.8 7.5-6 11a22 22 0 0 1-4 2z" />
      <path d="M9 12H4s.6-3 2-4c1.6-1.1 5 0 5 0M12 15v5s3-.6 4-2c1.1-1.6 0-5 0-5" />
    </svg>
  );
}

/**
 * "Activities" button with the picker. `dock` = an icon button in the voice
 * bar (bottom left); its list opens upward, drawn over everything.
 */
export function ActivitiesButton({ onPick, variant = "header" }: { onPick: (id: ActivityId) => void; variant?: "header" | "dock" }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    if (variant === "dock" && wrap.current) {
      const r = wrap.current.getBoundingClientRect();
      setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - 336)), bottom: window.innerHeight - r.top + 8 });
    }
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!wrap.current?.contains(t) && !pop.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, variant]);

  const list = (
    <div
      ref={pop}
      className={`activities-pop${variant === "dock" ? " is-dock" : ""}`}
      role="menu"
      style={variant === "dock" && pos ? { left: pos.left, bottom: pos.bottom } : undefined}
    >
      <p className="activities-pop-title">Choose an activity</p>
      {ACTIVITIES.map((a) => (
        <button
          key={a.id}
          type="button"
          role="menuitem"
          className="activity-card"
          onClick={() => {
            setOpen(false);
            onPick(a.id);
          }}
        >
          <span className="activity-card-art" style={{ background: a.art }}>
            {a.icon}
          </span>
          <span className="activity-card-text">
            <strong>{a.name}</strong>
            <span>{a.description}</span>
          </span>
        </button>
      ))}
    </div>
  );

  return (
    <div className="activities" ref={wrap}>
      {variant === "dock" ? (
        <button
          type="button"
          className={`voice-icon-btn${open ? " menu-open" : ""}`}
          title="Activities"
          aria-label="Activities"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <RocketIcon />
        </button>
      ) : (
        <button type="button" className={`activities-btn${open ? " is-open" : ""}`} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <RocketIcon />
          Activities
        </button>
      )}
      {open && (variant === "dock" ? (pos ? createPortal(list, document.body) : null) : list)}
    </div>
  );
}

/** Shown in the lobby while someone in the channel has an activity going. */
export function RunningActivityCard({ channelId, onJoin }: { channelId: string; onJoin: (id: ActivityId) => void }) {
  const watch = useMini(watchStates, (all) => all[watchKey(channelId, "watch")]);
  const listen = useMini(watchStates, (all) => all[watchKey(channelId, "listen")]);
  return (
    <>
      <RunningCard id="watch" state={watch} onJoin={onJoin} />
      <RunningCard id="listen" state={listen} onJoin={onJoin} />
    </>
  );
}

function RunningCard({ id, state, onJoin }: { id: ActivityId; state: WatchState | undefined; onJoin: (id: ActivityId) => void }) {
  const current = state?.queue.find((i) => i.id === state.current);
  if (!state || !current) return null;
  const activity = ACTIVITIES.find((a) => a.id === id)!;
  const more = state.queue.length - 1;
  const verb = id === "listen" ? (state.playing ? "Listening now" : "Paused") : state.playing ? "Watching now" : "Paused";
  return (
    <section className={`activity-running kind-${id}`}>
      <span className="activity-running-art" style={{ background: activity.art }}>
        <img src={`https://i.ytimg.com/vi/${current.video_id}/mqdefault.jpg`} alt="" referrerPolicy="no-referrer" />
        <span className="activity-running-badge">{id === "listen" ? <HeadphonesIcon size={14} /> : <YouTubeIcon size={14} />}</span>
      </span>
      <div className="activity-running-text">
        <span className="activity-running-label">
          {verb} · {activity.name}
        </span>
        <strong title={current.title}>{current.title}</strong>
        {more > 0 && <span className="muted tiny">{more} more in the queue</span>}
      </div>
      <button type="button" className="btn primary" onClick={() => onJoin(id)}>
        Join
      </button>
    </section>
  );
}

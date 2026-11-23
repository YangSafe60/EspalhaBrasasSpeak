import { useEffect, useMemo, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { mediaUrl } from "../lib/mediaUrl";
import { useMini } from "../lib/miniStore";
import { createEvent, deleteEvent, loadEvents, serverEvents, setGoing, untilLabel } from "../lib/serverEvents";
import { useAppStore } from "../store/appStore";
import type { ServerEvent } from "../types";
import { AppSelect } from "./AppSelect";

const EMPTY: ServerEvent[] = [];

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </svg>
  );
}

/** Re-render every 30 s so "in 12 min" stays right. */
function useNow(ms = 30_000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(t);
  }, [ms]);
  return now;
}

/** Sidebar header button: calendar with the number of upcoming events. */
export function ServerEventsButton({ serverId, canManage }: { serverId: string; canManage: boolean }) {
  const events = useMini(serverEvents, (all) => all[serverId] ?? EMPTY);
  const [open, setOpen] = useState(false);
  const now = useNow();

  useEffect(() => {
    void loadEvents(serverId);
  }, [serverId]);

  // Open the panel when a reminder is clicked.
  useEffect(() => {
    const onOpen = (e: Event) => {
      if ((e as CustomEvent<string>).detail === serverId) setOpen(true);
    };
    window.addEventListener("open-server-events", onOpen);
    return () => window.removeEventListener("open-server-events", onOpen);
  }, [serverId]);

  const upcoming = events.filter((e) => new Date(e.starts_at).getTime() > now - 3 * 3600_000).length;
  const soon = events.some((e) => {
    const t = new Date(e.starts_at).getTime() - now;
    return t > -3600_000 && t < 3600_000;
  });

  return (
    <>
      <button
        type="button"
        className={`icon-btn events-btn${soon ? " is-soon" : ""}`}
        title={upcoming ? `Events (${upcoming})` : "Events"}
        aria-label="Events"
        onClick={() => setOpen(true)}
      >
        <CalendarIcon />
        {upcoming > 0 && <span className="events-btn-count">{upcoming > 9 ? "9+" : upcoming}</span>}
      </button>
      {open && <ServerEventsModal serverId={serverId} canManage={canManage} onClose={() => setOpen(false)} />}
    </>
  );
}

/** Next full hour, as a value for <input type="datetime-local">. */
function defaultStart(): string {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 2);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function ServerEventsModal({ serverId, canManage, onClose }: { serverId: string; canManage: boolean; onClose: () => void }) {
  const events = useMini(serverEvents, (all) => all[serverId] ?? EMPTY);
  const channels = useAppStore((s) => s.channelsByServer[serverId]);
  const [creating, setCreating] = useState(events.length === 0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const voiceChannels = useMemo(() => (channels || []).filter((c) => c.channel_type === "voice"), [channels]);

  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal events-modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h3>Events</h3>
          <div className="row gap-sm">
            {!creating && (
              <button type="button" className="btn primary sm" onClick={() => setCreating(true)}>
                Create event
              </button>
            )}
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>
        </header>
        <div className="events-body">
          {creating && (
            <CreateEventForm
              serverId={serverId}
              voiceChannels={voiceChannels}
              onDone={() => setCreating(false)}
              onCancel={events.length ? () => setCreating(false) : undefined}
            />
          )}
          {events.length === 0 && !creating && <p className="muted">No events yet.</p>}
          {events.map((e) => (
            <EventCard key={e.id} event={e} canManage={canManage} onJoined={onClose} />
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function CreateEventForm({
  serverId,
  voiceChannels,
  onDone,
  onCancel,
}: {
  serverId: string;
  voiceChannels: { id: string; name: string }[];
  onDone: () => void;
  onCancel?: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [when, setWhen] = useState(defaultStart);
  const [channelId, setChannelId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const start = new Date(when);
    if (Number.isNaN(start.getTime())) {
      setError("Pick a date and time.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await createEvent(serverId, {
        title: title.trim(),
        description: description.trim() || undefined,
        starts_at: start.toISOString(),
        channel_id: channelId || null,
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the event");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="event-form stack" onSubmit={(e) => void submit(e)}>
      <label>
        Title
        <input autoFocus required maxLength={100} value={title} placeholder="CS2 – 5 stack" onChange={(e) => setTitle(e.target.value)} />
      </label>
      <div className="event-form-row">
        <label>
          When
          <input type="datetime-local" required value={when} onChange={(e) => setWhen(e.target.value)} />
        </label>
        <AppSelect
          label="Voice channel"
          value={channelId}
          options={[{ value: "", label: "None" }, ...voiceChannels.map((c) => ({ value: c.id, label: c.name }))]}
          onChange={setChannelId}
        />
      </div>
      <label>
        Description
        <textarea rows={2} maxLength={1000} value={description} placeholder="Optional" onChange={(e) => setDescription(e.target.value)} />
      </label>
      {error && <p className="form-error">{error}</p>}
      <div className="row gap-sm">
        <button type="submit" className="btn primary" disabled={busy || !title.trim()}>
          {busy ? "Creating…" : "Create event"}
        </button>
        {onCancel && (
          <button type="button" className="btn ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

function EventCard({ event, canManage, onJoined }: { event: ServerEvent; canManage: boolean; onJoined: () => void }) {
  const me = useAppStore((s) => s.user);
  const authors = useAppStore((s) => s.authors);
  const channel = useAppStore((s) =>
    event.channel_id ? (s.channelsByServer[event.server_id] || []).find((c) => c.id === event.channel_id) : undefined,
  );
  const requestVoiceJoin = useAppStore((s) => s.requestVoiceJoin);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const now = useNow();

  const start = new Date(event.starts_at);
  const going = Boolean(me && event.going.includes(me.id));
  const live = start.getTime() <= now && now - start.getTime() < 3 * 3600_000;
  const soon = !live && start.getTime() - now < 3600_000;
  const canDelete = Boolean(me && (event.creator_id === me.id || canManage));

  async function toggle() {
    setBusy(true);
    try {
      await setGoing(event, !going);
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className={`event-card${live ? " is-live" : soon ? " is-soon" : ""}`}>
      <div className="event-date" aria-hidden>
        <span className="event-date-month">{start.toLocaleString(undefined, { month: "short" })}</span>
        <span className="event-date-day">{start.getDate()}</span>
      </div>
      <div className="event-main">
        <div className="event-when">
          {start.toLocaleString(undefined, { weekday: "long", hour: "2-digit", minute: "2-digit" })}
          <span className="event-until">{live ? "Happening now" : untilLabel(event.starts_at, now)}</span>
        </div>
        <h4 className="event-title">{event.title}</h4>
        {event.description && <p className="event-desc">{event.description}</p>}
        {channel && (
          <button
            type="button"
            className="event-channel"
            title="Join this voice channel"
            onClick={() => {
              requestVoiceJoin(channel.id);
              onJoined();
            }}
          >
            🔊 {channel.name}
          </button>
        )}
        <div className="event-footer">
          <div className="event-going" title={event.going.map((id) => authors[id]?.display_name || "Someone").join(", ")}>
            {event.going.slice(0, 6).map((id) => {
              const u = authors[id];
              return u?.avatar_url ? (
                <img key={id} src={mediaUrl(u.avatar_url)} alt="" referrerPolicy="no-referrer" />
              ) : (
                <span key={id}>{(u?.display_name || "?").charAt(0).toUpperCase()}</span>
              );
            })}
            <em>{event.going.length} going</em>
          </div>
          <div className="row gap-sm">
            {canDelete &&
              (confirmDelete ? (
                <button type="button" className="btn danger sm" onClick={() => void deleteEvent(event)}>
                  Delete?
                </button>
              ) : (
                <button type="button" className="btn ghost sm" onClick={() => setConfirmDelete(true)} onBlur={() => setConfirmDelete(false)}>
                  Delete
                </button>
              ))}
            <button type="button" className={`btn sm ${going ? "going" : "primary"}`} disabled={busy} onClick={() => void toggle()}>
              {going ? "✓ Going" : "I'm going"}
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

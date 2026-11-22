import { useEffect, useState, type FormEvent } from "react";
import { mediaUrl } from "../lib/mediaUrl";
import { useAppStore } from "../store/appStore";
import type { Message } from "../types";

/** Suggestions for the game field (any name works). */
const GAMES = [
  "Valorant",
  "Counter-Strike 2",
  "League of Legends",
  "Fortnite",
  "Rocket League",
  "Apex Legends",
  "Overwatch 2",
  "EA Sports FC",
  "Call of Duty",
  "Minecraft",
  "GTA Online",
  "Rainbow Six Siege",
];

const DURATIONS = [
  { label: "30 minutes", minutes: 30 },
  { label: "1 hour", minutes: 60 },
  { label: "2 hours", minutes: 120 },
  { label: "6 hours", minutes: 360 },
  { label: "No limit", minutes: 0 },
];

function left(ms: number): string {
  const mins = Math.max(0, Math.ceil(ms / 60000));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** "Find players" card: who's in, Join / Leave, time left; closes when full. */
export function PlayerGroupCard({ message }: { message: Message }) {
  const joinGroup = useAppStore((s) => s.joinGroup);
  const authors = useAppStore((s) => s.authors);
  const me = useAppStore((s) => s.user);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const group = message.lfg;

  const expiresAt = group?.expires_at ? new Date(group.expires_at).getTime() : null;
  const full = Boolean(group?.completed_at);
  const expired = !full && expiresAt != null && expiresAt <= now;
  const open = Boolean(group) && !full && !expired;

  useEffect(() => {
    if (!open || expiresAt == null) return;
    const t = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(t);
  }, [open, expiresAt]);

  if (!group) return null;
  const creator = authors[message.author_id];
  const joined = me ? group.members.includes(me.id) : false;
  const name = (id: string) => authors[id]?.display_name || authors[id]?.username || "Someone";

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      await joinGroup(message.id, !joined);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't update");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`lfg-card${full ? " is-full" : expired ? " is-closed" : ""}`}>
      <div className="lfg-main">
        <div className="lfg-creator">
          {creator?.avatar_url ? (
            <img src={mediaUrl(creator.avatar_url)} alt="" referrerPolicy="no-referrer" />
          ) : (
            <span className="lfg-avatar">{(creator?.display_name || "?").charAt(0).toUpperCase()}</span>
          )}
          <span>
            Created by <strong>{creator?.display_name || "someone"}</strong>
          </span>
        </div>
        <h4 className="lfg-title">
          <span aria-hidden>🎮</span> Looking for players for {group.game}
        </h4>
        <p className="lfg-section-title">
          <span aria-hidden>👥</span> Players ({group.members.length}/{group.slots})
        </p>
        <ol className="lfg-members">
          {/* Big groups: the people, then one "N open slots" line. */}
          {Array.from({ length: group.slots > 6 ? group.members.length : group.slots }, (_, i) => {
            const id = group.members[i];
            return (
              <li key={id ?? `free-${i}`} className={id ? undefined : "is-free"}>
                {id ? <span className="mention">@{name(id)}</span> : <span className="muted">Open slot</span>}
              </li>
            );
          })}
          {group.slots > 6 && group.slots > group.members.length && (
            <li className="is-free lfg-more">
              <span className="muted">
                {group.slots - group.members.length} open {group.slots - group.members.length === 1 ? "slot" : "slots"}
              </span>
            </li>
          )}
        </ol>
        {open && expiresAt != null && (
          <p className="lfg-section-title">
            <span aria-hidden>⏰</span> Closes in <code className="inline-code">{left(expiresAt - now)}</code>
          </p>
        )}
        {full && <p className="lfg-status ok">✅ Group complete</p>}
        {expired && <p className="lfg-status">Closed before it filled up</p>}
      </div>
      {open && (
        <div className="lfg-actions">
          <button
            type="button"
            className={`btn sm ${joined ? "ghost" : "lfg-join"}`}
            disabled={busy}
            onClick={() => void toggle()}
          >
            {joined ? "Leave" : "✅ Join"}
          </button>
          {error && <span className="form-error tiny">{error}</span>}
        </div>
      )}
    </div>
  );
}

/** "Find players" form (second tab of the poll dialog). */
export function CreateGroupForm({ channelId, onDone }: { channelId: string; onDone: () => void }) {
  const createGroup = useAppStore((s) => s.createGroup);
  const [game, setGame] = useState("");
  const [slots, setSlots] = useState(5);
  const [minutes, setMinutes] = useState(60);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!game.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await createGroup(channelId, game.trim(), slots, minutes || null);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the group");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="poll-dialog-body" onSubmit={(e) => void submit(e)}>
      <label>
        Game
        <input
          autoFocus
          list="lfg-games"
          value={game}
          maxLength={60}
          placeholder="Valorant"
          onChange={(e) => setGame(e.target.value)}
        />
        <datalist id="lfg-games">
          {GAMES.map((g) => (
            <option key={g} value={g} />
          ))}
        </datalist>
      </label>
      <div className="lfg-form-row">
        <label>
          Players (you included)
          <select value={slots} onChange={(e) => setSlots(Number(e.target.value))}>
            {Array.from({ length: 19 }, (_, i) => i + 2).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label>
          Time limit
          <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
            {DURATIONS.map((d) => (
              <option key={d.minutes} value={d.minutes}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && <p className="form-error tiny">{error}</p>}
      <footer className="group-dm-actions">
        <button type="button" className="btn ghost" onClick={onDone}>
          Cancel
        </button>
        <button type="submit" className="btn primary" disabled={busy || !game.trim()}>
          Post
        </button>
      </footer>
    </form>
  );
}

import { useEffect, useState, type FormEvent } from "react";
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
        <div className="lfg-head">
          <h4 className="lfg-title">
            <span aria-hidden>🎮</span> Looking for players for {group.game}
          </h4>
          {open && expiresAt != null && (
            <span className="lfg-timer" title="Closes automatically">
              <span aria-hidden>⏰</span> {left(expiresAt - now)}
            </span>
          )}
        </div>
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

/** Game field with suggestions in the app's style (any name is allowed). */
function GamePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const q = value.trim().toLowerCase();
  const matches = GAMES.filter((g) => !q || g.toLowerCase().includes(q));

  function pick(g: string) {
    onChange(g);
    setOpen(false);
  }

  return (
    <div className="game-picker">
      <label htmlFor="lfg-game">Game</label>
      <input
        id="lfg-game"
        autoFocus
        autoComplete="off"
        role="combobox"
        aria-expanded={open && matches.length > 0}
        aria-controls="lfg-game-list"
        value={value}
        maxLength={60}
        placeholder="Pick or type a game"
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setHi(0);
        }}
        onKeyDown={(e) => {
          if (!open || matches.length === 0) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHi((i) => (i + 1) % matches.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHi((i) => (i - 1 + matches.length) % matches.length);
          } else if (e.key === "Enter") {
            e.preventDefault();
            pick(matches[Math.min(hi, matches.length - 1)]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {open && matches.length > 0 && (
        <ul className="game-picker-list" id="lfg-game-list" role="listbox">
          {matches.map((g, i) => (
            <li
              key={g}
              role="option"
              aria-selected={i === hi}
              className={i === hi ? "is-active" : undefined}
              // mousedown, not click: runs before the input's blur closes the list
              onMouseDown={(e) => {
                e.preventDefault();
                pick(g);
              }}
              onMouseEnter={() => setHi(i)}
            >
              {g}
            </li>
          ))}
        </ul>
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
      <GamePicker value={game} onChange={setGame} />
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

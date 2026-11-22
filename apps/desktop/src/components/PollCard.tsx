import { CreateGroupForm } from "./PlayerGroupCard";
import { useState, type FormEvent } from "react";
import { useAppStore } from "../store/appStore";
import type { Message } from "../types";

/** A poll under its message: bars with totals, click to vote. */
export function PollCard({ message }: { message: Message }) {
  const votePoll = useAppStore((s) => s.votePoll);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const poll = message.poll;
  if (!poll) return null;
  const total = poll.options.reduce((n, o) => n + o.votes, 0);
  const mine = new Set(poll.my_votes);

  async function pick(optionId: string) {
    if (busy || !poll) return;
    let next: string[];
    if (poll.multi) next = mine.has(optionId) ? [...mine].filter((o) => o !== optionId) : [...mine, optionId];
    else next = mine.has(optionId) ? [] : [optionId];
    setBusy(true);
    setError(null);
    try {
      await votePoll(message.id, next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't vote");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="poll-card">
      <div className="poll-head">
        <h4 className="poll-title">
          <span aria-hidden>📊</span> {poll.question}
        </h4>
        <span className="poll-kind">{poll.multi ? "Pick any" : "Pick one"}</span>
      </div>
      <ul className="poll-options">
        {poll.options.map((o) => {
          const pct = total ? Math.round((o.votes / total) * 100) : 0;
          const chosen = mine.has(o.id);
          return (
            <li key={o.id}>
              <button
                type="button"
                className={`poll-option${chosen ? " is-mine" : ""}`}
                disabled={busy}
                aria-pressed={chosen}
                onClick={() => void pick(o.id)}
              >
                <span className="poll-bar" style={{ width: `${pct}%` }} aria-hidden />
                <span className="poll-check" aria-hidden>{chosen ? "✓" : ""}</span>
                <span className="poll-label">{o.label}</span>
                <span className="poll-count">{pct}% · {o.votes}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="poll-foot">
        {total} {total === 1 ? "vote" : "votes"}
        {mine.size > 0 && <span> · you voted</span>}
      </p>
      {error && <p className="form-error tiny">{error}</p>}
    </div>
  );
}

/** Dialog behind the poll button: a poll, or a "find players" group. */
export function CreatePollDialog({ channelId, onClose }: { channelId: string; onClose: () => void }) {
  const [mode, setMode] = useState<"poll" | "group">("poll");
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal poll-dialog" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h3>{mode === "poll" ? "Create a poll" : "Find players"}</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="poll-mode" role="tablist">
          <button type="button" role="tab" aria-selected={mode === "poll"} className={mode === "poll" ? "active" : ""} onClick={() => setMode("poll")}>
            📊 Poll
          </button>
          <button type="button" role="tab" aria-selected={mode === "group"} className={mode === "group" ? "active" : ""} onClick={() => setMode("group")}>
            🎮 Find players
          </button>
        </div>
        {mode === "poll" ? (
          <PollForm channelId={channelId} onDone={onClose} />
        ) : (
          <CreateGroupForm channelId={channelId} onDone={onClose} />
        )}
      </div>
    </div>
  );
}

function PollForm({ channelId, onDone: onClose }: { channelId: string; onDone: () => void }) {
  const createPoll = useAppStore((s) => s.createPoll);
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [multi, setMulti] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const filled = options.filter((o) => o.trim()).length;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!question.trim() || filled < 2) return;
    setBusy(true);
    setError(null);
    try {
      await createPoll(channelId, question.trim(), options.map((o) => o.trim()).filter(Boolean), multi);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the poll");
    } finally {
      setBusy(false);
    }
  }

  return (
      <form className="poll-dialog-body" onSubmit={(e) => void submit(e)}>
        <label>
          Question
          <input autoFocus value={question} maxLength={300} onChange={(e) => setQuestion(e.target.value)} placeholder="What time do we play?" />
        </label>
        <div className="poll-dialog-options">
          <span className="poll-dialog-label">Options</span>
          {options.map((o, i) => (
            <div key={i} className="poll-dialog-row">
              <input
                value={o}
                maxLength={100}
                placeholder={`Option ${i + 1}`}
                onChange={(e) => setOptions((prev) => prev.map((p, j) => (j === i ? e.target.value : p)))}
              />
              {options.length > 2 && (
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Remove option ${i + 1}`}
                  onClick={() => setOptions((prev) => prev.filter((_, j) => j !== i))}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          {options.length < 10 && (
            <button type="button" className="btn ghost sm" onClick={() => setOptions((prev) => [...prev, ""])}>
              + Add option
            </button>
          )}
        </div>
        <label className="toggle-row">
          <span>Allow more than one answer</span>
          <input type="checkbox" checked={multi} onChange={(e) => setMulti(e.target.checked)} />
        </label>
        {error && <p className="form-error tiny">{error}</p>}
        <footer className="group-dm-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy || !question.trim() || filled < 2}>
            Post poll
          </button>
        </footer>
      </form>
  );
}

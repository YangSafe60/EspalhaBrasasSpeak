import { useState, type FormEvent } from "react";
import { api } from "../api/client";
import type { UserProfileExtras } from "../types";
import { AppSelect } from "./AppSelect";
import { EmojiPickerButton } from "./EmojiPickerButton";

export type CustomStatus = NonNullable<UserProfileExtras["custom_status"]>;

const CLEAR_AFTER = [
  { value: 0, label: "Don't clear" },
  { value: 30, label: "30 minutes" },
  { value: 60, label: "1 hour" },
  { value: 240, label: "4 hours" },
  { value: -1, label: "Today" },
  { value: 60 * 24 * 7, label: "This week" },
];

/** Minutes until the end of today (local time). */
function minutesLeftToday(): number {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  return Math.max(1, Math.round((end.getTime() - Date.now()) / 60000));
}

/**
 * Speech-bubble status on the profile card (like Discord's). On my own card
 * it opens a small editor: text, an emoji, and when to clear it.
 */
export function CustomStatusBubble({
  status,
  editable,
  onChange,
}: {
  status: CustomStatus | null | undefined;
  editable: boolean;
  onChange?: (s: CustomStatus | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [emoji, setEmoji] = useState("");
  const [clearAfter, setClearAfter] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!status && !editable) return null;

  function openEditor() {
    if (!editable) return;
    setText(status?.text ?? "");
    setEmoji(status?.emoji ?? "");
    setClearAfter(0);
    setError(null);
    setEditing(true);
  }

  async function save(clear: boolean, e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const minutes = clearAfter === -1 ? minutesLeftToday() : clearAfter || null;
      const res = await api<UserProfileExtras>("/api/users/me/custom-status", {
        method: "PUT",
        body: clear ? { text: "", emoji: "" } : { text: text.trim(), emoji, expires_minutes: minutes },
      });
      onChange?.(res.custom_status ?? null);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="status-bubble-anchor">
      {status ? (
        <button
          type="button"
          className={`status-bubble${editable ? " is-editable" : ""}`}
          onClick={openEditor}
          disabled={!editable}
          title={editable ? "Edit your status" : undefined}
        >
          {status.emoji && <span className="status-bubble-emoji">{status.emoji}</span>}
          {status.text && <span className="status-bubble-text">{status.text}</span>}
        </button>
      ) : (
        <button type="button" className="status-bubble is-empty" onClick={openEditor}>
          + Add status
        </button>
      )}

      {editing && (
        <form className="status-editor" onSubmit={(e) => void save(false, e)} onClick={(e) => e.stopPropagation()}>
          <div className="status-editor-row">
            <EmojiPickerButton
              className="status-editor-emoji"
              title="Pick an emoji"
              placement="auto"
              onPick={(e) => {
                // Custom server emojis are tokens; the bubble shows plain emoji.
                if (!e.startsWith("<")) setEmoji(e);
              }}
            >
              <span aria-hidden>{emoji || "🙂"}</span>
            </EmojiPickerButton>
            <input
              autoFocus
              value={text}
              maxLength={128}
              placeholder="What's up?"
              onChange={(e) => setText(e.target.value)}
            />
          </div>
          <AppSelect label="Clear after" value={clearAfter} options={CLEAR_AFTER} onChange={setClearAfter} />
          {error && <p className="form-error tiny">{error}</p>}
          <div className="status-editor-actions">
            {status && (
              <button type="button" className="btn ghost sm" disabled={busy} onClick={() => void save(true)}>
                Clear status
              </button>
            )}
            <span className="status-editor-spacer" />
            <button type="button" className="btn ghost sm" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button type="submit" className="btn primary sm" disabled={busy || (!text.trim() && !emoji)}>
              Save
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

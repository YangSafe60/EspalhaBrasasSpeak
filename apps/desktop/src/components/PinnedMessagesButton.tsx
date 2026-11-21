import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { useAppStore } from "../store/appStore";
import type { Message } from "../types";

function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden fill="currentColor">
      <path d="M16 3a1 1 0 0 1 .7 1.7L15.4 6l2.6 5.2 1.3-1.3a1 1 0 1 1 1.4 1.4l-3 3-1.4-1.4L13 16.2V20a1 1 0 0 1-1.7.7L8 17.4 4.7 20.7a1 1 0 0 1-1.4-1.4L6.6 16 3.3 12.7A1 1 0 0 1 4 11h3.8l3.3-3.3-1.4-1.4 3-3a1 1 0 0 1 .7-.3h2.6z" />
    </svg>
  );
}

/**
 * Header button that lists the channel's pinned messages (newest pin first);
 * clicking one jumps to it when it's loaded.
 */
export function PinnedMessagesButton({
  channelId,
  onJump,
}: {
  channelId: string;
  onJump: (messageId: string) => void;
}) {
  const authors = useAppStore((s) => s.authors);
  // Re-fetch when a pin changes in the loaded messages.
  const pinKey = useAppStore((s) =>
    (s.messagesByChannel[channelId] || [])
      .filter((m) => m.pinned_at)
      .map((m) => m.id)
      .join(","),
  );
  const [open, setOpen] = useState(false);
  const [pins, setPins] = useState<Message[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setOpen(false);
    setPins(null);
  }, [channelId]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    void api<Message[]>(`/api/channels/${channelId}/pins`)
      .then((list) => !cancelled && setPins(list))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Could not load pins"));
    return () => {
      cancelled = true;
    };
  }, [open, channelId, pinKey]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="pins-root" ref={rootRef}>
      <button
        type="button"
        className={`icon-btn pins-toggle${open ? " active" : ""}`}
        title="Pinned messages"
        aria-label="Pinned messages"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <PinIcon />
      </button>
      {open && (
        <div className="pins-panel" role="dialog" aria-label="Pinned messages">
          <h4>Pinned messages</h4>
          {error && <p className="form-error tiny">{error}</p>}
          {!error && pins === null && <p className="muted tiny">Loading…</p>}
          {pins && pins.length === 0 && (
            <p className="muted tiny">No pinned messages in this channel yet.</p>
          )}
          {pins && pins.length > 0 && (
            <ul className="pins-list">
              {pins.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    className="pins-item"
                    onClick={() => {
                      setOpen(false);
                      onJump(m.id);
                    }}
                  >
                    <strong>{authors[m.author_id]?.display_name || "Unknown"}</strong>
                    <span className="pins-text">
                      {m.content || (m.attachments?.length ? "Attachment" : "")}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export { PinIcon };

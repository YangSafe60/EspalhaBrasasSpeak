import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";

/** Notes I already loaded this session (target id -> note). */
const cache = new Map<string, string>();

/**
 * My private note about someone, on their profile card ("primo do João").
 * Only I can see it. Saved when the field loses focus.
 */
export function UserNoteField({ userId }: { userId: string }) {
  const [note, setNote] = useState(() => cache.get(userId) ?? "");
  const [loaded, setLoaded] = useState(cache.has(userId));
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const saved = useRef(cache.get(userId) ?? "");
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let alive = true;
    api<{ note: string | null }>(`/api/users/${userId}/note`)
      .then((r) => {
        if (!alive) return;
        const n = r.note ?? "";
        cache.set(userId, n);
        saved.current = n;
        // Don't clobber what the person is already typing.
        if (document.activeElement !== ref.current) setNote(n);
        setLoaded(true);
      })
      .catch(() => alive && setLoaded(true));
    return () => {
      alive = false;
    };
  }, [userId]);

  // Grow with the text (up to a few lines).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    // + the 2px of border, or a one-line note gets a scrollbar.
    const full = el.scrollHeight + 2;
    el.style.height = `${Math.min(full, 96)}px`;
    el.style.overflowY = full > 96 ? "auto" : "hidden";
  }, [note]);

  async function save() {
    const text = note.trim();
    if (text === saved.current) return;
    setState("saving");
    try {
      const r = await api<{ note: string | null }>(`/api/users/${userId}/note`, { method: "PUT", body: { note: text } });
      saved.current = r.note ?? "";
      cache.set(userId, saved.current);
      setState("saved");
      window.setTimeout(() => setState((s) => (s === "saved" ? "idle" : s)), 1500);
    } catch {
      setState("error");
    }
  }

  return (
    <section className="mini-profile-section user-note">
      <h4>
        Note
        <span className="user-note-state">
          {state === "saving" ? "Saving…" : state === "saved" ? "Saved" : state === "error" ? "Couldn't save" : "Only you can see this"}
        </span>
      </h4>
      <textarea
        ref={ref}
        rows={1}
        maxLength={256}
        value={note}
        disabled={!loaded}
        placeholder={loaded ? "Click to add a note" : "Loading…"}
        onChange={(e) => setNote(e.target.value)}
        onBlur={() => void save()}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            e.currentTarget.blur();
          }
          // Esc leaves the field; it doesn't close the card.
          if (e.key === "Escape") {
            e.stopPropagation();
            e.currentTarget.blur();
          }
        }}
      />
    </section>
  );
}

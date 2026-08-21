import { useEffect, useRef, useState } from "react";
import { EMOJI_CATEGORIES } from "../lib/emojis";

type Props = {
  onPick: (emoji: string) => void;
  /** Prefer opening upward (composer is at the bottom). */
  placement?: "up" | "down";
};

export function EmojiPickerButton({ onPick, placement = "up" }: Props) {
  const [open, setOpen] = useState(false);
  const [categoryId, setCategoryId] = useState(EMOJI_CATEGORIES[0]?.id ?? "smileys");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const category =
    EMOJI_CATEGORIES.find((c) => c.id === categoryId) || EMOJI_CATEGORIES[0];

  return (
    <div className="emoji-picker-root" ref={rootRef}>
      <button
        type="button"
        className="icon-btn emoji-picker-toggle"
        title="Emoji"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
      >
        🙂
      </button>
      {open && (
        <div
          className={`emoji-picker-panel ${placement === "up" ? "up" : "down"}`}
          role="dialog"
          aria-label="Emoji picker"
        >
          <div className="emoji-picker-tabs" role="tablist">
            {EMOJI_CATEGORIES.map((c) => (
              <button
                key={c.id}
                type="button"
                role="tab"
                aria-selected={c.id === category.id}
                className={c.id === category.id ? "active" : undefined}
                title={c.label}
                onClick={() => setCategoryId(c.id)}
              >
                {c.emojis[0]}
              </button>
            ))}
          </div>
          <div className="emoji-picker-grid">
            {category.emojis.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className="emoji-picker-cell"
                onClick={() => {
                  onPick(emoji);
                  setOpen(false);
                }}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

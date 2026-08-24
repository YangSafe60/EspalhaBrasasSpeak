import { useEffect, useMemo, useRef, useState } from "react";
import { loadEmojiCatalog, searchEmojis } from "../lib/emojiCatalog";
import { EMOJI_CATEGORIES, type EmojiCategory } from "../lib/emojis";

type Props = {
  onPick: (emoji: string) => void;
  placement?: "up" | "down";
};

export function EmojiPickerButton({ onPick, placement = "up" }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [categories, setCategories] = useState<EmojiCategory[]>(EMOJI_CATEGORIES);
  const [categoryId, setCategoryId] = useState(EMOJI_CATEGORIES[0]?.id ?? "smileys");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void loadEmojiCatalog().then((list) => {
      setCategories(list);
      setCategoryId((id) => (list.some((c) => c.id === id) ? id : list[0]?.id ?? id));
    });
  }, []);

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
    categories.find((c) => c.id === categoryId) || categories[0];
  const searchHits = useMemo(
    () => (query.trim() ? searchEmojis(categories, query) : []),
    [categories, query],
  );
  const shown = query.trim() ? searchHits : category?.emojis || [];

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
          <input
            className="emoji-picker-search"
            type="search"
            placeholder="Search emoji"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          {!query.trim() && (
            <div className="emoji-picker-tabs" role="tablist">
              {categories.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  role="tab"
                  aria-selected={c.id === category?.id}
                  className={c.id === category?.id ? "active" : undefined}
                  title={c.label}
                  onClick={() => setCategoryId(c.id)}
                >
                  {c.emojis[0]}
                </button>
              ))}
            </div>
          )}
          <div className="emoji-picker-grid">
            {shown.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className="emoji-picker-cell"
                onClick={() => {
                  onPick(emoji);
                  setOpen(false);
                  setQuery("");
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

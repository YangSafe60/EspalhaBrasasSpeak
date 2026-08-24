import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";

export type GifHit = {
  id: string;
  title: string;
  preview_url: string;
  url: string;
};

type Props = {
  onPick: (gif: GifHit) => void;
  placement?: "up" | "down";
};

export function GifPickerButton({ onPick, placement = "up" }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<GifHit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      setBusy(true);
      setError(null);
      void api<{ gifs: GifHit[] }>("/api/gifs/search", {
        query: { q: query.trim() || undefined },
      })
        .then((res) => setHits(res.gifs || []))
        .catch((e: Error) => {
          setHits([]);
          setError(e.message || "GIF search failed");
        })
        .finally(() => setBusy(false));
    }, 280);
    return () => window.clearTimeout(t);
  }, [open, query]);

  return (
    <div className="emoji-picker-root" ref={rootRef}>
      <button
        type="button"
        className={`icon-btn gif-picker-toggle${open ? " is-open" : ""}`}
        title="GIF"
        aria-label="Search GIFs"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="gif-picker-mark" aria-hidden>
          <span className="gif-picker-mark-text">GIF</span>
        </span>
      </button>
      {open && (
        <div
          className={`emoji-picker-panel gif-picker-panel ${placement === "up" ? "up" : "down"}`}
          role="dialog"
          aria-label="GIF picker"
        >
          <input
            className="emoji-picker-search"
            type="search"
            placeholder="Search GIFs"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          {error && <p className="muted tiny gif-picker-status">{error}</p>}
          {!error && busy && <p className="muted tiny gif-picker-status">Searching…</p>}
          <div className="gif-picker-grid">
            {hits.map((g) => (
              <button
                key={g.id}
                type="button"
                className="gif-picker-cell"
                title={g.title}
                onClick={() => {
                  onPick(g);
                  setOpen(false);
                }}
              >
                <img src={g.preview_url} alt={g.title} />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

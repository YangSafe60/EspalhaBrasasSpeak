import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
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

const PANEL_GAP = 8;
const VIEWPORT_PAD = 8;

export function GifPickerButton({ onPick, placement = "up" }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<GifHit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({
    visibility: "hidden",
  });

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
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

  // Same placement as the emoji picker: drawn over the page (portal), its
  // left edge at the button, opening to the right and kept inside the window.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const toggle = rootRef.current?.querySelector(".gif-picker-toggle");
      const panel = panelRef.current;
      if (!toggle || !panel) return;
      const rect = toggle.getBoundingClientRect();
      const width = panel.offsetWidth;
      const height = panel.offsetHeight;
      let left = rect.left;
      if (left + width > window.innerWidth - VIEWPORT_PAD) {
        left = window.innerWidth - width - VIEWPORT_PAD;
      }
      if (left < VIEWPORT_PAD) left = VIEWPORT_PAD;
      let top =
        placement === "up"
          ? rect.top - height - PANEL_GAP
          : rect.bottom + PANEL_GAP;
      if (top + height > window.innerHeight - VIEWPORT_PAD) {
        top = window.innerHeight - height - VIEWPORT_PAD;
      }
      if (top < VIEWPORT_PAD) top = VIEWPORT_PAD;
      setPanelStyle({
        position: "fixed",
        top,
        left,
        bottom: "auto",
        right: "auto",
      });
    };
    place();
    const raf = requestAnimationFrame(place);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, placement, hits.length, busy, error]);

  useEffect(() => {
    if (!open) setPanelStyle({ visibility: "hidden" });
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
      {open &&
        createPortal(
          <div
            ref={panelRef}
            className={`emoji-picker-panel gif-picker-panel is-portaled ${placement === "up" ? "up" : "down"}`}
            style={panelStyle}
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
            {!error && busy && (
              <p className="muted tiny gif-picker-status">Searching…</p>
            )}
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
          </div>,
          document.body,
        )}
    </div>
  );
}

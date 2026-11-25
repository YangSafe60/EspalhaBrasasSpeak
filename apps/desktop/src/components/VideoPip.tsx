import { useEffect, useRef, useState, type PointerEvent } from "react";
import { miniStore, useMini } from "../lib/miniStore";
import { YouTubePlayer } from "./YouTubePlayer";

/** A chat video popped out into a small floating player. */
export const videoPip = miniStore<{ videoId: string; title: string; start: number; key: number } | null>(null);

export function popOutVideo(videoId: string, title: string, start: number) {
  videoPip.set({ videoId, title, start, key: Date.now() });
}

const POS_KEY = "videoPipPos";
const EDGE = 8;
type Pos = { x: number; y: number };

function clamp(p: Pos, el: HTMLElement | null): Pos {
  const w = el?.offsetWidth ?? 400;
  const h = el?.offsetHeight ?? 260;
  return {
    x: Math.min(Math.max(EDGE, p.x), Math.max(EDGE, window.innerWidth - w - EDGE)),
    y: Math.min(Math.max(EDGE, p.y), Math.max(EDGE, window.innerHeight - h - EDGE)),
  };
}

/** Floating, draggable video (by its header) that stays while you browse. */
export function VideoPip() {
  const pip = useMini(videoPip, (v) => v);
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Pos | null>(() => {
    try {
      const v = JSON.parse(localStorage.getItem(POS_KEY) || "null");
      return v && typeof v.x === "number" ? v : null;
    } catch {
      return null;
    }
  });
  const drag = useRef<{ id: number; dx: number; dy: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const onResize = () => setPos((p) => (p ? clamp(p, box.current) : p));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  if (!pip) return null;

  function down(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    const r = box.current!.getBoundingClientRect();
    drag.current = { id: e.pointerId, dx: e.clientX - r.left, dy: e.clientY - r.top };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* pointer already gone */
    }
    setDragging(true);
    e.preventDefault();
  }

  function move(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    setPos(clamp({ x: e.clientX - d.dx, y: e.clientY - d.dy }, box.current));
  }

  function up(e: PointerEvent<HTMLDivElement>) {
    if (!drag.current || drag.current.id !== e.pointerId) return;
    drag.current = null;
    setDragging(false);
    try {
      if (pos) localStorage.setItem(POS_KEY, JSON.stringify(pos));
    } catch {
      /* ignore */
    }
  }

  return (
    <div
      ref={box}
      className={`video-pip${dragging ? " is-dragging" : ""}`}
      style={pos ? { left: pos.x, top: pos.y, right: "auto", bottom: "auto" } : undefined}
    >
      <div className="video-pip-head" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden>
          <path d="M21.6 7.2a2.6 2.6 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4a2.6 2.6 0 0 0-1.8 1.8A27 27 0 0 0 2 12a27 27 0 0 0 .4 4.8 2.6 2.6 0 0 0 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4a2.6 2.6 0 0 0 1.8-1.8A27 27 0 0 0 22 12a27 27 0 0 0-.4-4.8zM10 15V9l5.2 3L10 15z" />
        </svg>
        <span className="video-pip-title" title={pip.title}>
          {pip.title}
        </span>
        <button type="button" className="video-pip-close" aria-label="Close" title="Close" onClick={() => videoPip.set(null)}>
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      <YouTubePlayer key={pip.key} videoId={pip.videoId} title={pip.title} start={pip.start} />
    </div>
  );
}

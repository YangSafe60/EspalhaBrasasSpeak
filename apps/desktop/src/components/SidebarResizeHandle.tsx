import { useEffect, useState, type PointerEvent as ReactPointerEvent } from "react";

const STORAGE_KEY = "eb_channel_sidebar_width";
// Below this, voice rows with a limit pill and a timer have almost no room
// left for the room name.
const MIN_WIDTH = 220;
const MAX_WIDTH = 480;

function loadWidth(): number | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(n)));
  } catch {
    return null;
  }
}

function applyWidth(width: number | null) {
  const root = document.documentElement;
  if (width == null) {
    root.style.removeProperty("--channel-sidebar-width");
    return;
  }
  root.style.setProperty("--channel-sidebar-width", `${width}px`);
}

/** Drag the channel sidebar's right edge. Width is remembered on this device. */
export function SidebarResizeHandle() {
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    applyWidth(loadWidth());
  }, []);

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget;
    const column = handle.parentElement;
    const startX = e.clientX;
    const startW = column?.getBoundingClientRect().width ?? 260;
    handle.setPointerCapture(e.pointerId);
    setDragging(true);
    const prevCursor = document.body.style.cursor;
    const prevSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const move = (ev: PointerEvent) => {
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(startW + ev.clientX - startX)));
      applyWidth(next);
    };
    const end = (ev: PointerEvent) => {
      if (handle.hasPointerCapture(ev.pointerId)) {
        handle.releasePointerCapture(ev.pointerId);
      }
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevSelect;
      setDragging(false);
      const next = Math.min(
        MAX_WIDTH,
        Math.max(MIN_WIDTH, Math.round(startW + ev.clientX - startX)),
      );
      applyWidth(next);
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  }

  return (
    <div
      className={`sidebar-resize${dragging ? " is-dragging" : ""}`}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize channel list"
      onPointerDown={onPointerDown}
    />
  );
}

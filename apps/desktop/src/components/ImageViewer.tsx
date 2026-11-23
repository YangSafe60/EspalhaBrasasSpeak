import { useEffect, useRef, useState, type PointerEvent, type WheelEvent } from "react";
import { createPortal } from "react-dom";
import { downloadRemoteFile } from "../lib/downloadMedia";
import { closeImage, useViewedImage } from "../lib/imageViewer";

const MIN = 1;
const MAX = 8;
type View = { scale: number; x: number; y: number };
const FIT: View = { scale: 1, x: 0, y: 0 };

/**
 * Full-screen image viewer: click an image in the chat or a profile to open
 * it. Wheel / buttons / double-click to zoom (toward the cursor), drag to
 * move when zoomed, Download to save, Esc or a click outside to close.
 */
export function ImageViewer() {
  const img = useViewedImage();
  const stageRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>(FIT);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const drag = useRef<{ id: number; sx: number; sy: number; x: number; y: number; moved: boolean } | null>(null);

  useEffect(() => {
    setView(FIT);
    setLoaded(false);
    setFailed(false);
  }, [img?.src]);

  useEffect(() => {
    if (!img) return;
    const onKey = (e: KeyboardEvent) => {
      // Capture phase: Esc closes the viewer only, not the card behind it.
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        e.preventDefault();
        closeImage();
      } else if (e.key === "+" || e.key === "=") {
        zoomBy(1.4);
      } else if (e.key === "-") {
        zoomBy(1 / 1.4);
      } else if (e.key === "0") {
        setView(FIT);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [img]);

  if (!img) return null;

  /** Zoom by `factor`, keeping the point under (cx, cy) still. */
  function zoomAt(factor: number, cx?: number, cy?: number) {
    setView((v) => {
      const scale = Math.min(MAX, Math.max(MIN, v.scale * factor));
      if (scale === MIN) return FIT;
      const r = stageRef.current?.getBoundingClientRect();
      // Point relative to the stage centre (where the image's origin sits).
      const px = r && cx != null ? cx - (r.left + r.width / 2) : 0;
      const py = r && cy != null ? cy - (r.top + r.height / 2) : 0;
      const k = scale / v.scale;
      return { scale, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
    });
  }

  function zoomBy(factor: number) {
    zoomAt(factor);
  }

  function onWheel(e: WheelEvent) {
    zoomAt(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.clientX, e.clientY);
  }

  function onPointerDown(e: PointerEvent<HTMLImageElement>) {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, x: view.x, y: view.y, moved: false };
  }

  function onPointerMove(e: PointerEvent<HTMLImageElement>) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    if (d.moved && view.scale > 1) setView((v) => ({ ...v, x: d.x + dx, y: d.y + dy }));
  }

  function onPointerUp(e: PointerEvent<HTMLImageElement>) {
    const d = drag.current;
    drag.current = null;
    // A plain click (no drag) toggles between fit and 2.5x at that point.
    if (d && !d.moved) {
      if (view.scale > 1) setView(FIT);
      else zoomAt(2.5, e.clientX, e.clientY);
    }
  }

  async function download() {
    if (!img) return;
    setSaving(true);
    try {
      if (img.src.startsWith("blob:") || img.src.startsWith("data:")) {
        const a = document.createElement("a");
        a.href = img.src;
        a.download = img.filename || "image.png";
        document.body.appendChild(a);
        a.click();
        a.remove();
      } else {
        await downloadRemoteFile(img.src, img.filename || "image.png");
      }
    } finally {
      setSaving(false);
    }
  }

  const pct = Math.round(view.scale * 100);

  return createPortal(
    <div className="image-viewer" role="dialog" aria-modal="true" aria-label={img.filename || "Image"}>
      <div className="image-viewer-bar" onMouseDown={(e) => e.stopPropagation()}>
        <span className="image-viewer-name" title={img.filename}>
          {img.filename}
        </span>
        <div className="image-viewer-tools">
          <button type="button" onClick={() => zoomBy(1 / 1.4)} disabled={view.scale <= MIN} title="Zoom out (-)" aria-label="Zoom out">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <circle cx="11" cy="11" r="6.5" />
              <path d="M8 11h6M16 16l4 4" />
            </svg>
          </button>
          <button type="button" className="image-viewer-pct" onClick={() => setView(FIT)} title="Fit to screen (0)">
            {pct}%
          </button>
          <button type="button" onClick={() => zoomBy(1.4)} disabled={view.scale >= MAX} title="Zoom in (+)" aria-label="Zoom in">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <circle cx="11" cy="11" r="6.5" />
              <path d="M8 11h6M11 8v6M16 16l4 4" />
            </svg>
          </button>
          <span className="image-viewer-sep" />
          <button type="button" onClick={() => void download()} disabled={saving || failed} title="Download" aria-label="Download">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden>
              <path d="M12 3a1 1 0 0 1 1 1v9.59l3.3-3.3a1 1 0 1 1 1.4 1.42l-5 5a1 1 0 0 1-1.4 0l-5-5a1 1 0 1 1 1.4-1.42l3.3 3.3V4a1 1 0 0 1 1-1zM5 19a1 1 0 0 1 1-1h12a1 1 0 1 1 0 2H6a1 1 0 0 1-1-1z" />
            </svg>
          </button>
          <button type="button" onClick={closeImage} title="Close (Esc)" aria-label="Close">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
      </div>
      <div
        ref={stageRef}
        className="image-viewer-stage"
        onWheel={onWheel}
        onMouseDown={(e) => {
          // Clicking the dark area (not the picture) closes the viewer.
          e.stopPropagation();
          if (e.target === e.currentTarget) closeImage();
        }}
      >
        {!loaded && !failed && <span className="image-loading" aria-label="Loading image" />}
        {failed ? (
          <span className="image-viewer-error">Couldn't load this image</span>
        ) : (
          <img
            src={img.src}
            alt={img.filename}
            referrerPolicy="no-referrer"
            draggable={false}
            className={`image-viewer-img${view.scale > 1 ? " is-zoomed" : ""}${drag.current?.moved ? " is-dragging" : ""}${loaded ? "" : " is-loading"}`}
            style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onDoubleClick={(e) => e.preventDefault()}
          />
        )}
      </div>
    </div>,
    document.body,
  );
}

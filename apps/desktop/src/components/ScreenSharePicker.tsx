import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { listDesktopShareSources } from "../lib/screenShare";

export type ShareSource = {
  id: string;
  kind: "screen" | "window" | string;
  name: string;
  thumbnail: string;
};

type Tab = "screen" | "window";

type Props = {
  open: boolean;
  busy?: boolean;
  mode?: "new" | "add" | "replace";
  activeSourceIds?: string[];
  onClose: () => void;
  onPickSource: (
    source: ShareSource,
    opts: { systemAudio: boolean; fps: 30 | 60 },
  ) => void;
};

export function ScreenSharePicker({
  open,
  busy,
  mode = "new",
  activeSourceIds = [],
  onClose,
  onPickSource,
}: Props) {
  const [tab, setTab] = useState<Tab>("screen");
  const [sources, setSources] = useState<ShareSource[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [systemAudio, setSystemAudio] = useState(true);
  const [fps, setFps] = useState<30 | 60>(30);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeSet = useMemo(() => new Set(activeSourceIds), [activeSourceIds]);

  useEffect(() => {
    if (!open) return;
    setSelected(null);
    setError(null);
    setTab("screen");
    setSystemAudio(true);
    setFps(30);
    setSources([]);
    setLoading(true);

    let cancelled = false;
    void (async () => {
      try {
        const list = await listDesktopShareSources({
          types: ["screen", "window"],
        });
        if (cancelled) return;
        setSources(Array.isArray(list) ? list : []);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Could not list screens");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  const filtered = useMemo(
    () => sources.filter((s) => s.kind === tab),
    [sources, tab],
  );

  if (!open) return null;

  function confirm() {
    const src = sources.find((s) => s.id === selected);
    if (!src || busy) return;
    onPickSource(src, { systemAudio, fps });
  }

  return createPortal(
    <div className="modal-backdrop share-picker-backdrop" onClick={onClose}>
      <div
        className="modal share-picker-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Share your screen"
      >
        <header className="modal-header">
          <div>
            <h3>
              {mode === "replace"
                ? "Change Screen Share"
                : mode === "add"
                  ? "Share Another Screen"
                  : "Share Your Screen"}
            </h3>
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </header>

        <div className="share-tabs">
          <button
            type="button"
            className={tab === "screen" ? "active" : ""}
            onClick={() => setTab("screen")}
          >
            Screens
          </button>
          <button
            type="button"
            className={tab === "window" ? "active" : ""}
            onClick={() => setTab("window")}
          >
            Windows
          </button>
        </div>

        {loading ? (
          <p className="muted share-loading">Scanning displays…</p>
        ) : error ? (
          <p className="form-error">{error}</p>
        ) : (
          <div className="share-grid">
            {filtered.length === 0 && (
              <p className="muted">
                No {tab === "screen" ? "screens" : "windows"} found.
              </p>
            )}
            {filtered.map((s) => {
              const live = activeSet.has(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  className={`share-card${selected === s.id ? " selected" : ""}${live ? " is-live" : ""}`}
                  onClick={() => setSelected(s.id)}
                  onDoubleClick={() => {
                    if (busy) return;
                    setSelected(s.id);
                    onPickSource(s, { systemAudio, fps });
                  }}
                >
                  <div className="share-thumb">
                    {s.thumbnail ? (
                      <img src={s.thumbnail} alt="" draggable={false} />
                    ) : (
                      <span className="share-thumb-fallback">No preview</span>
                    )}
                    {live && <span className="share-live-badge">Live</span>}
                  </div>
                  <span className="share-card-name" title={s.name}>
                    {s.name}
                    {live ? " (restart)" : ""}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <div className="share-options">
          <div className="share-fps" role="group" aria-label="Frame rate">
            <span className="share-options-label">Frame rate</span>
            <div className="share-fps-toggle">
              <button
                type="button"
                className={fps === 30 ? "active" : ""}
                disabled={busy}
                onClick={() => setFps(30)}
              >
                30 FPS
              </button>
              <button
                type="button"
                className={fps === 60 ? "active" : ""}
                disabled={busy}
                onClick={() => setFps(60)}
              >
                60 FPS
              </button>
            </div>
          </div>
          <label className="share-audio-toggle">
            <span>Share system audio</span>
            <input
              type="checkbox"
              checked={systemAudio}
              onChange={(e) => setSystemAudio(e.target.checked)}
              disabled={busy}
            />
          </label>
        </div>

        <footer className="share-picker-footer">
          <button
            type="button"
            className="btn ghost"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={busy || !selected}
            onClick={confirm}
          >
            {busy
              ? "Starting…"
              : selected && activeSet.has(selected)
                ? "Restart"
                : mode === "replace"
                  ? "Switch"
                  : mode === "add"
                    ? "Add share"
                    : "Go Live"}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

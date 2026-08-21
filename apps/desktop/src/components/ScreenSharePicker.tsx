import { useEffect, useMemo, useState } from "react";

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
  onClose: () => void;
  onPickSource: (source: ShareSource) => void;
};

export function ScreenSharePicker({
  open,
  busy,
  onClose,
  onPickSource,
}: Props) {
  const [tab, setTab] = useState<Tab>("screen");
  const [sources, setSources] = useState<ShareSource[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSelected(null);
    setError(null);
    setTab("screen");
    setSources([]);
    setLoading(true);

    let cancelled = false;
    void (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const list = await invoke<ShareSource[]>("list_share_sources");
        if (cancelled) return;
        setSources(Array.isArray(list) ? list : []);
      } catch (e) {
        if (cancelled) return;
        const msg =
          e instanceof Error
            ? e.message
            : typeof e === "string"
              ? e
              : "Could not list screens. Restart the desktop app (not the browser).";
        setError(msg);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open]);

  const filtered = useMemo(
    () => sources.filter((s) => s.kind === tab),
    [sources, tab],
  );

  if (!open) return null;

  function confirm() {
    const src = sources.find((s) => s.id === selected);
    if (!src || busy) return;
    onPickSource(src);
  }

  return (
    <div className="modal-backdrop share-picker-backdrop" onClick={onClose}>
      <div
        className="modal share-picker-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Share your screen"
      >
        <header className="modal-header">
          <div>
            <h3>Share Your Screen</h3>
            <p className="muted tiny">Pick a screen or window to go live</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
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
          <div className="stack share-browser-fallback">
            <p className="form-error">{error}</p>
            <p className="muted tiny">
              Close any <code>localhost</code> browser tab. Use the native window
              titled <strong>Espalha Brasas</strong> from <code>npm run desktop</code>.
            </p>
          </div>
        ) : (
          <div className="share-grid">
            {filtered.length === 0 && (
              <p className="muted">
                No {tab === "screen" ? "screens" : "windows"} found.
              </p>
            )}
            {filtered.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`share-card${selected === s.id ? " selected" : ""}`}
                onClick={() => setSelected(s.id)}
                onDoubleClick={() => {
                  if (busy) return;
                  setSelected(s.id);
                  onPickSource(s);
                }}
              >
                <div className="share-thumb">
                  {s.thumbnail ? (
                    <img src={s.thumbnail} alt="" />
                  ) : (
                    <span className="share-thumb-fallback">
                      {s.kind === "screen" ? "Screen" : "Window"}
                    </span>
                  )}
                </div>
                <span className="share-card-name">{s.name}</span>
              </button>
            ))}
          </div>
        )}

        <footer className="share-picker-footer">
          <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={busy || !selected}
            onClick={confirm}
          >
            {busy ? "Starting…" : "Go Live"}
          </button>
        </footer>
      </div>
    </div>
  );
}

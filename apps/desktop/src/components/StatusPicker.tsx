import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PRESENCE_OPTIONS, presenceLabel } from "../lib/presence";
import { useAppStore } from "../store/appStore";
import type { PresenceStatus } from "../types";

type Props = {
  /** Extra class on the trigger button. */
  className?: string;
};

export function StatusPicker({ className }: Props) {
  const myStatus = useAppStore((s) => s.myStatus);
  const setMyStatus = useAppStore((s) => s.setMyStatus);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ bottom: number; left: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !rootRef.current) {
      setPos(null);
      return;
    }
    const rect = rootRef.current.getBoundingClientRect();
    const menuWidth = 220;
    const left = Math.min(
      Math.max(8, rect.left),
      window.innerWidth - menuWidth - 8,
    );
    setPos({
      bottom: Math.max(8, window.innerHeight - rect.top + 6),
      left,
    });
  }, [open]);

  async function pick(status: PresenceStatus) {
    if (busy) return;
    if (status === myStatus) {
      setOpen(false);
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await setMyStatus(status);
      setOpen(false);
    } catch (error) {
      setErr(
        error instanceof Error ? error.message : "Could not update status",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={`status-picker-root${className ? ` ${className}` : ""}`}
      ref={rootRef}
    >
      <button
        type="button"
        className={`status-picker-trigger status-${myStatus}`}
        title={`Status: ${presenceLabel(myStatus)}`}
        aria-label={`Status: ${presenceLabel(myStatus)}`}
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={busy}
        onClick={(e) => {
          e.stopPropagation();
          setErr(null);
          setOpen((v) => !v);
        }}
      >
        <span className={`status-dot status-${myStatus}`} />
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            className="status-picker-menu"
            style={{ bottom: pos.bottom, left: pos.left }}
            role="menu"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <p className="status-picker-heading">Set status</p>
            {PRESENCE_OPTIONS.map((opt) => (
              <button
                key={opt.status}
                type="button"
                role="menuitem"
                className={`status-picker-item${myStatus === opt.status ? " active" : ""}`}
                disabled={busy}
                onClick={(e) => {
                  e.stopPropagation();
                  void pick(opt.status);
                }}
              >
                <span className={`status-dot status-${opt.status}`} />
                <span className="status-picker-text">
                  <strong>{opt.label}</strong>
                  <em>{opt.description}</em>
                </span>
              </button>
            ))}
            {err && <p className="form-error status-picker-error">{err}</p>}
          </div>,
          document.body,
        )}
    </div>
  );
}

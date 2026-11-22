import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

/**
 * A dropdown in the app's style (same list look as the game picker),
 * instead of the browser's native <select>. Arrow keys, Enter, Esc work.
 * The list floats above everything (portal), so scrolling panels and
 * dialogs never clip it; it opens upwards when there's no room below.
 */
export function AppSelect<T extends string | number>({
  label,
  ariaLabel,
  value,
  options,
  onChange,
  className,
}: {
  /** Shown above the button (omit when the row already says what it is). */
  label?: string;
  /** Accessible name when there's no visible label. */
  ariaLabel?: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const [pos, setPos] = useState<CSSProperties | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const current = options.find((o) => o.value === value);

  // Place the list under the button (or above it when there's no room).
  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const wanted = Math.min(260, options.length * 36 + 12);
    const below = window.innerHeight - r.bottom - 8;
    const up = below < wanted && r.top > below;
    setPos({
      position: "fixed",
      left: r.left,
      width: r.width,
      maxHeight: Math.max(120, Math.min(260, (up ? r.top : below) - 8)),
      ...(up
        ? { top: "auto", bottom: window.innerHeight - r.top + 4 }
        : { top: r.bottom + 4, bottom: "auto" }),
    });
  }, [open, options.length]);

  useEffect(() => {
    if (!open) return;
    setHi(Math.max(0, options.findIndex((o) => o.value === value)));
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!rootRef.current?.contains(t) && !listRef.current?.contains(t)) setOpen(false);
    };
    // The list is fixed on screen: close it when anything behind it scrolls.
    const onScroll = (e: Event) => {
      if (!listRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onResize = () => setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Keep the highlighted row visible while moving with the keys.
  useEffect(() => {
    if (open) listRef.current?.children[hi]?.scrollIntoView({ block: "nearest" });
  }, [hi, open, pos]);

  function pick(v: T) {
    onChange(v);
    setOpen(false);
    btnRef.current?.focus();
  }

  return (
    <div className={`game-picker app-select${className ? ` ${className}` : ""}`} ref={rootRef}>
      {label && <span className="app-select-label">{label}</span>}
      <button
        ref={btnRef}
        type="button"
        className={`app-select-btn${open ? " is-open" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label ?? ariaLabel ?? ""}: ${current?.label ?? ""}`}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            if (!open) {
              setOpen(true);
              return;
            }
            setHi((i) => (i + (e.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
          } else if (e.key === "Enter" && open) {
            e.preventDefault();
            pick(options[hi].value);
          } else if (e.key === "Escape" && open) {
            e.stopPropagation();
            setOpen(false);
          }
        }}
      >
        <span className="app-select-value">{current?.label}</span>
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden fill="currentColor">
          <path d="M7 10l5 5 5-5z" />
        </svg>
      </button>
      {open &&
        pos &&
        createPortal(
          <ul className="game-picker-list app-select-list" role="listbox" ref={listRef} style={pos}>
            {options.map((o, i) => (
              <li
                key={String(o.value)}
                role="option"
                aria-selected={o.value === value}
                className={`${i === hi ? "is-active" : ""}${o.value === value ? " is-selected" : ""}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(o.value);
                }}
                onMouseEnter={() => setHi(i)}
              >
                {o.label}
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </div>
  );
}

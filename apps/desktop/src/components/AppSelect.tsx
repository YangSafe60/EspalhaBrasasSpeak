import { useEffect, useRef, useState } from "react";

/**
 * A dropdown in the app's style (same list look as the game picker),
 * instead of the browser's native <select>. Arrow keys, Enter, Esc work.
 */
export function AppSelect<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const current = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    setHi(Math.max(0, options.findIndex((o) => o.value === value)));
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Keep the highlighted row visible while moving with the keys.
  useEffect(() => {
    if (open) listRef.current?.children[hi]?.scrollIntoView({ block: "nearest" });
  }, [hi, open]);

  function pick(v: T) {
    onChange(v);
    setOpen(false);
  }

  return (
    <div className="game-picker app-select" ref={rootRef}>
      <span className="app-select-label">{label}</span>
      <button
        type="button"
        className={`app-select-btn${open ? " is-open" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${current?.label ?? ""}`}
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
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      >
        <span>{current?.label}</span>
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden fill="currentColor">
          <path d="M7 10l5 5 5-5z" />
        </svg>
      </button>
      {open && (
        <ul className="game-picker-list" role="listbox" ref={listRef}>
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
        </ul>
      )}
    </div>
  );
}

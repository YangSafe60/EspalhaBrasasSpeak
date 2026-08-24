import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type ContextMenuItem = {
  label: string;
  danger?: boolean;
  disabled?: boolean;
  /** Nested flyout (e.g. Mute Channel durations). */
  children?: ContextMenuItem[];
  onClick?: () => void;
};

type Props = {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
};

export function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [openSub, setOpenSub] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [onClose]);

  useEffect(() => {
    setOpenSub(null);
  }, [x, y, items]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let left = x;
    let top = y;
    if (left + rect.width > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - rect.width - 8);
    }
    if (top + rect.height > window.innerHeight - 8) {
      top = Math.max(8, window.innerHeight - rect.height - 8);
    }
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }, [x, y, items.length, openSub]);

  return createPortal(
    <div
      ref={ref}
      className="ctx-menu"
      style={{ left: x, top: y }}
      role="menu"
    >
      {items.map((item) => {
        const hasKids = Boolean(item.children?.length);
        const subOpen = openSub === item.label;
        return (
          <div
            key={item.label}
            className="ctx-menu-item-wrap"
            onMouseEnter={() => {
              if (hasKids) setOpenSub(item.label);
              else setOpenSub(null);
            }}
          >
            <button
              type="button"
              role="menuitem"
              className={`ctx-menu-item${item.danger ? " danger" : ""}${hasKids ? " has-sub" : ""}`}
              disabled={item.disabled}
              onClick={() => {
                if (item.disabled) return;
                if (hasKids) {
                  setOpenSub((v) => (v === item.label ? null : item.label));
                  return;
                }
                item.onClick?.();
                onClose();
              }}
            >
              <span>{item.label}</span>
              {hasKids && <span className="ctx-menu-caret">▸</span>}
            </button>
            {hasKids && subOpen && item.children && (
              <div className="ctx-menu-sub" role="menu">
                {item.children.map((child) => (
                  <button
                    key={child.label}
                    type="button"
                    role="menuitem"
                    className={`ctx-menu-item${child.danger ? " danger" : ""}`}
                    disabled={child.disabled}
                    onClick={() => {
                      if (child.disabled) return;
                      child.onClick?.();
                      onClose();
                    }}
                  >
                    {child.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>,
    document.body,
  );
}

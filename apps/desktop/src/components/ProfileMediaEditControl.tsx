import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

type MediaKind = "avatar" | "banner";

function PencilIcon() {
  return (
    <svg
      className="profile-media-edit-icon"
      viewBox="0 0 24 24"
      width="22"
      height="22"
      aria-hidden
    >
      <path
        fill="currentColor"
        d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1.003 1.003 0 0 0 0-1.42l-2.34-2.34a1.003 1.003 0 0 0-1.42 0l-1.83 1.83 3.75 3.75 1.84-1.82z"
      />
    </svg>
  );
}

export function ProfileMediaEditControl({
  kind,
  disabled,
  hasMedia,
  onChange,
  onRemove,
  className,
  style,
  children,
}: {
  kind: MediaKind;
  disabled?: boolean;
  hasMedia: boolean;
  onChange: () => void;
  onRemove: () => void;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const changeLabel = kind === "avatar" ? "Change Avatar" : "Change Banner";
  const removeLabel = kind === "avatar" ? "Remove Avatar" : "Remove Banner";

  const close = useCallback(() => setMenu(null), []);

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const onDown = (e: globalThis.MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        close();
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [menu, close]);

  useLayoutEffect(() => {
    if (!menu) return;
    const el = panelRef.current;
    if (!el) return;
    const pad = 8;
    const rect = el.getBoundingClientRect();
    let left = menu.x;
    let top = menu.y;
    if (left + rect.width > window.innerWidth - pad) {
      left = Math.max(pad, window.innerWidth - rect.width - pad);
    }
    if (top + rect.height > window.innerHeight - pad) {
      top = Math.max(pad, window.innerHeight - rect.height - pad);
    }
    if (left < pad) left = pad;
    if (top < pad) top = pad;
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }, [menu]);

  return (
    <>
      <button
        type="button"
        className={className}
        style={style}
        disabled={disabled}
        onClick={(e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
        aria-haspopup="menu"
        aria-expanded={menu != null}
        aria-label={changeLabel}
      >
        {children}
        <span className="profile-media-edit-overlay" aria-hidden>
          <PencilIcon />
        </span>
      </button>
      {menu &&
        createPortal(
          <div
            ref={panelRef}
            className="ctx-menu profile-media-menu"
            style={{ left: menu.x, top: menu.y }}
            role="menu"
          >
            <button
              type="button"
              className="ctx-menu-item"
              role="menuitem"
              onClick={() => {
                close();
                onChange();
              }}
            >
              {changeLabel}
            </button>
            {hasMedia && (
              <button
                type="button"
                className="ctx-menu-item danger"
                role="menuitem"
                onClick={() => {
                  close();
                  onRemove();
                }}
              >
                {removeLabel}
              </button>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}

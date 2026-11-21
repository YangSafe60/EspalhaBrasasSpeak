import { useState } from "react";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";

/** Reply arrow for the message hover bar. */
export function ReplyIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden fill="currentColor">
      <path d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z" />
    </svg>
  );
}

/**
 * "…" button on the message hover bar: the less common actions (edit, pin,
 * delete) live in its menu. `onOpenChange` keeps the bar visible while the
 * menu is open, even when the pointer moves to the menu.
 */
export function MessageMoreMenu({
  items,
  onOpenChange,
}: {
  items: ContextMenuItem[];
  onOpenChange?: (open: boolean) => void;
}) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  if (items.length === 0) return null;
  const close = () => {
    setAt(null);
    onOpenChange?.(false);
  };
  return (
    <>
      <button
        type="button"
        className={`msg-action msg-action-icon${at ? " active" : ""}`}
        title="More"
        aria-label="More"
        aria-haspopup="menu"
        aria-expanded={Boolean(at)}
        onMouseDown={(e) => {
          // Clicking the button while open: let the menu's outside-click close it.
          if (at) e.stopPropagation();
        }}
        onClick={(e) => {
          if (at) {
            close();
            return;
          }
          const r = e.currentTarget.getBoundingClientRect();
          setAt({ x: r.right - 180, y: r.bottom + 4 });
          onOpenChange?.(true);
        }}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden fill="currentColor">
          <circle cx="5" cy="12" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="19" cy="12" r="2" />
        </svg>
      </button>
      {at && (
        <ContextMenu
          x={at.x}
          y={at.y}
          items={items}
          onClose={close}
        />
      )}
    </>
  );
}

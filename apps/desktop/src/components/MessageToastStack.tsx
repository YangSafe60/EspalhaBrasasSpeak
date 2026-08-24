import { useEffect } from "react";
import { createPortal } from "react-dom";
import { mediaUrl } from "../lib/mediaUrl";
import { useAppStore } from "../store/appStore";
import type { MessageToast } from "../types";

const TOAST_TTL_MS = 7000;

function ToastItem({
  toast,
  onOpen,
  onDismiss,
}: {
  toast: MessageToast;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  useEffect(() => {
    const timer = window.setTimeout(onDismiss, TOAST_TTL_MS);
    return () => window.clearTimeout(timer);
  }, [onDismiss]);

  const initial = (
    toast.authorName.charAt(0) ||
    toast.channelName?.charAt(0) ||
    "?"
  ).toUpperCase();

  return (
    <button
      type="button"
      className="message-toast"
      onClick={onOpen}
      aria-label={`Open message from ${toast.authorName}`}
    >
      <span className="message-toast-avatar" aria-hidden>
        {toast.authorAvatar ? (
          <img src={mediaUrl(toast.authorAvatar)} alt="" referrerPolicy="no-referrer" />
        ) : (
          initial
        )}
      </span>
      <span className="message-toast-body">
        <span className="message-toast-meta">
          <strong>{toast.authorName}</strong>
          {toast.channelName ? (
            <em>
              {toast.kind === "dm" ? "DM" : `#${toast.channelName}`}
            </em>
          ) : null}
        </span>
        <span className="message-toast-preview">{toast.preview}</span>
      </span>
      <span
        role="button"
        tabIndex={-1}
        className="message-toast-close"
        aria-label="Dismiss"
        onClick={(e) => {
          e.stopPropagation();
          onDismiss();
        }}
      >
        ×
      </span>
    </button>
  );
}

export function MessageToastStack() {
  const toasts = useAppStore((s) => s.messageToasts);
  const dismissMessageToast = useAppStore((s) => s.dismissMessageToast);
  const openMessageToast = useAppStore((s) => s.openMessageToast);

  if (!toasts.length) return null;

  return createPortal(
    <div className="message-toast-stack" aria-live="polite" aria-relevant="additions">
      {toasts.map((toast) => (
        <ToastItem
          key={toast.id}
          toast={toast}
          onOpen={() => void openMessageToast(toast.id)}
          onDismiss={() => dismissMessageToast(toast.id)}
        />
      ))}
    </div>,
    document.body,
  );
}

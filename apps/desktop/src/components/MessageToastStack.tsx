import { useEffect } from "react";
import { createPortal } from "react-dom";
import logoMark from "../assets/logo-mark.png";
import { mediaUrl } from "../lib/mediaUrl";
import { APP_NAME, toastContextLabel } from "../lib/notifyFormat";
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

  const context = toastContextLabel(toast);

  return (
    <article
      className="message-toast"
      data-kind={toast.kind}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      aria-label={`Abrir mensagem de ${toast.authorName}`}
    >
      <span className="message-toast-accent" aria-hidden />
      <header className="message-toast-head">
        <img
          src={logoMark}
          alt=""
          className="message-toast-brand"
          width={18}
          height={18}
        />
        <span className="message-toast-app">{APP_NAME}</span>
        <span className="message-toast-context">{context}</span>
        <button
          type="button"
          className="message-toast-close"
          aria-label="Fechar"
          onClick={(e) => {
            e.stopPropagation();
            onDismiss();
          }}
        >
          ×
        </button>
      </header>
      <div className="message-toast-content">
        <span className="message-toast-avatar" aria-hidden>
          {toast.authorAvatar ? (
            <img
              src={mediaUrl(toast.authorAvatar)}
              alt=""
              referrerPolicy="no-referrer"
            />
          ) : (
            initial
          )}
        </span>
        <div className="message-toast-body">
          <strong className="message-toast-author">{toast.authorName}</strong>
          <p className="message-toast-preview">{toast.preview}</p>
        </div>
      </div>
      <span
        className="message-toast-progress"
        style={{ animationDuration: `${TOAST_TTL_MS}ms` }}
        aria-hidden
      />
    </article>
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

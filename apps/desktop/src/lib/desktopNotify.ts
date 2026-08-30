import { isAppFocused } from "./appFocus";
import { formatOsNotification } from "./notifyFormat";
import type { MessageToast } from "../types";

const clickHandlers = new Map<string, () => void>();
let clickListenerInstalled = false;

function notifyIconUrl(): string {
  if (typeof window === "undefined") return "/icon-192.png";
  return new URL("/icon-192.png", window.location.origin).href;
}

function ensureElectronClickListener(): void {
  if (clickListenerInstalled) return;
  const api = window.electronAPI;
  if (!api?.onNotificationClick) return;
  clickListenerInstalled = true;
  api.onNotificationClick(({ tag }) => {
    if (!tag) return;
    const handler = clickHandlers.get(tag);
    if (!handler) return;
    clickHandlers.delete(tag);
    handler();
  });
}

/** Show a native OS notification when the app is in the background. */
export function showDesktopNotification(opts: {
  toast: Pick<MessageToast, "kind" | "authorName" | "channelName" | "preview">;
  tag?: string;
  onClick?: () => void;
}): void {
  if (isAppFocused()) return;

  const { title, body } = formatOsNotification(opts.toast);
  const tag = opts.tag;

  if (tag && opts.onClick) {
    clickHandlers.set(tag, opts.onClick);
  }

  const api = window.electronAPI;
  if (api?.showNotification) {
    ensureElectronClickListener();
    void api.showNotification({ title, body, tag, silent: true });
    return;
  }

  if (typeof Notification === "undefined") return;
  if (Notification.permission === "denied") return;

  const show = () => {
    try {
      const n = new Notification(title, {
        body,
        tag,
        icon: notifyIconUrl(),
        silent: true,
      });
      n.onclick = () => {
        n.close();
        window.focus();
        if (tag) {
          const handler = clickHandlers.get(tag);
          if (handler) {
            clickHandlers.delete(tag);
            handler();
            return;
          }
        }
        opts.onClick?.();
      };
    } catch {
      /* unsupported */
    }
  };

  if (Notification.permission === "granted") {
    show();
    return;
  }
  if (Notification.permission === "default") {
    void Notification.requestPermission().then((p) => {
      if (p === "granted") show();
    });
  }
}

/** Ask once at startup (non-blocking). */
export function requestDesktopNotifyPermission(): void {
  if (window.electronAPI?.showNotification) return;
  if (typeof Notification === "undefined") return;
  if (Notification.permission !== "default") return;
  void Notification.requestPermission();
}

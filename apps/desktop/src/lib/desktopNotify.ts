import { isAppFocused } from "./appFocus";
import { mediaUrl } from "./mediaUrl";
import { APP_NAME, toastContextLabel } from "./notifyFormat";
import type { MessageToast } from "../types";

const clickHandlers = new Map<string, () => void>();
let clickListenerInstalled = false;

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

/** Show a custom Discord-style popup when the app is in the background. */
export function showDesktopNotification(opts: {
  toast: Pick<
    MessageToast,
    "kind" | "authorName" | "authorAvatar" | "channelName" | "preview"
  >;
  tag?: string;
  onClick?: () => void;
}): void {
  if (isAppFocused()) return;

  const tag = opts.tag;

  if (tag && opts.onClick) {
    clickHandlers.set(tag, opts.onClick);
  }

  const api = window.electronAPI;
  if (api?.showNotification) {
    ensureElectronClickListener();
    void api.showNotification({
      tag,
      appName: APP_NAME,
      authorName: opts.toast.authorName,
      authorAvatar: opts.toast.authorAvatar
        ? mediaUrl(opts.toast.authorAvatar)
        : null,
      context: toastContextLabel(opts.toast),
      preview: opts.toast.preview,
    });
    return;
  }

  if (typeof Notification === "undefined") return;
  if (Notification.permission === "denied") return;

  const title = opts.toast.authorName;
  const body = `${toastContextLabel(opts.toast)} — ${opts.toast.preview}`;

  const show = () => {
    try {
      const n = new Notification(APP_NAME, {
        body: `${title}\n${body}`,
        tag,
        icon: new URL("/icon-192.png", window.location.origin).href,
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

import { isAppFocused } from "./appFocus";

/** Show a native OS notification when the app is in the background. */
export function showDesktopNotification(opts: {
  title: string;
  body: string;
  tag?: string;
  onClick?: () => void;
}): void {
  if (isAppFocused()) return;
  if (typeof Notification === "undefined") return;
  if (Notification.permission === "denied") return;

  const show = () => {
    try {
      const n = new Notification(opts.title, {
        body: opts.body,
        tag: opts.tag,
        silent: true,
      });
      n.onclick = () => {
        n.close();
        window.focus();
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
  if (typeof Notification === "undefined") return;
  if (Notification.permission !== "default") return;
  void Notification.requestPermission();
}

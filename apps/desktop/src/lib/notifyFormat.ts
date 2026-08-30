import type { MessageToast } from "../types";

const APP_NAME = "Espalha Brasas";

export function toastContextLabel(
  toast: Pick<MessageToast, "kind" | "channelName">,
): string {
  if (toast.kind === "dm") return "Mensagem direta";
  if (toast.kind === "friend") return toast.channelName || "Pedido de amizade";
  if (toast.channelName) return `#${toast.channelName}`;
  return "Nova mensagem";
}

/** Branded title/body for native OS notifications. */
export function formatOsNotification(
  toast: Pick<MessageToast, "kind" | "authorName" | "channelName" | "preview">,
): { title: string; body: string } {
  const context = toastContextLabel(toast);
  return {
    title: APP_NAME,
    body: `${toast.authorName} · ${context}\n${toast.preview}`,
  };
}

export { APP_NAME };

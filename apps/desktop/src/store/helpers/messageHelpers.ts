import type { Message, DmMessage } from "../../types";

const MESSAGE_CAP = 80;

/** Insert or update a channel message, keeping a bounded in-memory window. */
export function upsertMessage(list: Message[], message: Message): Message[] {
  const idx = list.findIndex((m) => m.id === message.id);
  let next: Message[];
  if (idx >= 0) {
    next = list.slice();
    next[idx] = message;
  } else {
    next = [...list, message].sort(
      (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
  }
  return next.length > MESSAGE_CAP ? next.slice(next.length - MESSAGE_CAP) : next;
}

/** Guess MIME type from a file extension for attachment previews. */
export function guessContentType(name: string): string | null {
  const ext = name.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "bmp":
      return "image/bmp";
    case "svg":
      return "image/svg+xml";
    default:
      return null;
  }
}

/** Insert or update a DM message, keeping a bounded in-memory window. */
export function upsertDm(list: DmMessage[], message: DmMessage): DmMessage[] {
  const idx = list.findIndex((m) => m.id === message.id);
  let next: DmMessage[];
  if (idx >= 0) {
    next = list.slice();
    next[idx] = message;
  } else {
    next = [...list, message].sort(
      (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
  }
  return next.length > MESSAGE_CAP ? next.slice(next.length - MESSAGE_CAP) : next;
}

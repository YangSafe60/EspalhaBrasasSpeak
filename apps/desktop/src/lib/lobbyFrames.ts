import { jpegBytes } from "./jpegRelay";

type Listener = (url: string) => void;

const listeners = new Map<string, Set<Listener>>();
const urls = new Map<string, string>();

/** Paint a lobby/pop-out JPEG without putting the bytes in React state. */
export function applyLobbyJpeg(
  trackSid: string,
  jpeg: ArrayBuffer | Uint8Array,
): void {
  // No tile is showing this live: don't build a Blob + URL per frame.
  if (!listeners.has(trackSid)) {
    dropLobbyFrame(trackSid);
    return;
  }
  const next = URL.createObjectURL(
    new Blob([jpegBytes(jpeg)], { type: "image/jpeg" }),
  );
  const prev = urls.get(trackSid);
  urls.set(trackSid, next);
  if (prev) URL.revokeObjectURL(prev);
  const set = listeners.get(trackSid);
  if (!set) return;
  for (const fn of set) fn(next);
}

export function subscribeLobbyFrame(
  trackSid: string,
  fn: Listener,
): () => void {
  let set = listeners.get(trackSid);
  if (!set) {
    set = new Set();
    listeners.set(trackSid, set);
  }
  set.add(fn);
  const current = urls.get(trackSid);
  if (current) fn(current);
  return () => {
    set.delete(fn);
    if (set.size === 0) listeners.delete(trackSid);
  };
}

export function dropLobbyFrame(trackSid: string): void {
  const prev = urls.get(trackSid);
  if (prev) URL.revokeObjectURL(prev);
  urls.delete(trackSid);
}

export function clearLobbyFrames(): void {
  for (const url of urls.values()) URL.revokeObjectURL(url);
  urls.clear();
}

import { useSyncExternalStore } from "react";

/** An image shown full screen by <ImageViewer />. */
export type ViewedImage = {
  /** What the <img> loads (may be a blob: URL for decrypted images). */
  src: string;
  /** Name used when saving. */
  filename: string;
};

let current: ViewedImage | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

/** Open an image in the full-screen viewer. */
export function openImage(img: ViewedImage) {
  if (!img.src) return;
  current = img;
  emit();
}

export function closeImage() {
  current = null;
  emit();
}

export function useViewedImage(): ViewedImage | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}

/** "https://x/abc.jpg?y" -> "avatar.jpg" style names for saving. */
export function nameFromUrl(url: string, base: string): string {
  try {
    const m = /\.([a-z0-9]{2,5})$/i.exec(new URL(url, location.href).pathname);
    return `${base}.${m ? m[1].toLowerCase() : "png"}`;
  } catch {
    return `${base}.png`;
  }
}

/** Tracks whether the app window is focused and visible. */
let focused =
  typeof document !== "undefined"
    ? document.hasFocus() && document.visibilityState !== "hidden"
    : true;

const listeners = new Set<() => void>();

function refreshFocus() {
  const next =
    typeof document !== "undefined" &&
    document.hasFocus() &&
    document.visibilityState !== "hidden";
  if (next === focused) return;
  focused = next;
  for (const listener of listeners) listener();
}

if (typeof window !== "undefined") {
  window.addEventListener("focus", refreshFocus);
  window.addEventListener("blur", refreshFocus);
  document.addEventListener("visibilitychange", refreshFocus);
}

export function isAppFocused(): boolean {
  return focused;
}

export function subscribeAppFocus(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Copy text to the clipboard. Prefer the async Clipboard API, then fall back
 * to a hidden textarea + execCommand (needed in Electron / insecure contexts
 * where navigator.clipboard.writeText throws "Write permission denied").
 */
export async function copyText(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      /* fall through */
    }
  }

  if (typeof document === "undefined") {
    throw new Error("Clipboard is not available");
  }

  const el = document.createElement("textarea");
  el.value = text;
  el.setAttribute("readonly", "");
  el.style.position = "fixed";
  el.style.left = "-9999px";
  el.style.top = "0";
  el.style.opacity = "0";
  document.body.appendChild(el);
  el.focus();
  el.select();
  el.setSelectionRange(0, text.length);

  let ok = false;
  try {
    ok = document.execCommand("copy");
  } finally {
    document.body.removeChild(el);
  }

  if (!ok) {
    throw new Error("Could not copy to clipboard");
  }
}

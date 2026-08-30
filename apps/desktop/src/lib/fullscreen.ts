type FullscreenElement = Element & {
  requestFullscreen?: (options?: FullscreenOptions) => Promise<void>;
  webkitRequestFullscreen?: () => void;
};

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => void;
};

export function getFullscreenElement(): Element | null {
  const doc = document as FullscreenDocument;
  return document.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

export function isElementFullscreen(el: Element | null | undefined): boolean {
  if (!el) return false;
  const active = getFullscreenElement();
  return active === el;
}

export async function enterFullscreen(
  el: Element,
): Promise<void> {
  const target = el as FullscreenElement;
  if (target.requestFullscreen) {
    await target.requestFullscreen({ navigationUI: "hide" });
    return;
  }
  if (target.webkitRequestFullscreen) {
    target.webkitRequestFullscreen();
    return;
  }
  throw new Error("Fullscreen API unavailable");
}

export async function exitFullscreen(): Promise<void> {
  const doc = document as FullscreenDocument;
  if (document.exitFullscreen) {
    await document.exitFullscreen();
    return;
  }
  doc.webkitExitFullscreen?.();
}

export async function toggleElementFullscreen(
  el: Element | null | undefined,
): Promise<boolean> {
  if (!el) return false;
  try {
    if (isElementFullscreen(el)) {
      await exitFullscreen();
      return false;
    }
    await enterFullscreen(el);
    return true;
  } catch {
    return false;
  }
}

export function onFullscreenChange(handler: () => void): () => void {
  document.addEventListener("fullscreenchange", handler);
  document.addEventListener("webkitfullscreenchange", handler);
  return () => {
    document.removeEventListener("fullscreenchange", handler);
    document.removeEventListener("webkitfullscreenchange", handler);
  };
}

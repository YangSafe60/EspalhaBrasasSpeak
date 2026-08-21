import { LocalVideoTrack } from "livekit-client";

export function isTauriApp(): boolean {
  if (typeof window === "undefined") return false;
  const g = globalThis as typeof globalThis & {
    isTauri?: boolean;
    __TAURI_INTERNALS__?: unknown;
    __TAURI__?: unknown;
  };
  if (g.isTauri) return true;
  if (g.__TAURI_INTERNALS__) return true;
  if (g.__TAURI__) return true;
  return false;
}

/** Async probe — true if native share commands are available. */
export async function canUseNativeShare(): Promise<boolean> {
  try {
    const { invoke, isTauri } = await import("@tauri-apps/api/core");
    if (!isTauri() && !isTauriApp()) return false;
    await invoke("list_share_sources");
    return true;
  } catch {
    return false;
  }
}

export function isShareCancelError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; message?: string };
  const name = e.name || "";
  const msg = (e.message || "").toLowerCase();
  if (name === "NotAllowedError" || name === "AbortError") return true;
  if (msg.includes("permission denied") || msg.includes("not allowed")) return true;
  if (msg.includes("abort") || msg.includes("dismiss") || msg.includes("cancel")) {
    return true;
  }
  return false;
}

/**
 * Capture a MediaStreamTrack from an in-app picked screen/window via Tauri frame events.
 */
export async function startTauriScreenTrack(sourceId: string): Promise<{
  track: LocalVideoTrack;
  stop: () => Promise<void>;
}> {
  const { invoke } = await import("@tauri-apps/api/core");
  const { listen } = await import("@tauri-apps/api/event");
  type UnlistenFn = () => void;

  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unsupported");

  const img = new Image();
  let unlisten: UnlistenFn | null = null;
  let stopped = false;

  unlisten = await listen<string>("share-frame", (ev) => {
    if (stopped || !ev.payload) return;
    img.onload = () => {
      if (stopped) return;
      const iw = img.naturalWidth || 1280;
      const ih = img.naturalHeight || 720;
      if (canvas.width !== iw || canvas.height !== ih) {
        canvas.width = iw;
        canvas.height = ih;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    };
    img.src = ev.payload;
  });

  await invoke("start_share_capture", { sourceId });

  await new Promise((r) => setTimeout(r, 150));

  const stream = canvas.captureStream(15);
  const media = stream.getVideoTracks()[0];
  if (!media) {
    await invoke("stop_share_capture").catch(() => undefined);
    unlisten?.();
    throw new Error("No video track from capture");
  }
  media.contentHint = "detail";

  // userProvidedTrack=true so LiveKit won't try to reacquire via getDisplayMedia
  const track = new LocalVideoTrack(media, undefined, true);

  return {
    track,
    stop: async () => {
      stopped = true;
      unlisten?.();
      unlisten = null;
      try {
        track.stop();
      } catch {
        /* ignore */
      }
      media.stop();
      stream.getTracks().forEach((t) => t.stop());
      await invoke("stop_share_capture").catch(() => undefined);
    },
  };
}

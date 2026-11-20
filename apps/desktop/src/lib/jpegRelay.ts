/**
 * Latest-frame JPEG capture for local preview and pop-out.
 * Never queues frames: if an encode is still running, the next tick
 * keeps only the newest video frame. That avoids the old backlog delay.
 * The LiveKit publish path is separate and is not touched here.
 */

const PREVIEW_MAX_WIDTH = 1280;
const JPEG_QUALITY = 0.72;
/** Hard ceiling for any JPEG preview, whatever the caller asks for. */
const MAX_PREVIEW_FPS = 30;

export function jpegPreviewMaxWidth(): number {
  return PREVIEW_MAX_WIDTH;
}

export type PreviewProfile = { fps: number; maxWidth: number; quality: number };

/**
 * What the lobby/pop-out preview costs at each level.
 * 0 = nobody looking (relays are stopped by their owners, this is a floor),
 * 1 = lobby grid, 2 = pop-out or expanded tile.
 * The live other people receive is the WebRTC track; this is only the
 * in-app picture, so it can be cheaper than the stream itself — but at 8 fps
 * it looked laggy, which is what these values fix.
 */
export function previewProfile(level: number): PreviewProfile {
  if (level >= 2) return { fps: 30, maxWidth: 1920, quality: 0.8 };
  if (level === 1) return { fps: 24, maxWidth: PREVIEW_MAX_WIDTH, quality: JPEG_QUALITY };
  return { fps: 4, maxWidth: 640, quality: 0.6 };
}

function clampFps(fps: number): number {
  return Math.min(MAX_PREVIEW_FPS, Math.max(1, Number.isFinite(fps) ? fps : 1));
}

export function jpegBytes(data: ArrayBuffer | Uint8Array): ArrayBuffer {
  const view = data instanceof Uint8Array ? data : new Uint8Array(data);
  const copy = new ArrayBuffer(view.byteLength);
  new Uint8Array(copy).set(view);
  return copy;
}

export function startLatestJpegRelay(opts: {
  video: HTMLVideoElement;
  fps: () => number;
  /** Fixed width cap, or a getter so the cap can follow the preview level. */
  maxWidth?: number | (() => number);
  /** JPEG quality 0–1 (fixed or getter). */
  quality?: number | (() => number);
  onFrame: (jpeg: ArrayBuffer) => void;
}): { stop: () => void } {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
  if (ctx) ctx.imageSmoothingEnabled = false;

  let stopped = false;
  let encoding = false;
  let dirty = false;
  let lastStart = 0;
  let gapTimer: number | null = null;
  let pollTimer: number | null = null;

  const clearGap = () => {
    if (gapTimer != null) {
      window.clearTimeout(gapTimer);
      gapTimer = null;
    }
  };

  const encodeLatest = async () => {
    if (stopped || !ctx) return;
    if (encoding) {
      dirty = true;
      return;
    }
    const fps = clampFps(opts.fps());
    const minGap = 1000 / fps;
    const now = performance.now();
    const since = now - lastStart;
    if (lastStart > 0 && since < minGap) {
      dirty = true;
      if (gapTimer == null) {
        gapTimer = window.setTimeout(() => {
          gapTimer = null;
          if (!stopped && dirty) void encodeLatest();
        }, minGap - since);
      }
      return;
    }
    const w = opts.video.videoWidth;
    const h = opts.video.videoHeight;
    if (w <= 0 || h <= 0) return;

    const maxWidth =
      typeof opts.maxWidth === "function" ? opts.maxWidth() : opts.maxWidth;
    const cap = Math.min(w, maxWidth ?? PREVIEW_MAX_WIDTH);
    const scale = w > cap ? cap / w : 1;
    const tw = Math.max(1, Math.round(w * scale));
    const th = Math.max(1, Math.round(h * scale));
    if (canvas.width !== tw || canvas.height !== th) {
      canvas.width = tw;
      canvas.height = th;
    }
    ctx.drawImage(opts.video, 0, 0, tw, th);
    lastStart = performance.now();
    encoding = true;
    dirty = false;
    try {
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (value) => {
            if (value) resolve(value);
            else reject(new Error("jpeg encode failed"));
          },
          "image/jpeg",
          typeof opts.quality === "function"
            ? opts.quality()
            : (opts.quality ?? JPEG_QUALITY),
        );
      });
      if (!stopped) opts.onFrame(await blob.arrayBuffer());
    } catch {
      /* encoder busy or canvas detached */
    }
    encoding = false;
    if (!stopped && dirty) void encodeLatest();
  };

  const schedule = () => {
    if (stopped) return;
    // Timer, not every captured frame. The live others receive is the WebRTC
    // track; this JPEG is only the local preview.
    pollTimer = window.setTimeout(() => {
      pollTimer = null;
      void encodeLatest();
      schedule();
    }, 1000 / clampFps(opts.fps()));
  };

  void encodeLatest();
  schedule();

  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      clearGap();
      if (pollTimer != null) window.clearTimeout(pollTimer);
      canvas.width = 0;
      canvas.height = 0;
    },
  };
}

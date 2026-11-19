/**
 * Latest-frame JPEG capture for local preview and pop-out.
 * Never queues frames: if an encode is still running, the next tick
 * keeps only the newest video frame. That avoids the old backlog delay.
 * The LiveKit publish path is separate and is not touched here.
 */

const PREVIEW_MAX_WIDTH = 1280;
const JPEG_QUALITY = 0.72;

export function jpegPreviewMaxWidth(): number {
  return PREVIEW_MAX_WIDTH;
}

export function jpegBytes(data: ArrayBuffer | Uint8Array): ArrayBuffer {
  const view = data instanceof Uint8Array ? data : new Uint8Array(data);
  const copy = new ArrayBuffer(view.byteLength);
  new Uint8Array(copy).set(view);
  return copy;
}

export function startLatestJpegRelay(opts: {
  video: HTMLVideoElement;
  fps: () => 30 | 60;
  maxWidth?: number;
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
  let rVfc: number | null = null;

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
    const fps = opts.fps() === 60 ? 60 : 30;
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

    const cap = Math.min(w, opts.maxWidth ?? PREVIEW_MAX_WIDTH);
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
          JPEG_QUALITY,
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
    const video = opts.video;
    if (typeof video.requestVideoFrameCallback === "function") {
      rVfc = video.requestVideoFrameCallback(() => {
        void encodeLatest();
        schedule();
      });
      return;
    }
    pollTimer = window.setTimeout(() => {
      pollTimer = null;
      void encodeLatest();
      schedule();
    }, 1000 / (opts.fps() === 60 ? 60 : 30));
  };

  void encodeLatest();
  schedule();

  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      clearGap();
      if (pollTimer != null) window.clearTimeout(pollTimer);
      if (
        rVfc != null &&
        typeof opts.video.cancelVideoFrameCallback === "function"
      ) {
        opts.video.cancelVideoFrameCallback(rVfc);
      }
      canvas.width = 0;
      canvas.height = 0;
    },
  };
}

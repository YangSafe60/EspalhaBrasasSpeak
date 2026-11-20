import { startLatestJpegRelay } from "./jpegRelay";
import type { PreviewChunk, PreviewFrame } from "./previewFrames";

/**
 * Encodes the in-app preview of a live with WebCodecs (H.264, hardware when
 * available, else VP8). Compared with one JPEG per frame this keeps full frame
 * rate at 1080p30, never creates Blobs, and sends far fewer bytes.
 * Falls back to the JPEG relay when WebCodecs can't encode.
 */

const KEYFRAME_EVERY_SECONDS = 2;
/** Encoder backlog above which a frame is skipped instead of queued. */
const MAX_QUEUE = 2;
const BITS_PER_PIXEL = 0.08;
const MIN_BITRATE = 400_000;
const MAX_BITRATE = 8_000_000;

type Options = {
  video: HTMLVideoElement;
  fps: () => number;
  maxWidth: () => number;
  /** JPEG quality, only used by the fallback. */
  quality: () => number;
  onFrame: (frame: Omit<PreviewFrame, "trackSid" | "from">) => void;
  /**
   * Sizes to prepare up front (the other preview levels), so switching level
   * doesn't wait for a new hardware encoder.
   */
  warm?: () => { maxWidth: number; fps: number }[];
};

type Shape = { width: number; height: number; fps: number };

function even(n: number): number {
  return Math.max(2, Math.round(n / 2) * 2);
}

/** H.264 level that fits the coded area (macroblocks are 16x16). */
function avcCodec(width: number, height: number): string {
  const area = Math.ceil(width / 16) * 16 * (Math.ceil(height / 16) * 16);
  if (area <= 414_720) return "avc1.42E01E"; // 3.0
  if (area <= 921_600) return "avc1.42E01F"; // 3.1
  if (area <= 2_097_152) return "avc1.42E028"; // 4.0
  return "avc1.42E033"; // 5.1
}

async function pickConfig(shape: Shape): Promise<VideoEncoderConfig | null> {
  const base = {
    width: shape.width,
    height: shape.height,
    framerate: shape.fps,
    bitrate: Math.min(
      MAX_BITRATE,
      Math.max(MIN_BITRATE, Math.round(shape.width * shape.height * shape.fps * BITS_PER_PIXEL)),
    ),
    latencyMode: "realtime" as const,
  };
  const candidates: VideoEncoderConfig[] = [
    {
      ...base,
      codec: avcCodec(shape.width, shape.height),
      avc: { format: "annexb" },
      hardwareAcceleration: "prefer-hardware",
    },
    { ...base, codec: avcCodec(shape.width, shape.height), avc: { format: "annexb" } },
    { ...base, codec: "vp8" },
  ];
  for (const config of candidates) {
    try {
      const res = await VideoEncoder.isConfigSupported(config);
      if (res.supported) return config;
    } catch {
      /* try the next one */
    }
  }
  return null;
}

/** One configured encoder for one size. */
type Lane = {
  key: string;
  encoder: VideoEncoder;
  shape: Shape;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  wantKey: boolean;
  framesSinceKey: number;
  usedAt: number;
};

/** Encoders kept ready per live (one per preview level, plus a spare). */
const MAX_LANES = 3;

export function startPreviewEncoder(opts: Options): {
  stop: () => void;
  requestKeyFrame: () => void;
} {
  if (typeof VideoEncoder === "undefined" || typeof VideoFrame === "undefined") {
    return startJpegFallback(opts);
  }

  let stopped = false;
  /*
   * Creating or reconfiguring a hardware encoder stalls all encoding for
   * ~300 ms, which showed as a freeze each time the preview level changed.
   * So every size gets its own encoder, created once (the other levels are
   * prepared up front from `opts.warm`) and kept; switching level just feeds
   * a different, already-running encoder (measured: about one frame's gap).
   */
  const lanes = new Map<string, Lane>();
  let current: Lane | null = null;
  const creating = new Set<string>();
  const failed = new Set<string>();
  let timer: number | null = null;
  let jpeg: ReturnType<typeof startJpegFallback> | null = null;
  const keyOf = (sh: Shape) => `${sh.width}x${sh.height}@${sh.fps}`;

  const closeLane = (lane: Lane) => {
    try {
      lane.encoder.close();
    } catch {
      /* already closed */
    }
    lane.canvas.width = 0;
    lane.canvas.height = 0;
    lanes.delete(lane.key);
    if (current === lane) current = null;
  };

  const shapeFor = (maxWidth: number, fps: number): Shape | null => {
    const vw = opts.video.videoWidth;
    const vh = opts.video.videoHeight;
    if (vw <= 0 || vh <= 0) return null;
    const cap = Math.min(vw, maxWidth);
    const scale = vw > cap ? cap / vw : 1;
    return {
      width: even(vw * scale),
      height: even(vh * scale),
      fps: Math.max(1, Math.min(60, Math.round(fps))),
    };
  };

  const stopTimer = () => {
    if (timer != null) window.clearInterval(timer);
    timer = null;
  };

  const createLane = async (shape: Shape) => {
    const key = keyOf(shape);
    if (lanes.has(key) || creating.has(key) || failed.has(key)) return;
    creating.add(key);
    const picked = await pickConfig(shape);
    creating.delete(key);
    if (stopped) return;
    if (!picked) {
      failed.add(key);
      if (lanes.size === 0 && creating.size === 0 && !jpeg) {
        // No WebCodecs encoder on this machine: keep the old JPEG preview.
        stopTimer();
        jpeg = startJpegFallback(opts);
      }
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = shape.width;
    canvas.height = shape.height;
    const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
    if (!ctx) return;
    const codec = picked.codec;
    let lane: Lane | null = null;
    const encoder = new VideoEncoder({
      output: (chunk) => {
        if (stopped) return;
        const data = new ArrayBuffer(chunk.byteLength);
        chunk.copyTo(data);
        const out: PreviewChunk = {
          type: chunk.type,
          data,
          timestamp: chunk.timestamp,
          codec,
          width: shape.width,
          height: shape.height,
        };
        opts.onFrame({ chunk: out });
      },
      error: () => {
        if (lane) closeLane(lane);
      },
    });
    try {
      encoder.configure(picked);
    } catch {
      failed.add(key);
      return;
    }
    const created: Lane = {
      key,
      encoder,
      shape,
      canvas,
      ctx,
      wantKey: true,
      framesSinceKey: 0,
      usedAt: 0,
    };
    lane = created;
    lanes.set(key, created);
    // Too many sizes (the shared window was resized): drop the least used.
    while (lanes.size > MAX_LANES) {
      const oldest = [...lanes.values()]
        .filter((l) => l !== current && l !== created)
        .sort((x, y) => x.usedAt - y.usedAt)[0];
      if (!oldest) break;
      closeLane(oldest);
    }
  };

  let warmed = false;
  const warmUp = () => {
    if (warmed || !opts.warm) return;
    const shapes = opts
      .warm()
      .map((p) => shapeFor(p.maxWidth, p.fps))
      .filter((sh): sh is Shape => sh != null);
    if (shapes.length === 0) return;
    warmed = true;
    // One at a time: each hardware encoder init stalls for a moment.
    void (async () => {
      for (const sh of shapes) await createLane(sh);
    })();
  };

  const encode = (lane: Lane) => {
    const { encoder, shape, canvas, ctx } = lane;
    if (encoder.state !== "configured" || encoder.encodeQueueSize > MAX_QUEUE) return;
    ctx.drawImage(opts.video, 0, 0, shape.width, shape.height);
    const keyFrame = lane.wantKey || lane.framesSinceKey >= shape.fps * KEYFRAME_EVERY_SECONDS;
    const frame = new VideoFrame(canvas, { timestamp: Math.round(performance.now() * 1000) });
    try {
      encoder.encode(frame, { keyFrame });
      if (keyFrame) {
        lane.wantKey = false;
        lane.framesSinceKey = 0;
      } else {
        lane.framesSinceKey += 1;
      }
    } catch {
      closeLane(lane);
    } finally {
      frame.close();
    }
  };

  const tick = () => {
    if (stopped) return;
    const want = shapeFor(opts.maxWidth(), opts.fps());
    if (!want) return;
    const ready = lanes.get(keyOf(want));
    if (ready && ready !== current) {
      // Switch to the already-running encoder; it starts with a keyframe.
      ready.wantKey = true;
      current = ready;
    } else if (!ready) {
      // Not prepared (first frame, or the shared window changed size):
      // keep the current one going until the new encoder exists.
      void createLane(want);
    }
    // Prepare the other levels once the size we need now is running.
    if (current) warmUp();
    if (!current) return;
    current.usedAt = performance.now();
    encode(current);
  };

  // A fixed setInterval at the target rate gave the steadiest output in
  // measurements; it is rebuilt only when the frame rate changes.
  let intervalFps = 0;
  const schedule = () => {
    if (stopped || jpeg) return;
    const fps = Math.max(1, Math.min(60, Math.round(opts.fps())));
    if (fps !== intervalFps) {
      if (timer != null) window.clearInterval(timer);
      intervalFps = fps;
      timer = window.setInterval(() => {
        tick();
        schedule();
      }, 1000 / fps);
    }
  };

  tick();
  schedule();

  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      stopTimer();
      for (const lane of [...lanes.values()]) closeLane(lane);
      jpeg?.stop();
    },
    requestKeyFrame: () => {
      if (current) current.wantKey = true;
    },
  };
}

function startJpegFallback(opts: Options) {
  const relay = startLatestJpegRelay({
    video: opts.video,
    fps: opts.fps,
    maxWidth: opts.maxWidth,
    quality: opts.quality,
    onFrame: (jpeg) => opts.onFrame({ jpeg }),
  });
  return { stop: relay.stop, requestKeyFrame: () => undefined };
}

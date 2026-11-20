import type { PreviewChunk, PreviewFrame } from "./previewFrames";

/**
 * Turns preview messages into pictures on `<canvas>` elements, with WebCodecs
 * (`VideoDecoder` for chunks, `ImageDecoder` for legacy JPEGs). No Blobs or
 * object URLs, so frames never pile up in the main process, and every decoded
 * frame is drawn (an `<img>` swapped per frame dropped some and stuttered).
 */

/** One decoder per encoder configuration (codec + size) of a stream. */
type Lane = {
  configKey: string;
  decoder: VideoDecoder;
  /** Drop deltas until the next keyframe (fresh decoder, error, no viewer). */
  waitingKey: boolean;
  seq: number;
};

/**
 * While the publisher changes size, chunks of the old and new size arrive
 * interleaved. Each size gets its own decoder; the old picture stays up until
 * the new decoder has produced a frame, then the old decoder is closed.
 */
type Stream = { lanes: Lane[]; activeSeq: number };

type JpegState = { busy: boolean; pending: ArrayBuffer | null };

const KEY_REQUEST_THROTTLE_MS = 500;

export type PreviewHub = {
  push: (frame: PreviewFrame) => void;
  /** Draw this live into `canvas`; `onFrame` fires after each draw. */
  attach: (trackSid: string, canvas: HTMLCanvasElement, onFrame?: () => void) => () => void;
  drop: (trackSid: string) => void;
  clear: () => void;
};

export function createPreviewHub(requestKeyFrame?: (trackSid: string) => void): PreviewHub {
  const streams = new Map<string, Stream>(); // `${from}|${trackSid}`
  const jpegs = new Map<string, JpegState>();
  const sinks = new Map<string, Map<HTMLCanvasElement, (() => void) | undefined>>();
  const last = new Map<string, VideoFrame>();
  const lastKeyRequest = new Map<string, number>();

  const askKey = (trackSid: string) => {
    if (!requestKeyFrame) return;
    const now = performance.now();
    if (now - (lastKeyRequest.get(trackSid) ?? 0) < KEY_REQUEST_THROTTLE_MS) return;
    lastKeyRequest.set(trackSid, now);
    requestKeyFrame(trackSid);
  };

  const paint = (trackSid: string, frame: VideoFrame) => {
    const targets = sinks.get(trackSid);
    if (!targets || targets.size === 0) {
      frame.close();
      return;
    }
    for (const [canvas, onFrame] of targets) {
      drawFrame(canvas, frame);
      onFrame?.();
    }
    // Keep the newest frame so a tile that mounts later shows it at once.
    last.get(trackSid)?.close();
    last.set(trackSid, frame);
  };

  let laneSeq = 0;

  const closeLane = (lane: Lane) => {
    try {
      lane.decoder.close();
    } catch {
      /* already closed */
    }
  };

  const closeStream = (key: string) => {
    const s = streams.get(key);
    if (!s) return;
    for (const lane of s.lanes) closeLane(lane);
    streams.delete(key);
  };

  const pushChunk = (trackSid: string, key: string, chunk: PreviewChunk) => {
    let stream = streams.get(key);
    if (!stream) {
      stream = { lanes: [], activeSeq: -1 };
      streams.set(key, stream);
    }
    const st = stream;
    const configKey = `${chunk.codec}|${chunk.width}x${chunk.height}`;
    let lane = st.lanes.find((l) => l.configKey === configKey);
    if (lane && lane.decoder.state === "closed") {
      // Decoder died (error): rebuild it from the next keyframe.
      st.lanes = st.lanes.filter((l) => l !== lane);
      if (st.activeSeq === lane.seq) st.activeSeq = -1;
      lane = undefined;
    }
    if (!lane) {
      if (chunk.type !== "key") {
        askKey(trackSid);
        return;
      }
      const seq = ++laneSeq;
      const decoder: VideoDecoder = new VideoDecoder({
        output: (frame) => {
          if (seq > st.activeSeq) {
            // The newer size is ready: switch to it, drop the older decoders.
            st.activeSeq = seq;
            for (const old of st.lanes.filter((l) => l.seq < seq)) closeLane(old);
            st.lanes = st.lanes.filter((l) => l.seq >= seq);
          }
          if (seq !== st.activeSeq) {
            frame.close();
            return;
          }
          paint(trackSid, frame);
        },
        error: () => {
          const failed = st.lanes.find((l) => l.seq === seq);
          if (failed) failed.waitingKey = true;
          askKey(trackSid);
        },
      });
      try {
        decoder.configure({
          codec: chunk.codec,
          codedWidth: chunk.width,
          codedHeight: chunk.height,
          optimizeForLatency: true,
        });
      } catch {
        askKey(trackSid);
        return;
      }
      lane = { configKey, decoder, waitingKey: true, seq };
      st.lanes.push(lane);
      // At most an old and a new size at once.
      while (st.lanes.length > 2) {
        const dropped = st.lanes.shift();
        if (dropped) closeLane(dropped);
      }
    }
    // A lane older than the picture on screen is no longer needed.
    if (lane.seq < st.activeSeq) return;
    if (chunk.type === "key") lane.waitingKey = false;
    if (lane.waitingKey || lane.decoder.state !== "configured") {
      askKey(trackSid);
      return;
    }
    // Decoder falling behind (e.g. a busy window): wait for a fresh keyframe.
    if (lane.decoder.decodeQueueSize > 8) {
      lane.waitingKey = true;
      askKey(trackSid);
      return;
    }
    try {
      lane.decoder.decode(
        new EncodedVideoChunk({ type: chunk.type, timestamp: chunk.timestamp, data: chunk.data }),
      );
    } catch {
      lane.waitingKey = true;
      askKey(trackSid);
    }
  };

  const pushJpeg = (trackSid: string, key: string, data: ArrayBuffer) => {
    if (typeof ImageDecoder === "undefined") return;
    let state = jpegs.get(key);
    if (!state) {
      state = { busy: false, pending: null };
      jpegs.set(key, state);
    }
    const st = state;
    // Only the newest JPEG matters; skip ones that arrive while decoding.
    if (st.busy) {
      st.pending = data;
      return;
    }
    const run = async (bytes: ArrayBuffer) => {
      st.busy = true;
      try {
        const dec = new ImageDecoder({ data: bytes, type: "image/jpeg" });
        const { image } = await dec.decode();
        dec.close();
        paint(trackSid, image);
      } catch {
        /* corrupt frame: wait for the next one */
      }
      st.busy = false;
      if (st.pending) {
        const next = st.pending;
        st.pending = null;
        void run(next);
      }
    };
    void run(data);
  };

  return {
    push: (frame) => {
      const { trackSid } = frame;
      const key = `${frame.from ?? "ipc"}|${trackSid}`;
      const watched = (sinks.get(trackSid)?.size ?? 0) > 0;
      if (frame.chunk) {
        if (!watched) {
          // Nobody is looking: don't decode. Resume from the next keyframe.
          for (const lane of streams.get(key)?.lanes ?? []) lane.waitingKey = true;
          return;
        }
        pushChunk(trackSid, key, frame.chunk);
      } else if (frame.jpeg && watched) {
        pushJpeg(trackSid, key, frame.jpeg);
      }
    },
    attach: (trackSid, canvas, onFrame) => {
      let set = sinks.get(trackSid);
      if (!set) {
        set = new Map();
        sinks.set(trackSid, set);
      }
      set.set(canvas, onFrame);
      const prev = last.get(trackSid);
      if (prev) {
        drawFrame(canvas, prev);
        onFrame?.();
      }
      askKey(trackSid);
      return () => {
        const current = sinks.get(trackSid);
        current?.delete(canvas);
        if (current && current.size === 0) sinks.delete(trackSid);
      };
    },
    drop: (trackSid) => {
      for (const key of [...streams.keys()]) {
        if (key.endsWith(`|${trackSid}`)) closeStream(key);
      }
      for (const key of [...jpegs.keys()]) {
        if (key.endsWith(`|${trackSid}`)) jpegs.delete(key);
      }
      last.get(trackSid)?.close();
      last.delete(trackSid);
    },
    clear: () => {
      for (const key of [...streams.keys()]) closeStream(key);
      jpegs.clear();
      for (const f of last.values()) f.close();
      last.clear();
    },
  };
}

function drawFrame(canvas: HTMLCanvasElement, frame: VideoFrame) {
  const w = frame.displayWidth;
  const h = frame.displayHeight;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  canvas.getContext("2d", { alpha: false })?.drawImage(frame, 0, 0, w, h);
}

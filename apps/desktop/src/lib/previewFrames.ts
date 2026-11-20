/**
 * Message format for in-app live previews (lobby tiles, pop-outs).
 *
 * Desktop publishers send H.264/VP8 chunks from WebCodecs; the old JPEG form
 * is still accepted (browser fallback, or a machine without WebCodecs).
 * Neither form uses Blobs: Chromium keeps Blob bytes in the main process, so
 * one Blob per frame made the main process grow and stutter.
 */

export type PreviewChunk = {
  type: "key" | "delta";
  data: ArrayBuffer;
  /** Microseconds, increasing. */
  timestamp: number;
  codec: string;
  width: number;
  height: number;
};

export type PreviewFrame = {
  trackSid: string;
  /** Which publisher sent it (set by the preload for port messages). */
  from?: string;
  chunk?: PreviewChunk;
  /** Legacy JPEG frame. */
  jpeg?: ArrayBuffer;
};

export function isPreviewFrame(value: unknown): value is PreviewFrame {
  const v = value as PreviewFrame | null;
  return Boolean(v && typeof v.trackSid === "string" && (v.chunk || v.jpeg));
}

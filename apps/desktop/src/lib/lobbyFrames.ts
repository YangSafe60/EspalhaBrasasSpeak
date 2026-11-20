import { createPreviewHub } from "./previewDecoder";
import type { PreviewFrame } from "./previewFrames";

/**
 * Main-window previews of lives (lobby tiles). Frames come from the voice
 * host and screen hosts over direct ports and are drawn onto canvases.
 */
const hub = createPreviewHub((trackSid) =>
  window.electronAPI?.requestPreviewKeyFrame?.(trackSid),
);

export function applyLobbyFrame(frame: PreviewFrame): void {
  hub.push(frame);
}

/** Draw the live `trackSid` into `canvas` until the returned cleanup runs. */
export function subscribeLobbyFrame(trackSid: string, canvas: HTMLCanvasElement): () => void {
  return hub.attach(trackSid, canvas);
}

export function dropLobbyFrame(trackSid: string): void {
  hub.drop(trackSid);
}

export function clearLobbyFrames(): void {
  hub.clear();
}

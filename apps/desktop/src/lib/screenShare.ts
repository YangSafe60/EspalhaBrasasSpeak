import {
  loadLivekit,
  type LocalAudioTrack,
  type LocalVideoTrack,
} from "./livekit";
import { getElectronAPI, isDesktopApp } from "./desktop";

export { isDesktopApp };
/** @deprecated use isDesktopApp */
export const isTauriApp = isDesktopApp;

/** Sharp text/UI; paired with maintain-framerate on the sender for lower delay. */
export function applyScreenShareQualityHints(media: MediaStreamTrack): void {
  try {
    media.contentHint = "detail";
  } catch {
    /* optional */
  }
}

/** After publish, prefer frame rate over resolution when bandwidth is tight. */
export async function tunePublishedScreenShare(track: LocalVideoTrack): Promise<void> {
  applyScreenShareQualityHints(track.mediaStreamTrack);
  try {
    const sender =
      (track as LocalVideoTrack & { getSender?: () => RTCRtpSender | undefined })
        .getSender?.() ??
      (track as unknown as { sender?: RTCRtpSender }).sender;
    if (!sender?.getParameters || !sender.setParameters) return;
    const params = sender.getParameters();
    if (!params.encodings?.length) return;
    params.degradationPreference = "maintain-framerate";
    await sender.setParameters(params);
  } catch {
    /* optional */
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

export async function listDesktopShareSources(opts?: {
  types?: Array<"screen" | "window">;
}) {
  const api = getElectronAPI();
  if (!api) throw new Error("Screen sources require the Electron desktop app");
  return api.listShareSources(opts);
}

type CaptureConstraints = {
  audio:
    | false
    | {
        mandatory: {
          chromeMediaSource: "desktop";
        };
      };
  video: {
    mandatory: {
      chromeMediaSource: "desktop";
      chromeMediaSourceId: string;
      maxWidth: number;
      maxHeight: number;
      maxFrameRate: number;
      minFrameRate?: number;
    };
  };
};

/**
 * Native Chromium desktop capture (no JPEG) via Electron desktopCapturer source id.
 */
export async function captureElectronSource(
  sourceId: string,
  opts?: { systemAudio?: boolean; maxWidth?: number; maxHeight?: number; maxFps?: number },
): Promise<{
  stream: MediaStream;
  videoTrack: LocalVideoTrack;
  audioTrack: LocalAudioTrack | null;
  stop: () => Promise<void>;
}> {
  const systemAudio = opts?.systemAudio !== false;
  const maxWidth = opts?.maxWidth ?? 1920;
  const maxHeight = opts?.maxHeight ?? 1080;
  const maxFps = opts?.maxFps ?? 60;

  const constraints: CaptureConstraints = {
    audio: systemAudio
      ? {
          mandatory: {
            chromeMediaSource: "desktop",
          },
        }
      : false,
    video: {
      mandatory: {
        chromeMediaSource: "desktop",
        chromeMediaSourceId: sourceId,
        maxWidth,
        maxHeight,
        maxFrameRate: maxFps,
        minFrameRate: Math.min(30, maxFps),
      },
    },
  };

  const { LocalAudioTrack, LocalVideoTrack } = await loadLivekit();

  // Electron uses legacy chromeMediaSource constraints not in standard typings.
  const stream = await navigator.mediaDevices.getUserMedia(
    constraints as unknown as MediaStreamConstraints,
  );

  const mediaVideo = stream.getVideoTracks()[0];
  if (!mediaVideo) {
    stream.getTracks().forEach((t) => t.stop());
    throw new Error("No video track from desktop capture");
  }
  applyScreenShareQualityHints(mediaVideo);

  const videoTrack = new LocalVideoTrack(mediaVideo, undefined, true);
  const mediaAudio = stream.getAudioTracks()[0] ?? null;
  const audioTrack = mediaAudio ? new LocalAudioTrack(mediaAudio) : null;

  return {
    stream,
    videoTrack,
    audioTrack,
    stop: async () => {
      try {
        videoTrack.stop();
      } catch {
        /* ignore */
      }
      try {
        audioTrack?.stop();
      } catch {
        /* ignore */
      }
      for (const t of stream.getTracks()) {
        try {
          t.stop();
        } catch {
          /* ignore */
        }
      }
    },
  };
}

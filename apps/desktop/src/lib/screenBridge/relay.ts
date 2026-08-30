import { getElectronAPI } from "../desktop";
import {
  ABS_MAX_RELAY_WIDTH,
  DEFAULT_JPEG_QUALITY,
  FRAME_INTERVAL_MS,
  bridgeRuntime,
  captureSources,
  relays,
  tracks,
} from "./state";
import { publishFrame } from "./transport";

/** Disable Electron background throttling while any pop-out relay is active. */
export function syncRelayBackgroundThrottling() {
  const electron = getElectronAPI();
  if (!electron?.setBackgroundThrottling) return;
  if (bridgeRuntime.activeRelayViewers > 0) {
    void electron.setBackgroundThrottling(false);
  }
}

function mountHiddenRelayVideo(video: HTMLVideoElement) {
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "");
  video.dataset.speakappRelay = "1";
  video.style.position = "fixed";
  video.style.left = "-9999px";
  video.style.top = "0";
  video.style.width = "1px";
  video.style.height = "1px";
  video.style.opacity = "0";
  video.style.pointerEvents = "none";
  document.body.appendChild(video);
}

export function purgeOrphanRelayElements() {
  document.querySelectorAll("video[data-speakapp-relay]").forEach((el) => {
    try {
      const media = el as HTMLVideoElement & { srcObject?: MediaStream | null };
      media.srcObject = null;
      el.remove();
    } catch {
      /* ignore */
    }
  });
}

function resolveCaptureVideo(trackSid: string): HTMLVideoElement | null {
  return captureSources.get(trackSid)?.() ?? null;
}

/**
 * Start JPEG relay for one trackSid. Idempotent — duplicate requests are ignored.
 * Captures from the registered lobby video when available.
 */
export function startRelay(trackSid: string) {
  const existing = relays.get(trackSid);
  if (existing) {
    return;
  }

  const track = tracks.get(trackSid);
  const hasCapture = captureSources.has(trackSid);
  if (!hasCapture && (!track || track.readyState === "ended")) {
    return;
  }

  let fallbackVideo: HTMLVideoElement | null = null;
  let cloned: MediaStreamTrack | null = null;
  const kickPlay = () => {
    void fallbackVideo?.play().catch(() => undefined);
  };

  if (track && track.readyState !== "ended") {
    fallbackVideo = document.createElement("video");
    mountHiddenRelayVideo(fallbackVideo);
    cloned = (() => {
      try {
        return track.clone();
      } catch {
        return track;
      }
    })();
    fallbackVideo.srcObject = new MediaStream([cloned]);
    kickPlay();
    fallbackVideo.addEventListener("loadeddata", kickPlay);
    fallbackVideo.addEventListener("loadedmetadata", kickPlay);
    fallbackVideo.addEventListener("resize", kickPlay);
    fallbackVideo.addEventListener("canplay", kickPlay);
  }

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
  if (ctx) ctx.imageSmoothingEnabled = false;
  let timer: number | null = null;
  let rVfcHandle: number | null = null;
  let stopped = false;
  let lastPublishedAt = 0;

  const publishSnapshot = () => {
    if (stopped || !ctx) return false;
    const source = resolveCaptureVideo(trackSid) ?? fallbackVideo;
    if (!source) return false;
    const w = source.videoWidth;
    const h = source.videoHeight;
    if (w <= 0 || h <= 0) return false;
    const now = performance.now();
    if (now - lastPublishedAt < FRAME_INTERVAL_MS) return false;
    const cap = Math.min(w, ABS_MAX_RELAY_WIDTH);
    const scale = w > cap ? cap / w : 1;
    const tw = Math.max(1, Math.round(w * scale));
    const th = Math.max(1, Math.round(h * scale));
    if (canvas.width !== tw || canvas.height !== th) {
      canvas.width = tw;
      canvas.height = th;
    }
    ctx.drawImage(source, 0, 0, tw, th);
    try {
      const frame = canvas.toDataURL("image/jpeg", DEFAULT_JPEG_QUALITY);
      void publishFrame({ trackSid, frame });
      lastPublishedAt = now;
      return true;
    } catch {
      return false;
    }
  };

  const scheduleNext = () => {
    if (stopped) return;
    const source = resolveCaptureVideo(trackSid) ?? fallbackVideo;
    if (
      source &&
      "requestVideoFrameCallback" in source &&
      typeof source.requestVideoFrameCallback === "function"
    ) {
      rVfcHandle = source.requestVideoFrameCallback(() => {
        publishSnapshot();
        scheduleNext();
      });
      return;
    }
    timer = window.setTimeout(() => {
      publishSnapshot();
      scheduleNext();
    }, FRAME_INTERVAL_MS);
  };

  const onEnded = () => {
    relays.get(trackSid)?.stop();
  };
  cloned?.addEventListener("ended", onEnded);

  scheduleNext();
  bridgeRuntime.activeRelayViewers += 1;
  syncRelayBackgroundThrottling();

  relays.set(trackSid, {
    viewers: 1,
    stop: () => {
      if (stopped) return;
      stopped = true;
      if (timer != null) window.clearTimeout(timer);
      if (
        rVfcHandle != null &&
        "cancelVideoFrameCallback" in HTMLVideoElement.prototype
      ) {
        const source = resolveCaptureVideo(trackSid) ?? fallbackVideo;
        source?.cancelVideoFrameCallback?.(rVfcHandle);
      }
      cloned?.removeEventListener("ended", onEnded);
      if (fallbackVideo) {
        fallbackVideo.removeEventListener("loadeddata", kickPlay);
        fallbackVideo.removeEventListener("loadedmetadata", kickPlay);
        fallbackVideo.removeEventListener("resize", kickPlay);
        fallbackVideo.removeEventListener("canplay", kickPlay);
        try {
          if (cloned && cloned !== track) cloned.stop();
        } catch {
          /* ignore */
        }
        fallbackVideo.srcObject = null;
        fallbackVideo.remove();
      }
      canvas.width = 0;
      canvas.height = 0;
      relays.delete(trackSid);
      bridgeRuntime.activeRelayViewers = Math.max(
        0,
        bridgeRuntime.activeRelayViewers - 1,
      );
      syncRelayBackgroundThrottling();
    },
  });
}

/** Stop relay for one trackSid if running. */
export function releaseRelay(trackSid: string) {
  const entry = relays.get(trackSid);
  if (!entry) return;
  entry.stop();
}

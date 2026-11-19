import { getElectronAPI } from "../desktop";
import { jpegPreviewMaxWidth, startLatestJpegRelay } from "../jpegRelay";
import { loadScreenShareQuality } from "../screenShareQuality";
import {
  bridgeRuntime,
  captureSources,
  relays,
  tracks,
  type CaptureElement,
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

function resolveCaptureVideo(trackSid: string): CaptureElement | null {
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

  // Desktop pop-outs get the voice-host JPEG from the main process.
  // Encoding it again from the lobby image was a second frame of delay.
  if (getElectronAPI()) return;

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

  const videoForEncode = (): HTMLVideoElement | null => {
    const source = resolveCaptureVideo(trackSid) ?? fallbackVideo;
    return source instanceof HTMLVideoElement ? source : null;
  };

  const bound = videoForEncode();
  if (!bound) return;

  let stopped = false;
  const relay = startLatestJpegRelay({
    video: bound,
    maxWidth: jpegPreviewMaxWidth(),
    fps: () => loadScreenShareQuality().fps,
    onFrame: (jpeg) => {
      void publishFrame({ trackSid, jpeg });
    },
  });

  const onEnded = () => {
    relays.get(trackSid)?.stop();
  };
  cloned?.addEventListener("ended", onEnded);

  bridgeRuntime.activeRelayViewers += 1;
  syncRelayBackgroundThrottling();

  relays.set(trackSid, {
    viewers: 1,
    stop: () => {
      if (stopped) return;
      stopped = true;
      relay.stop();
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

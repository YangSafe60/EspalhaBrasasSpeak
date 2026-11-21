import { publishFrame } from "../lib/framePorts";
import type { LocalScreen, RemoteScreen } from "../hooks/voice/types";
import { previewProfile } from "../lib/jpegRelay";
import { startPreviewEncoder } from "../lib/previewEncoder";

type RelayEntry = {
  stop: () => void;
  requestKeyFrame: () => void;
  /** The track it was started from; a resubscribe brings a new object. */
  track: object;
};

const relays = new Map<string, RelayEntry>();
/** Current preview level from the main process (1 = grid, 2 = focused). */
let previewLevel = 1;

/** Change frame rate / size of running relays without restarting them. */
export function setLobbyPreviewLevel(level: number) {
  previewLevel = level;
}
const videos = new Map<string, HTMLVideoElement>();

function mountHiddenVideo(): HTMLVideoElement {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  video.style.position = "fixed";
  video.style.left = "-9999px";
  video.style.width = "1px";
  video.style.height = "1px";
  video.style.opacity = "0";
  video.style.pointerEvents = "none";
  document.body.appendChild(video);
  return video;
}

function stopRelay(trackSid: string) {
  relays.get(trackSid)?.stop();
  relays.delete(trackSid);
  const video = videos.get(trackSid);
  if (!video) return;
  try {
    video.pause();
  } catch {
    /* ignore */
  }
  try {
    video.srcObject = null;
    video.removeAttribute("src");
    video.load();
  } catch {
    /* ignore */
  }
  try {
    video.remove();
  } catch {
    /* ignore */
  }
  videos.delete(trackSid);
}

function startRelay(
  trackSid: string,
  track: {
    attach: (el: HTMLMediaElement) => void;
    detach: (el?: HTMLMediaElement) => void;
  },
) {
  const running = relays.get(trackSid);
  if (running && running.track === track) return;
  if (running) stopRelay(trackSid);
  const video = mountHiddenVideo();
  videos.set(trackSid, video);
  track.attach(video);
  void video.play().catch(() => undefined);

  const relay = startPreviewEncoder({
    video,
    maxWidth: () => previewProfile(previewLevel).maxWidth,
    quality: () => previewProfile(previewLevel).quality,
    fps: () => previewProfile(previewLevel).fps,
    warm: () => [previewProfile(1), previewProfile(2)],
    onFrame: (frame) => {
      publishFrame({ trackSid, ...frame });
    },
  });

  relays.set(trackSid, {
    track,
    requestKeyFrame: relay.requestKeyFrame,
    stop: () => {
      relay.stop();
      try {
        track.detach(video);
      } catch {
        /* ignore */
      }
    },
  });
}

/** A viewer (new tile, pop-out, decoder reset) needs a keyframe to start. */
export function requestLobbyKeyFrame(trackSid: string) {
  relays.get(trackSid)?.requestKeyFrame();
}

export function stopVoiceHostLobbyRelay() {
  for (const sid of [...relays.keys()]) stopRelay(sid);
}

export function startVoiceHostLobbyRelay(
  localScreens: LocalScreen[],
  remoteScreens: RemoteScreen[],
) {
  const active = new Set<string>();
  for (const s of localScreens) {
    if (!s.track) continue;
    active.add(s.trackSid);
    startRelay(s.trackSid, s.track);
  }
  for (const s of remoteScreens) {
    if (!s.subscribed || !s.track) continue;
    active.add(s.trackSid);
    startRelay(s.trackSid, s.track);
  }
  for (const sid of [...relays.keys()]) {
    if (!active.has(sid)) stopRelay(sid);
  }
}

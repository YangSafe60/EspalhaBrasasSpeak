import type { LocalScreen, RemoteScreen } from "../hooks/voice/types";

const FRAME_INTERVAL_MS = 33;
const JPEG_QUALITY = 0.82;
const MAX_WIDTH = 1920;

type RelayEntry = {
  stop: () => void;
};

const relays = new Map<string, RelayEntry>();
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
  if (video) {
    try {
      video.srcObject = null;
      video.remove();
    } catch {
      /* ignore */
    }
    videos.delete(trackSid);
  }
}

function startRelay(
  trackSid: string,
  track: {
    attach: (el: HTMLMediaElement) => void;
    detach: (el?: HTMLMediaElement) => void;
  },
) {
  if (relays.has(trackSid)) return;
  const video = mountHiddenVideo();
  videos.set(trackSid, video);
  track.attach(video);
  void video.play().catch(() => undefined);

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
  let stopped = false;
  let timer: number | null = null;

  const tick = () => {
    if (stopped || !ctx) return;
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (w > 0 && h > 0) {
      const cap = Math.min(w, MAX_WIDTH);
      const scale = w > cap ? cap / w : 1;
      const tw = Math.max(1, Math.round(w * scale));
      const th = Math.max(1, Math.round(h * scale));
      if (canvas.width !== tw || canvas.height !== th) {
        canvas.width = tw;
        canvas.height = th;
      }
      ctx.drawImage(video, 0, 0, tw, th);
      try {
        const frame = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
        void window.electronAPI?.publishLobbyFrame?.({ trackSid, frame });
      } catch {
        /* ignore */
      }
    }
    timer = window.setTimeout(tick, FRAME_INTERVAL_MS);
  };
  tick();

  relays.set(trackSid, {
    stop: () => {
      if (stopped) return;
      stopped = true;
      if (timer != null) window.clearTimeout(timer);
      try {
        track.detach(video);
      } catch {
        /* ignore */
      }
      canvas.width = 0;
      canvas.height = 0;
    },
  });
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

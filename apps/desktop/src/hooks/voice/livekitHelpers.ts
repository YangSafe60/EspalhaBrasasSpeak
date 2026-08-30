import { getLivekit, type LocalTrack, type Room } from "../../lib/livekit";
import {
  inputGainFromSettings,
  outputGainFromSettings,
  type MediaSettings,
} from "../../lib/mediaSettings";

/** WebView2 often breaks ICE when the URL host is `localhost` (IPv6 ::1). */
export function normalizeLivekitUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname === "localhost") {
      u.hostname = "127.0.0.1";
    }
    return u.toString().replace(/\/$/, "");
  } catch {
    return url.replace(/\/\/localhost(?=[:/]|$)/i, "//127.0.0.1");
  }
}

let micPermissionPrimed = false;

/**
 * Prime getUserMedia once so WebView2 allows PeerConnection on first voice join.
 */
export async function ensureMicPermission(): Promise<void> {
  if (micPermissionPrimed) return;
  if (!navigator.mediaDevices?.getUserMedia) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: false,
    });
    stream.getTracks().forEach((t) => t.stop());
    micPermissionPrimed = true;
  } catch {
    // User denied or no device — still attempt join (listen-only may work).
  }
}

/** Apply saved input/output devices and gain levels to an active LiveKit room. */
export async function applyDevicesToRoom(room: Room, settings: MediaSettings) {
  try {
    if (settings.inputDeviceId) {
      await room.switchActiveDevice("audioinput", settings.inputDeviceId);
    }
  } catch {
    /* device may be unavailable */
  }
  try {
    if (settings.outputDeviceId) {
      await room.switchActiveDevice("audiooutput", settings.outputDeviceId);
    }
  } catch {
    /* not all platforms support sinkId */
  }
  try {
    if (settings.cameraDeviceId) {
      await room.switchActiveDevice("videoinput", settings.cameraDeviceId);
    }
  } catch {
    /* optional */
  }

  const gain = inputGainFromSettings(settings);
  room.localParticipant.audioTrackPublications.forEach((pub) => {
    const track = pub.track;
    if (track && "setVolume" in track && typeof track.setVolume === "function") {
      track.setVolume(gain);
    }
  });

  const out = outputGainFromSettings(settings);
  room.remoteParticipants.forEach((p) => {
    p.audioTrackPublications.forEach((pub) => {
      if (pub.source === getLivekit().Track.Source.ScreenShareAudio) return;
      const track = pub.track;
      if (track && "setVolume" in track && typeof track.setVolume === "function") {
        track.setVolume(out);
      }
    });
  });
}

/** Collect published screen-share tracks before hopping voice channels. */
export function collectScreenTracks(
  room: Room,
): { track: LocalTrack; name?: string }[] {
  const tracks: { track: LocalTrack; name?: string }[] = [];
  room.localParticipant.trackPublications.forEach((pub) => {
    if (
      (pub.source === getLivekit().Track.Source.ScreenShare ||
        pub.source === getLivekit().Track.Source.ScreenShareAudio) &&
      pub.track
    ) {
      tracks.push({
        track: pub.track,
        name: pub.trackName || undefined,
      });
    }
  });
  return tracks;
}

/** Read LiveKit client RTT when exposed by the SDK (used for ping display). */
export function readSignalRtt(room: Room): number | null {
  const rtt = (
    room as unknown as { engine?: { client?: { rtt?: number } } }
  ).engine?.client?.rtt;
  if (typeof rtt !== "number" || !Number.isFinite(rtt) || rtt <= 0) {
    return null;
  }
  return Math.round(rtt);
}

/** Stop mic/camera tracks but keep screen-share publications alive. */
export function stopLocalMediaExceptScreenShare(room: Room) {
  const lk = getLivekit();
  room.localParticipant.trackPublications.forEach((pub) => {
    if (
      pub.source === lk.Track.Source.ScreenShare ||
      pub.source === lk.Track.Source.ScreenShareAudio
    ) {
      return;
    }
    const track = pub.track;
    if (!track) return;
    try {
      track.stop();
    } catch {
      /* ignore */
    }
  });
}

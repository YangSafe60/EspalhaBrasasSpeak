import type { Room } from "livekit-client";
import { getElectronAPI } from "./desktop";
import { purgeLivekitDomArtifacts } from "./livekit";

/** Stop every track on every media element still in the document. */
export function forceStopAllDomMedia(): void {
  document.querySelectorAll("video, audio").forEach((el) => {
    try {
      const media = el as HTMLMediaElement & { srcObject?: MediaStream | null };
      const stream = media.srcObject;
      if (stream instanceof MediaStream) {
        for (const track of stream.getTracks()) {
          try {
            track.stop();
          } catch {
            /* ignore */
          }
        }
      }
      media.srcObject = null;
      media.removeAttribute("src");
      media.load?.();
    } catch {
      /* ignore */
    }
  });
  purgeLivekitDomArtifacts();
}

/** Best-effort nudge for Electron/Chromium to return freed pages to the OS. */
export function requestRendererMemoryTrim(): void {
  try {
    const w = window as Window & { gc?: () => void };
    w.gc?.();
  } catch {
    /* optional --expose-gc */
  }
  void getElectronAPI()?.trimMemory?.();
}

/**
 * Fully tear down a LiveKit room and every related media handle we own.
 * Prefer this over ad-hoc unpublish loops — LiveKit disconnect still runs last.
 */
export async function hardTeardownLivekitRoom(
  room: Room,
  stopTracks: boolean,
  purgeRemoteAudio: () => void,
): Promise<void> {
  purgeRemoteAudio();
  purgeLivekitDomArtifacts();

  room.remoteParticipants.forEach((p) => {
    p.trackPublications.forEach((pub) => {
      try {
        pub.setSubscribed(false);
      } catch {
        /* ignore */
      }
      const track = pub.track;
      if (!track) return;
      try {
        track.detach();
      } catch {
        /* ignore */
      }
    });
  });

  if (stopTracks) {
    try {
      await room.localParticipant.setMicrophoneEnabled(false);
    } catch {
      /* already down */
    }
    try {
      await room.localParticipant.setCameraEnabled(false);
    } catch {
      /* optional */
    }

    for (const pub of [...room.localParticipant.trackPublications.values()]) {
      const track = pub.track;
      if (!track) continue;
      try {
        await room.localParticipant.unpublishTrack(track, true);
      } catch {
        try {
          track.stop();
        } catch {
          /* ignore */
        }
      }
    }
  }

  forceStopAllDomMedia();

  try {
    await room.disconnect(stopTracks);
  } catch {
    /* already disconnected */
  }

  const engine = (
    room as unknown as { engine?: { close?: () => Promise<void> } }
  ).engine;
  if (engine?.close) {
    try {
      await engine.close();
    } catch {
      /* ignore */
    }
  }

  try {
    const ctx = (room as unknown as { audioContext?: AudioContext }).audioContext;
    if (ctx && ctx.state !== "closed") {
      await ctx.close();
    }
  } catch {
    /* ignore */
  }

  forceStopAllDomMedia();

  try {
    room.removeAllListeners();
  } catch {
    /* EventEmitter API */
  }
}

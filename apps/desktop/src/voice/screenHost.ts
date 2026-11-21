import { onKeyFrameRequest, publishFrame } from "../lib/framePorts";
import { api } from "../api/client";
import { normalizeLivekitUrl } from "../hooks/voice/livekitHelpers";
import { previewProfile } from "../lib/jpegRelay";
import { startPreviewEncoder } from "../lib/previewEncoder";
import { getLivekit, loadLivekit } from "../lib/livekit";
import {
  captureElectronSource,
  publishScreenShareVideo,
  tunePublishedScreenShare,
} from "../lib/screenShare";
import {
  screenShareEncoding,
  type ScreenShareFps,
  type ScreenShareResolution,
} from "../lib/screenShareQuality";

type ScreenHostParams = {
  sourceId: string;
  mode: "channel" | "dm";
  targetId: string;
  systemAudio: boolean;
  maxWidth: number;
  maxHeight: number;
  maxFps: number;
  resolution: ScreenShareResolution;
};

function readParams(): ScreenHostParams {
  const q = new URLSearchParams(window.location.search);
  const mode = q.get("mode") === "dm" ? "dm" : "channel";
  return {
    sourceId: q.get("sourceId") || "",
    mode,
    targetId: q.get("targetId") || "",
    systemAudio: q.get("systemAudio") !== "0",
    maxWidth: Number(q.get("maxWidth")) || 1920,
    maxHeight: Number(q.get("maxHeight")) || 1080,
    maxFps: Number(q.get("maxFps")) === 60 ? 60 : 30,
    resolution:
      q.get("resolution") === "720p" || q.get("resolution") === "source"
        ? (q.get("resolution") as ScreenShareResolution)
        : "1080p",
  };
}

/**
 * One hidden window per live. Capture and encode live here so closing the
 * window returns that memory to Windows without leaving the voice call.
 */
export async function startScreenHost(): Promise<void> {
  const params = readParams();
  let stopped = false;
  let stopCapture: (() => Promise<void>) | null = null;
  let stopRelay: (() => void) | null = null;
  /** Preview level from main; can arrive before the live is published. */
  let previewLevel = 0;
  let onPreviewLevel: ((level: number) => void) | null = null;
  let offPreview: (() => void) | null =
    window.electronAPI?.onScreenPreview?.((level) => {
      previewLevel = level;
      onPreviewLevel?.(level);
    }) ?? null;
  let room: import("livekit-client").Room | null = null;

  const shutdown = async () => {
    if (stopped) return;
    stopped = true;
    offPreview?.();
    offPreview = null;
    stopRelay?.();
    stopRelay = null;
    if (stopCapture) {
      await stopCapture().catch(() => undefined);
      stopCapture = null;
    }
    if (room) {
      const current = room;
      room = null;
      try {
        await current.disconnect();
      } catch {
        /* already gone */
      }
    }
  };

  (window as Window & { __stopScreenHost?: () => Promise<void> }).__stopScreenHost =
    shutdown;

  const fail = (error: string) => {
    void window.electronAPI?.reportScreenPublisher?.({
      ok: false,
      sourceId: params.sourceId,
      error,
    });
  };

  try {
    if (!params.sourceId || !params.targetId) {
      throw new Error("Missing screen share target");
    }
    const path =
      params.mode === "dm"
        ? `/api/dms/${params.targetId}/call/screen-token`
        : `/api/channels/${params.targetId}/voice/screen-token`;
    const creds = await api<{ token: string; url: string; room: string }>(path, {
      method: "POST",
      body: { source_id: params.sourceId },
    });

    const { Room } = await loadLivekit();
    room = new Room({ adaptiveStream: false, dynacast: false });
    await room.connect(normalizeLivekitUrl(creds.url), creds.token, {
      autoSubscribe: false,
    });

    const captured = await captureElectronSource(params.sourceId, {
      systemAudio: params.systemAudio,
      maxWidth: params.maxWidth,
      maxHeight: params.maxHeight,
      maxFps: params.maxFps,
    });
    stopCapture = captured.stop;

    const encoding = screenShareEncoding(
      params.resolution,
      params.maxFps as ScreenShareFps,
    );

    await publishScreenShareVideo(
      (track, opts) => room!.localParticipant.publishTrack(track, opts),
      captured.videoTrack,
      {
        name: `screen:${params.sourceId}`,
        source: getLivekit().Track.Source.ScreenShare,
        videoEncoding: encoding,
      },
    );
    await tunePublishedScreenShare(captured.videoTrack);
    if (captured.audioTrack) {
      await room.localParticipant.publishTrack(captured.audioTrack, {
        name: `screen-audio:${params.sourceId}`,
        source: getLivekit().Track.Source.ScreenShareAudio,
        audioPreset: { maxBitrate: 128_000 },
      });
    }

    const publication = [...room.localParticipant.trackPublications.values()].find(
      (pub) => pub.source === getLivekit().Track.Source.ScreenShare && pub.trackSid,
    );
    const trackSid = publication?.trackSid || "";
    // Streamer's own preview. Only encode while a lobby tile or pop-out is
    // on screen (level > 0); the old version encoded all the time.
    let video: HTMLVideoElement | null = null;
    let relay: { stop: () => void; requestKeyFrame: () => void } | null = null;
    const offKeyRequest = onKeyFrameRequest((sid) => {
      if (sid === trackSid) relay?.requestKeyFrame();
    });
    const stopPreview = () => {
      relay?.stop();
      relay = null;
      if (video) {
        try {
          captured.videoTrack.detach(video);
        } catch {
          /* ignore */
        }
        video.srcObject = null;
        video.remove();
        video = null;
      }
    };
    const startPreview = () => {
      if (relay || stopped || !trackSid) return;
      video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      captured.videoTrack.attach(video);
      void video.play().catch(() => undefined);
      relay = startPreviewEncoder({
        video,
        maxWidth: () => previewProfile(previewLevel).maxWidth,
        quality: () => previewProfile(previewLevel).quality,
        fps: () => previewProfile(previewLevel).fps,
        warm: () => [previewProfile(1), previewProfile(2)],
        onFrame: (frame) => {
          publishFrame({ trackSid, ...frame });
        },
      });
    };
    stopRelay = () => {
      offKeyRequest?.();
      stopPreview();
    };
    onPreviewLevel = (level) => {
      if (level > 0) startPreview();
      else stopPreview();
    };
    onPreviewLevel(previewLevel);

    void window.electronAPI?.reportScreenPublisher?.({
      ok: true,
      sourceId: params.sourceId,
      trackSid,
      hasAudio: !!captured.audioTrack,
    });
  } catch (err) {
    await shutdown();
    fail(err instanceof Error ? err.message : "Screen share failed");
  }
}

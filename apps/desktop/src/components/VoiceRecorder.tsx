import { useEffect, useRef, useState } from "react";
import { loadMediaSettings } from "../lib/mediaSettings";

/** Longest voice message. */
const MAX_SECONDS = 5 * 60;

function pickMime(): string {
  for (const t of ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/webm"]) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) return t;
  }
  return "";
}

function fmt(secs: number): string {
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
}

/**
 * Mic button in a composer: records a voice message (Opus) with the mic
 * chosen in Voice & Video settings, then hands the file to `onRecorded`
 * (sent like any attachment, so it's encrypted before upload).
 */
export function VoiceRecorder({
  disabled,
  onRecorded,
}: {
  disabled?: boolean;
  onRecorded: (file: File) => Promise<void> | void;
}) {
  const [recording, setRecording] = useState(false);
  const [secs, setSecs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const cancelled = useRef(false);
  const timer = useRef<number | null>(null);

  function cleanup() {
    if (timer.current != null) window.clearInterval(timer.current);
    timer.current = null;
    recRef.current?.stream.getTracks().forEach((t) => t.stop());
    recRef.current = null;
    setRecording(false);
  }

  useEffect(() => () => {
    cancelled.current = true;
    if (recRef.current?.state === "recording") recRef.current.stop();
    cleanup();
  }, []);

  async function start() {
    setError(null);
    try {
      const { inputDeviceId, echoCancellation, noiseSuppression, autoGainControl } = loadMediaSettings();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: inputDeviceId ? { exact: inputDeviceId } : undefined,
          echoCancellation,
          noiseSuppression,
          autoGainControl,
        },
      });
      const mimeType = pickMime();
      const rec = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 48000 } : undefined);
      chunks.current = [];
      cancelled.current = false;
      rec.ondataavailable = (e) => {
        if (e.data.size) chunks.current.push(e.data);
      };
      rec.onstop = () => {
        const type = (rec.mimeType || "audio/webm").split(";")[0];
        const blob = new Blob(chunks.current, { type });
        cleanup();
        if (cancelled.current || blob.size === 0) return;
        const ext = type.includes("ogg") ? "ogg" : "webm";
        const file = new File([blob], `voice-message.${ext}`, { type });
        setSending(true);
        void Promise.resolve(onRecorded(file))
          .catch((e) => setError(e instanceof Error ? e.message : "Couldn't send"))
          .finally(() => setSending(false));
      };
      rec.start(1000);
      recRef.current = rec;
      setSecs(0);
      setRecording(true);
      timer.current = window.setInterval(() => {
        setSecs((s) => {
          if (s + 1 >= MAX_SECONDS && recRef.current?.state === "recording") recRef.current.stop();
          return s + 1;
        });
      }, 1000);
    } catch {
      setError("Couldn't use the microphone.");
      cleanup();
    }
  }

  function stop(send: boolean) {
    cancelled.current = !send;
    if (recRef.current?.state === "recording") recRef.current.stop();
    else cleanup();
  }

  if (recording) {
    return (
      <div className="voice-rec" role="status" aria-label="Recording a voice message">
        <span className="voice-rec-dot" aria-hidden />
        <span className="voice-rec-time">{fmt(secs)}</span>
        <button type="button" className="icon-btn" title="Cancel" aria-label="Cancel recording" onClick={() => stop(false)}>
          ✕
        </button>
        <button type="button" className="btn primary sm" onClick={() => stop(true)}>
          Send
        </button>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        className="icon-btn voice-rec-btn"
        title={error ?? (sending ? "Sending voice message…" : "Record a voice message")}
        aria-label="Record a voice message"
        disabled={disabled || sending}
        onClick={() => void start()}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden fill="currentColor">
          <path d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z" />
        </svg>
      </button>
      {error && <span className="voice-rec-error" role="alert">{error}</span>}
    </>
  );
}

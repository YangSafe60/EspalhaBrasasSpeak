import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

const BARS = 44;

/** Bar heights (0..1) from the audio itself; a stable pattern if it can't be read. */
async function readPeaks(src: string): Promise<{ peaks: number[]; duration: number }> {
  const buf = await (await fetch(src)).arrayBuffer();
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  try {
    const audio = await ctx.decodeAudioData(buf);
    const data = audio.getChannelData(0);
    const step = Math.max(1, Math.floor(data.length / BARS));
    const raw: number[] = [];
    for (let b = 0; b < BARS; b++) {
      let sum = 0;
      const start = b * step;
      const end = Math.min(data.length, start + step);
      for (let i = start; i < end; i++) sum += data[i] * data[i];
      raw.push(Math.sqrt(sum / Math.max(1, end - start)));
    }
    const max = Math.max(...raw, 1e-6);
    return { peaks: raw.map((v) => Math.max(0.12, v / max)), duration: audio.duration };
  } finally {
    void ctx.close();
  }
}

/** Placeholder bars (seeded by the URL) while loading or when decoding fails. */
function fallbackPeaks(seed: string): number[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return Array.from({ length: BARS }, (_, i) => {
    h = Math.imul(h ^ (h >>> 15), 2246822507) + i;
    return 0.25 + ((h >>> 0) % 1000) / 1000 * 0.6;
  });
}

function fmt(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const s = Math.floor(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Voice message: round play button, red waveform that fills as it plays. */
export function VoicePlayer({ src }: { src: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const waveRef = useRef<HTMLDivElement>(null);
  const [peaks, setPeaks] = useState<number[]>(() => fallbackPeaks(src));
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    let alive = true;
    setPeaks(fallbackPeaks(src));
    readPeaks(src)
      .then((r) => {
        if (!alive) return;
        setPeaks(r.peaks);
        // Recorded webm often reports an Infinity duration; use the decoded one.
        if (Number.isFinite(r.duration) && r.duration > 0) setDuration((d) => (Number.isFinite(d) && d > 0 ? d : r.duration));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [src]);

  // Smooth progress while playing.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const a = audioRef.current;
      if (a) setTime(a.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  function toggle() {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) {
      // Stop any other voice message that's playing.
      document.querySelectorAll<HTMLAudioElement>("audio.voice-player-audio").forEach((o) => {
        if (o !== a) o.pause();
      });
      void a.play();
    } else {
      a.pause();
    }
  }

  function seekTo(clientX: number) {
    const a = audioRef.current;
    const el = waveRef.current;
    if (!a || !el || !(duration > 0)) return;
    const r = el.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    a.currentTime = f * duration;
    setTime(a.currentTime);
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    seekTo(e.clientX);
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) seekTo(e.clientX);
  }

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    const a = audioRef.current;
    if (!a || !(duration > 0)) return;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      a.currentTime = Math.min(duration, Math.max(0, a.currentTime + (e.key === "ArrowRight" ? 2 : -2)));
      setTime(a.currentTime);
    }
  }

  const progress = duration > 0 ? Math.min(1, time / duration) : 0;

  return (
    <div className={`voice-player${playing ? " is-playing" : ""}`}>
      <audio
        ref={audioRef}
        className="voice-player-audio"
        src={src}
        preload="metadata"
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setDuration(d);
        }}
        onDurationChange={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setDuration(d);
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={(e) => {
          setPlaying(false);
          e.currentTarget.currentTime = 0;
          setTime(0);
        }}
      />
      <button
        type="button"
        className="voice-player-btn"
        onClick={toggle}
        aria-label={playing ? "Pause" : "Play"}
        title={playing ? "Pause" : "Play"}
      >
        {playing ? (
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden>
            <rect x="6" y="5" width="4" height="14" rx="1.2" />
            <rect x="14" y="5" width="4" height="14" rx="1.2" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden>
            <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.2-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" />
          </svg>
        )}
      </button>
      <div
        ref={waveRef}
        className="voice-player-wave"
        role="slider"
        tabIndex={0}
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(time)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onKeyDown={onKey}
      >
        {peaks.map((p, i) => (
          <span
            key={i}
            className={`voice-player-bar${(i + 0.5) / peaks.length <= progress ? " is-played" : ""}`}
            style={{ height: `${Math.round(p * 100)}%` }}
          />
        ))}
      </div>
      <span className="voice-player-time">{fmt(playing || time > 0 ? time : duration)}</span>
    </div>
  );
}

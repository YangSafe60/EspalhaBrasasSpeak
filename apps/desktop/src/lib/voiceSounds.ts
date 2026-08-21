import { loadMediaSettings } from "./mediaSettings";

const STORAGE_KEY = "eb_voice_sounds";

export function voiceSoundsEnabled(): boolean {
  return localStorage.getItem(STORAGE_KEY) !== "0";
}

export function setVoiceSoundsEnabled(on: boolean) {
  localStorage.setItem(STORAGE_KEY, on ? "1" : "0");
}

type AudioCtx = AudioContext & {
  setSinkId?: (id: string) => Promise<void>;
};

let sharedCtx: AudioCtx | null = null;

function getContext(): AudioCtx {
  if (!sharedCtx) {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    sharedCtx = new Ctor() as AudioCtx;
  }
  if (sharedCtx.state === "suspended") {
    void sharedCtx.resume();
  }
  return sharedCtx;
}

async function ensureOutputDevice(ctx: AudioCtx) {
  const deviceId = loadMediaSettings().outputDeviceId;
  if (!deviceId || typeof ctx.setSinkId !== "function") return;
  try {
    await ctx.setSinkId(deviceId);
  } catch {
    /* device may be unavailable */
  }
}

function tone(
  ctx: AudioContext,
  freq: number,
  when: number,
  duration: number,
  peak: number,
  type: OscillatorType = "sine",
) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, when);
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(peak, when + 0.016);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(when);
  osc.stop(when + duration + 0.02);
}

function withCtx(play: (ctx: AudioContext, t: number) => void) {
  if (!voiceSoundsEnabled()) return;
  try {
    const ctx = getContext();
    void ensureOutputDevice(ctx);
    play(ctx, ctx.currentTime + 0.01);
  } catch {
    /* autoplay / AudioContext blocked */
  }
}

/** Soft ascending blips — user joined the lobby. */
export function playVoiceJoinSound() {
  withCtx((ctx, t) => {
    tone(ctx, 587.33, t, 0.1, 0.065, "sine"); // D5
    tone(ctx, 880.0, t + 0.08, 0.13, 0.085, "sine"); // A5
  });
}

/** Lower, slower fall — user left the lobby (clearly different from join). */
export function playVoiceLeaveSound() {
  withCtx((ctx, t) => {
    tone(ctx, 392.0, t, 0.14, 0.08, "triangle"); // G4
    tone(ctx, 293.66, t + 0.12, 0.2, 0.07, "triangle"); // D4
  });
}

/** Brighter rising sparkle — someone started screen sharing. */
export function playScreenShareStartSound() {
  withCtx((ctx, t) => {
    tone(ctx, 659.25, t, 0.07, 0.055, "triangle"); // E5
    tone(ctx, 830.61, t + 0.055, 0.07, 0.065, "triangle"); // G#5
    tone(ctx, 1046.5, t + 0.11, 0.12, 0.075, "triangle"); // C6
  });
}

/** Soft settle down — someone stopped screen sharing. */
export function playScreenShareStopSound() {
  withCtx((ctx, t) => {
    tone(ctx, 987.77, t, 0.08, 0.055, "triangle"); // B5
    tone(ctx, 659.25, t + 0.09, 0.14, 0.06, "triangle"); // E5
  });
}

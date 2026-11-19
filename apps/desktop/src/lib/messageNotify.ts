import {
  loadNotifySoundFile,
  notifySoundEnabled,
} from "./notifySoundPrefs";

let sharedCtx: AudioContext | null = null;
let audioPrimed = false;
let customUrl: string | null = null;
let customBuffer: AudioBuffer | null = null;
let customLoad: Promise<AudioBuffer> | null = null;

export function invalidateNotifySoundCache(): void {
  customUrl = null;
  customBuffer = null;
  customLoad = null;
}

export function primeNotifyAudio(): void {
  if (audioPrimed) return;
  audioPrimed = true;
  try {
    void getContext().resume();
  } catch {
    /* unavailable */
  }
}

function getContext(): AudioContext {
  if (!sharedCtx) {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    sharedCtx = new Ctor();
  }
  if (sharedCtx.state === "suspended") {
    void sharedCtx.resume();
  }
  return sharedCtx;
}

async function playCustomNotify(): Promise<boolean> {
  const file = loadNotifySoundFile();
  if (!file) return false;
  try {
    primeNotifyAudio();
    const ctx = getContext();
    if (customUrl !== file.url || !customBuffer) {
      if (customUrl !== file.url) {
        customUrl = file.url;
        customBuffer = null;
        customLoad = null;
      }
      if (!customLoad) {
        const url = file.url;
        customLoad = fetch(url)
          .then((res) => {
            if (!res.ok) throw new Error("sound unavailable");
            return res.arrayBuffer();
          })
          .then((data) => ctx.decodeAudioData(data.slice(0)))
          .then((buffer) => {
            if (customUrl === url) customBuffer = buffer;
            return buffer;
          });
      }
    }
    const buffer = customBuffer ?? (await customLoad);
    if (!buffer || loadNotifySoundFile()?.url !== file.url) return false;
    const src = ctx.createBufferSource();
    const gain = ctx.createGain();
    src.buffer = buffer;
    gain.gain.setValueAtTime(0.45, ctx.currentTime);
    src.connect(gain);
    gain.connect(ctx.destination);
    src.start();
    return true;
  } catch {
    customBuffer = null;
    customLoad = null;
    return false;
  }
}

function playDefaultMessageChime() {
  const ctx = getContext();
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(880, now);
  osc.frequency.exponentialRampToValueAtTime(660, now + 0.12);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.045, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.24);
}

function playDefaultFriendChime() {
  const ctx = getContext();
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(523.25, now);
  osc.frequency.exponentialRampToValueAtTime(784, now + 0.1);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.05, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.3);
}

/** Soft chime for a new channel or DM message. */
export function playMessageNotify(kind: "channel" | "dm") {
  if (!notifySoundEnabled(kind)) return;
  void playCustomNotify().then((played) => {
    if (played) return;
    try {
      primeNotifyAudio();
      playDefaultMessageChime();
    } catch {
      /* autoplay / AudioContext unavailable */
    }
  });
}

/** Distinct tone for inbound friend requests. */
export function playFriendRequestNotify() {
  if (!notifySoundEnabled("friend")) return;
  void playCustomNotify().then((played) => {
    if (played) return;
    try {
      primeNotifyAudio();
      playDefaultFriendChime();
    } catch {
      /* autoplay / AudioContext unavailable */
    }
  });
}

/** Play the active notification sound from settings, ignoring the category toggles. */
export function previewNotifySound(): void {
  void playCustomNotify().then((played) => {
    if (played) return;
    try {
      primeNotifyAudio();
      playDefaultMessageChime();
    } catch {
      /* autoplay / AudioContext unavailable */
    }
  });
}

const STORAGE_NOTIFY = "eb_notify_sound";

export function messageNotifySoundEnabled(): boolean {
  return localStorage.getItem(STORAGE_NOTIFY) !== "0";
}

let sharedCtx: AudioContext | null = null;
let audioPrimed = false;

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

/** Soft chime for a new text message (respects Appearance → notify sound). */
export function playMessageNotify() {
  if (!messageNotifySoundEnabled()) return;
  try {
    primeNotifyAudio();
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
  } catch {
    /* autoplay / AudioContext unavailable */
  }
}

/** Distinct tone for inbound friend requests. */
export function playFriendRequestNotify() {
  if (!messageNotifySoundEnabled()) return;
  try {
    primeNotifyAudio();
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
  } catch {
    /* autoplay / AudioContext unavailable */
  }
}

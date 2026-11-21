export type MediaSettings = {
  inputDeviceId: string;
  outputDeviceId: string;
  cameraDeviceId: string;
  /** Mic gain percent: 0–200, default 100 */
  inputVolume: number;
  /** Playback volume percent: 0–200, default 100 */
  outputVolume: number;
  /**
   * Open-mic activation threshold 0–100.
   * Higher = less sensitive (needs louder input to “open”).
   */
  micSensitivity: number;
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
  mirrorCamera: boolean;
  /** "voice": open mic (voice activity). "ptt": only while the key is held. */
  inputMode: "voice" | "ptt";
  /** KeyboardEvent.code of the push-to-talk key ("" = not set yet). */
  pttKey: string;
  /** Keep the mic open this long after releasing the key (ms). */
  pttReleaseDelay: number;
};

export const MEDIA_SETTINGS_KEY = "eb_media_settings";
export const MEDIA_SETTINGS_EVENT = "eb-media-settings";

export const DEFAULT_MEDIA_SETTINGS: MediaSettings = {
  inputDeviceId: "",
  outputDeviceId: "",
  cameraDeviceId: "",
  inputVolume: 100,
  outputVolume: 100,
  micSensitivity: 40,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  mirrorCamera: true,
  inputMode: "voice",
  pttKey: "",
  pttReleaseDelay: 150,
};

export function loadMediaSettings(): MediaSettings {
  try {
    const raw = localStorage.getItem(MEDIA_SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_MEDIA_SETTINGS };
    return { ...DEFAULT_MEDIA_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_MEDIA_SETTINGS };
  }
}

export function saveMediaSettings(partial: Partial<MediaSettings>): MediaSettings {
  const next = { ...loadMediaSettings(), ...partial };
  localStorage.setItem(MEDIA_SETTINGS_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(MEDIA_SETTINGS_EVENT, { detail: next }));
  return next;
}

export function subscribeMediaSettings(cb: (s: MediaSettings) => void): () => void {
  const handler = (e: Event) => {
    const detail = (e as CustomEvent<MediaSettings>).detail;
    cb(detail || loadMediaSettings());
  };
  window.addEventListener(MEDIA_SETTINGS_EVENT, handler);
  return () => window.removeEventListener(MEDIA_SETTINGS_EVENT, handler);
}

/**
 * Makes device labels readable. Opens only what is still unlabeled: starting
 * the camera just to list devices is slow (hundreds of ms, light flashes),
 * so it is skipped when labels are already there or there is no camera.
 */
export async function ensureMediaPermissions(): Promise<boolean> {
  const stopAll = (s: MediaStream) => s.getTracks().forEach((t) => t.stop());
  let devices: MediaDeviceInfo[] = [];
  try {
    devices = await navigator.mediaDevices.enumerateDevices();
  } catch {
    /* fall through and ask */
  }
  const unlabeled = (kind: MediaDeviceKind) =>
    devices.some((d) => d.kind === kind && !d.label);
  const needAudio = devices.length === 0 || unlabeled("audioinput");
  const needVideo = unlabeled("videoinput");
  if (!needAudio && !needVideo) return true;
  try {
    stopAll(await navigator.mediaDevices.getUserMedia({ audio: needAudio, video: needVideo }));
    return true;
  } catch {
    if (!needAudio) return true; // camera refused: audio labels are fine
    try {
      stopAll(await navigator.mediaDevices.getUserMedia({ audio: true }));
      return true;
    } catch {
      return false;
    }
  }
}

export async function listMediaDevices(): Promise<{
  audioInputs: MediaDeviceInfo[];
  audioOutputs: MediaDeviceInfo[];
  videoInputs: MediaDeviceInfo[];
}> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return {
    audioInputs: devices.filter((d) => d.kind === "audioinput"),
    audioOutputs: devices.filter((d) => d.kind === "audiooutput"),
    videoInputs: devices.filter((d) => d.kind === "videoinput"),
  };
}

export function audioConstraintsFromSettings(s: MediaSettings): MediaTrackConstraints {
  const c: MediaTrackConstraints = {
    echoCancellation: s.echoCancellation,
    noiseSuppression: s.noiseSuppression,
    autoGainControl: s.autoGainControl,
  };
  if (s.inputDeviceId) c.deviceId = { exact: s.inputDeviceId };
  return c;
}

/** Gain multiplier from input volume percent. */
export function inputGainFromSettings(s: MediaSettings): number {
  return Math.max(0, Math.min(2, s.inputVolume / 100));
}

export function outputGainFromSettings(s: MediaSettings): number {
  return Math.max(0, Math.min(2, s.outputVolume / 100));
}

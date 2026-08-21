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

export async function ensureMediaPermissions(): Promise<boolean> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: true,
    });
    stream.getTracks().forEach((t) => t.stop());
    return true;
  } catch {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
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

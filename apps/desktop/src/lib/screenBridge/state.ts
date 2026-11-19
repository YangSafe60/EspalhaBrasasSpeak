/** IPC / BroadcastChannel message to start or stop a pop-out relay. */
export type ScreenBridgeSignal =
  | { type: "request"; trackSid: string }
  | { type: "stop"; trackSid: string };

/** JPEG snapshot relayed to the pop-out window (raw bytes, not a data URL). */
export type ScreenBridgeFrame = { trackSid: string; jpeg: ArrayBuffer };

export type Unlisten = () => void;

export type RelayEntry = { stop: () => void; viewers: number };

/** Local JPEG preview cap. The LiveKit stream still uses the chosen preset. */
export const ABS_MAX_RELAY_WIDTH = 1280;

/** Registered MediaStreamTrack by LiveKit trackSid (fallback capture path). */
export const tracks = new Map<string, MediaStreamTrack>();

/**
 * Prefer capturing the lobby `<video>` — remote WebRTC tracks often won't
 * decode in an off-DOM clone.
 */
export type CaptureElement = HTMLVideoElement | HTMLImageElement;

export const captureSources = new Map<string, () => CaptureElement | null>();

export const relays = new Map<string, RelayEntry>();

/** Mutable relay host lifecycle (assigned once on first pop-out). */
export const bridgeRuntime = {
  hostReady: null as Promise<void> | null,
  activeRelayViewers: 0,
  signalUnlisten: null as Unlisten | null,
};

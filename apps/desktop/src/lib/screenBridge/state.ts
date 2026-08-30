/** IPC / BroadcastChannel message to start or stop a pop-out relay. */
export type ScreenBridgeSignal =
  | { type: "request"; trackSid: string }
  | { type: "stop"; trackSid: string };

/** JPEG snapshot relayed to the pop-out window. */
export type ScreenBridgeFrame = { trackSid: string; frame: string };

export type Unlisten = () => void;

export type RelayEntry = { stop: () => void; viewers: number };

/** Preserve stream detail up to 4K in pop-out relay. */
export const ABS_MAX_RELAY_WIDTH = 3840;
export const DEFAULT_JPEG_QUALITY = 0.9;
/** Fallback timer when requestVideoFrameCallback is unavailable. */
export const FRAME_INTERVAL_MS = 16;

/** Registered MediaStreamTrack by LiveKit trackSid (fallback capture path). */
export const tracks = new Map<string, MediaStreamTrack>();

/**
 * Prefer capturing the lobby `<video>` — remote WebRTC tracks often won't
 * decode in an off-DOM clone.
 */
export const captureSources = new Map<string, () => HTMLVideoElement | null>();

export const relays = new Map<string, RelayEntry>();

/** Mutable relay host lifecycle (assigned once on first pop-out). */
export const bridgeRuntime = {
  hostReady: null as Promise<void> | null,
  activeRelayViewers: 0,
};

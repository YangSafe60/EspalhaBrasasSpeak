import { useEffect, useRef, useState } from "react";
import { loadMediaSettings, subscribeMediaSettings } from "../lib/mediaSettings";
import type { useVoice } from "./useVoice";

/** Readable name for a KeyboardEvent.code ("KeyV" -> "V", "Backquote" -> "`"). */
export function keyLabel(code: string): string {
  if (!code) return "Not set";
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  const named: Record<string, string> = {
    Backquote: "`",
    Space: "Space",
    CapsLock: "Caps Lock",
    ShiftLeft: "Left Shift",
    ShiftRight: "Right Shift",
    ControlLeft: "Left Ctrl",
    ControlRight: "Right Ctrl",
    AltLeft: "Left Alt",
    AltRight: "Right Alt",
    Tab: "Tab",
  };
  return named[code] ?? code;
}

/**
 * Push-to-talk while the app window is focused: the mic is open only while
 * the chosen key is held (plus a short release delay). Uses the voice host's
 * mic gate, so it never changes the user's mute state. Mouse side buttons
 * (Mouse4/Mouse5) work too.
 */
export function usePushToTalk(voice: ReturnType<typeof useVoice>) {
  const [settings, setSettings] = useState(loadMediaSettings);
  const releaseTimer = useRef<number | null>(null);
  const inCall = voice.connected;

  useEffect(() => subscribeMediaSettings(setSettings), []);

  const ptt = settings.inputMode === "ptt" && Boolean(settings.pttKey);

  useEffect(() => {
    if (!inCall) return;
    // Voice activity: gate always open. Push-to-talk: closed until pressed.
    voice.setMicGate(!ptt);
    if (!ptt) return;

    const clearRelease = () => {
      if (releaseTimer.current != null) window.clearTimeout(releaseTimer.current);
      releaseTimer.current = null;
    };
    const press = () => {
      clearRelease();
      voice.setMicGate(true);
    };
    const release = () => {
      clearRelease();
      releaseTimer.current = window.setTimeout(
        () => voice.setMicGate(false),
        Math.max(0, settings.pttReleaseDelay),
      );
    };
    const isKey = (code: string) => code === settings.pttKey;
    const onDown = (e: KeyboardEvent) => {
      if (isKey(e.code) && !e.repeat) press();
    };
    const onUp = (e: KeyboardEvent) => {
      if (isKey(e.code)) release();
    };
    const mouseCode = (e: MouseEvent) => (e.button === 3 ? "Mouse4" : e.button === 4 ? "Mouse5" : "");
    const onMouseDown = (e: MouseEvent) => {
      if (isKey(mouseCode(e))) press();
    };
    const onMouseUp = (e: MouseEvent) => {
      if (isKey(mouseCode(e))) release();
    };
    // Leaving the window while holding the key must not leave the mic open.
    const onBlur = () => {
      clearRelease();
      voice.setMicGate(false);
    };
    window.addEventListener("keydown", onDown, true);
    window.addEventListener("keyup", onUp, true);
    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("mouseup", onMouseUp, true);
    window.addEventListener("blur", onBlur);
    return () => {
      clearRelease();
      window.removeEventListener("keydown", onDown, true);
      window.removeEventListener("keyup", onUp, true);
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("mouseup", onMouseUp, true);
      window.removeEventListener("blur", onBlur);
    };
    // voice.setMicGate is stable (useCallback with no deps).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inCall, ptt, settings.pttKey, settings.pttReleaseDelay]);
}

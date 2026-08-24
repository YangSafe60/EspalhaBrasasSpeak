import { useEffect, useRef } from "react";
import { useAppStore } from "../store/appStore";

const IDLE_AFTER_MS = 5 * 60 * 1000;

/** If Online and the window stays hidden long enough, switch to Idle; restore Online on return. */
export function useAutoIdlePresence(enabled: boolean) {
  const myStatus = useAppStore((s) => s.myStatus);
  const setMyStatus = useAppStore((s) => s.setMyStatus);
  const autoIdleRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const statusRef = useRef(myStatus);
  statusRef.current = myStatus;

  useEffect(() => {
    if (!enabled) return;

    function clearTimer() {
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    }

    function onHidden() {
      clearTimer();
      if (statusRef.current !== "online") return;
      timerRef.current = window.setTimeout(() => {
        if (document.visibilityState !== "hidden") return;
        if (statusRef.current !== "online") return;
        autoIdleRef.current = true;
        void setMyStatus("idle");
      }, IDLE_AFTER_MS);
    }

    function onVisible() {
      clearTimer();
      if (autoIdleRef.current && statusRef.current === "idle") {
        autoIdleRef.current = false;
        void setMyStatus("online");
      }
    }

    function onVisibility() {
      if (document.visibilityState === "hidden") onHidden();
      else onVisible();
    }

    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearTimer();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, setMyStatus]);
}

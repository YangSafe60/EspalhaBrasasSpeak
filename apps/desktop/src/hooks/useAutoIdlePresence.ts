import { useEffect, useRef } from "react";
import { useAppStore } from "../store/appStore";

/** Switch Online → Idle after this much inactivity. */
const IDLE_AFTER_MS = 15 * 60 * 1000;
const CHECK_EVERY_MS = 30 * 1000;

/**
 * If status is Online and there is no input / focus activity for 15 minutes,
 * switch to Idle. Returning activity restores Online only when we auto-idled
 * (manual Idle / Busy / Offline are left alone).
 */
export function useAutoIdlePresence(enabled: boolean) {
  const myStatus = useAppStore((s) => s.myStatus);
  const setMyStatus = useAppStore((s) => s.setMyStatus);
  const autoIdleRef = useRef(false);
  const lastActiveRef = useRef(Date.now());
  const statusRef = useRef(myStatus);
  statusRef.current = myStatus;

  useEffect(() => {
    if (!enabled) return;

    const bump = () => {
      lastActiveRef.current = Date.now();
      if (autoIdleRef.current && statusRef.current === "idle") {
        autoIdleRef.current = false;
        void setMyStatus("online");
      }
    };

    const check = () => {
      if (statusRef.current !== "online") return;
      if (Date.now() - lastActiveRef.current < IDLE_AFTER_MS) return;
      autoIdleRef.current = true;
      void setMyStatus("idle");
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") bump();
    };

    const activityEvents: Array<keyof WindowEventMap> = [
      "mousemove",
      "mousedown",
      "keydown",
      "wheel",
      "touchstart",
      "pointerdown",
    ];

    for (const ev of activityEvents) {
      window.addEventListener(ev, bump, { passive: true });
    }
    document.addEventListener("visibilitychange", onVisibility);
    const interval = window.setInterval(check, CHECK_EVERY_MS);
    // Catch already-hidden tabs that stay open.
    check();

    return () => {
      for (const ev of activityEvents) {
        window.removeEventListener(ev, bump);
      }
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(interval);
    };
  }, [enabled, setMyStatus]);
}

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import logoMark from "../assets/logo-mark.png";
import { consumeScreenInPopout } from "../lib/screenBridge";

function trackParam(): string {
  return new URLSearchParams(window.location.search).get("track") || "";
}

export function ScreenPopoutApp() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState("Connecting to screen…");
  const [error, setError] = useState<string | null>(null);
  const [hasFrame, setHasFrame] = useState(false);

  useEffect(() => {
    document.documentElement.classList.add("is-screen-popout");
    return () => document.documentElement.classList.remove("is-screen-popout");
  }, []);

  useLayoutEffect(() => {
    const trackSid = trackParam();
    if (!trackSid) {
      setError("Missing track parameter.");
      return;
    }

    const el = canvasRef.current;
    if (!el) return;

    let cleanup: (() => void) | undefined;
    let cancelled = false;
    let gotFrame = false;

    const onLoad = () => {
      if (!gotFrame) {
        gotFrame = true;
        setHasFrame(true);
        setStatus("Live");
      }
    };

    void (async () => {
      try {
        cleanup = await consumeScreenInPopout(trackSid, el, onLoad);
        if (cancelled) {
          cleanup();
          return;
        }
        window.setTimeout(() => {
          if (!cancelled && !gotFrame) {
            setStatus("Waiting for frames…");
          }
        }, 2500);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to receive screen");
      }
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  const showChrome = !hasFrame || !!error;

  return (
    <div className={`screen-popout${showChrome ? " show-chrome" : ""}`}>
      <header className="popout-bar">
        <span className="popout-brand">
          <img src={logoMark} alt="" />
          Espalha Brasas
        </span>
        <span className="muted">{error ? "Error" : status}</span>
      </header>
      {error ? (
        <p className="form-error centered popout-error">{error}</p>
      ) : (
        <canvas
          ref={canvasRef}
          className={`popout-video${hasFrame ? " ready" : ""}`}
        />
      )}
    </div>
  );
}

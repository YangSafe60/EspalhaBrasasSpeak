import { useEffect, useState } from "react";
import logoFull from "../assets/logo-full.png";
import type { AppUpdateEvent } from "../lib/desktop";

const SPARKS = Array.from({ length: 12 }, (_, i) => i);

function applyUpdate(
  payload: AppUpdateEvent | null | undefined,
  setState: (value: AppUpdateEvent | null) => void,
) {
  if (!payload || payload.phase === "idle") {
    setState(null);
    return;
  }
  setState({
    phase: payload.phase,
    percent: payload.percent ?? 0,
    version: payload.version || "",
    error: payload.error,
  });
}

export function UpdateOverlay() {
  const [state, setState] = useState<AppUpdateEvent | null>(null);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onAppUpdate) return;

    void api.getAppUpdate?.().then((payload) => applyUpdate(payload, setState));

    return api.onAppUpdate((payload) => {
      setState((prev) => {
        if (!payload || payload.phase === "idle") return null;
        return {
          phase: payload.phase,
          percent: payload.percent ?? prev?.percent ?? 0,
          version: payload.version || prev?.version || "",
          error: payload.error,
        };
      });
    });
  }, []);

  if (!state) return null;

  const pct = Math.round(state.percent);
  const ready = state.phase === "ready";

  return (
    <div className="update-overlay" role="status" aria-live="polite">
      <div className="update-overlay-card">
        <img className="brand-logo-full boot-logo" src={logoFull} alt="" />
        <div className="brasas-fire" aria-hidden>
          <div className="brasas-glow" />
          <div className="brasas-flame flame-a" />
          <div className="brasas-flame flame-b" />
          <div className="brasas-flame flame-c" />
          <div className="brasas-embers">
            {SPARKS.map((i) => (
              <span key={i} className={`brasas-spark spark-${i}`} />
            ))}
          </div>
          <div className="brasas-logs" />
        </div>
        <h2>{ready ? "Brasas ready" : "Espalhando brasas"}</h2>
        <p className="muted">
          {ready
            ? "Restarting to finish the update…"
            : state.version
              ? `Downloading v${state.version}`
              : "Downloading the latest update…"}
        </p>
        <div
          className="update-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
        >
          <span style={{ width: `${ready ? 100 : pct}%` }} />
        </div>
        <p className="tiny muted">{ready ? "100%" : `${pct}%`}</p>
      </div>
    </div>
  );
}

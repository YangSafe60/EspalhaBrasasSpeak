import { useEffect, useState } from "react";
import { api } from "../api/client";
import { getElectronAPI } from "../lib/desktop";
import {
  MEMORY_SAMPLE_INTERVAL_MS,
  memoryDiagnosticsEnabled,
  onMemoryDiagnosticsChange,
} from "../lib/memoryDiagnostics";

/**
 * While signed in and memory diagnostics are on (User Settings → Voice &
 * Video, or SPEAKAPP_MEM_LOG=1), sends a RAM snapshot of every Electron
 * process to the API every 10 s.
 */
export function useMemoryDiagnostics(signedIn: boolean) {
  const [enabled, setEnabled] = useState(memoryDiagnosticsEnabled);
  const [fromEnv, setFromEnv] = useState(false);

  useEffect(() => onMemoryDiagnosticsChange(() => setEnabled(memoryDiagnosticsEnabled())), []);

  useEffect(() => {
    void getElectronAPI()
      ?.memoryLogFromEnv?.()
      .then((on) => setFromEnv(Boolean(on)))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const desktop = getElectronAPI();
    if (!signedIn || !(enabled || fromEnv) || !desktop?.getMemorySnapshot) return;
    let stopped = false;
    const send = async () => {
      try {
        const snap = await desktop.getMemorySnapshot!();
        if (stopped) return;
        await api("/api/diagnostics/memory", { method: "POST", body: snap });
      } catch {
        /* a missed sample is fine */
      }
    };
    void send();
    const timer = window.setInterval(() => void send(), MEMORY_SAMPLE_INTERVAL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [signedIn, enabled, fromEnv]);
}

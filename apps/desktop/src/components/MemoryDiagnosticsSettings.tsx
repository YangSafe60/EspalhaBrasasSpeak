import { useEffect, useState } from "react";
import { api } from "../api/client";
import { getElectronAPI } from "../lib/desktop";
import {
  memoryDiagnosticsEnabled,
  onMemoryDiagnosticsChange,
  samplesToCsv,
  setMemoryDiagnosticsEnabled,
  type MemorySampleRow,
} from "../lib/memoryDiagnostics";

/** User Settings → Voice & Video: send RAM samples to the server, download them. */
export function MemoryDiagnosticsSettings() {
  const [enabled, setEnabled] = useState(memoryDiagnosticsEnabled);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => onMemoryDiagnosticsChange(() => setEnabled(memoryDiagnosticsEnabled())), []);

  if (!getElectronAPI()?.getMemorySnapshot) return null;

  async function download() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const samples = await api<MemorySampleRow[]>("/api/diagnostics/memory");
      if (!samples.length) {
        setMsg("No samples on the server yet.");
        return;
      }
      const blob = new Blob([samplesToCsv(samples)], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `espalha-brasas-memory-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      setMsg(`Downloaded ${samples.length} samples.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Download failed");
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await api<{ deleted: number }>("/api/diagnostics/memory", { method: "DELETE" });
      setMsg(`Deleted ${res.deleted} samples.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="notify-sound-settings stack">
      <h4 className="notify-sound-settings-title">Memory diagnostics</h4>
      <p className="muted tiny notify-sound-settings-hint">
        Sends the RAM used by each part of the app (chat window, voice, each live) to the server
        every 10 seconds, so you can compare voice-only against watching or sharing a live.
        Samples are kept 7 days and only you can see them.
      </p>
      <label className="toggle-row notify-sound-row">
        <span>
          Send memory samples
          <em className="muted tiny">This device only. Turn off when you are done measuring.</em>
        </span>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setMemoryDiagnosticsEnabled(e.target.checked)}
        />
      </label>
      <div className="row">
        <button type="button" className="btn ghost sm" disabled={busy} onClick={() => void download()}>
          Download CSV
        </button>
        <button type="button" className="btn ghost sm danger-text" disabled={busy} onClick={() => void clear()}>
          Delete samples
        </button>
      </div>
      {msg && <p className="form-ok tiny">{msg}</p>}
      {err && <p className="form-error tiny">{err}</p>}
    </div>
  );
}

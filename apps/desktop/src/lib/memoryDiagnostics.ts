/** Per-device on/off switch for sending memory samples to the server. */

const KEY = "speakapp_memory_diagnostics";
const EVENT = "speakapp:memory-diagnostics";

export const MEMORY_SAMPLE_INTERVAL_MS = 10_000;

export function memoryDiagnosticsEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setMemoryDiagnosticsEnabled(on: boolean): void {
  try {
    if (on) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch {
    /* ignore — the toggle just won't persist */
  }
  window.dispatchEvent(new Event(EVENT));
}

export function onMemoryDiagnosticsChange(handler: () => void): () => void {
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}

export type MemorySampleRow = {
  created_at: string;
  app_version: string | null;
  total_mb: number;
  processes: { kind: string; label: string; mb: number }[];
};

/**
 * One CSV row per sample: time, version, total, then a column per window
 * (main-window, voice-host, screen-host:…, popout) and per unlabelled
 * process type (Browser, GPU, …).
 */
export function samplesToCsv(samples: MemorySampleRow[]): string {
  const key = (p: { kind: string; label: string }) => p.label || p.kind;
  const columns: string[] = [];
  for (const s of samples) {
    for (const p of s.processes) {
      const k = key(p);
      if (!columns.includes(k)) columns.push(k);
    }
  }
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [["time", "version", "total_mb", ...columns].map(esc).join(",")];
  for (const s of samples) {
    const byKey = new Map<string, number>();
    for (const p of s.processes) byKey.set(key(p), (byKey.get(key(p)) ?? 0) + p.mb);
    lines.push(
      [
        s.created_at,
        s.app_version ?? "",
        String(s.total_mb),
        ...columns.map((c) => String(byKey.get(c) ?? "")),
      ]
        .map(esc)
        .join(","),
    );
  }
  return lines.join("\n") + "\n";
}

import type { PresenceStatus } from "../types";

export const PRESENCE_OPTIONS: {
  status: PresenceStatus;
  label: string;
  description: string;
}[] = [
  {
    status: "online",
    label: "Online",
    description: "Available to chat",
  },
  {
    status: "idle",
    label: "Idle",
    description: "Away from keyboard",
  },
  {
    status: "dnd",
    label: "Busy",
    description: "Do not disturb",
  },
  {
    status: "offline",
    label: "Offline",
    description: "Appear offline",
  },
];

export function presenceLabel(status: PresenceStatus): string {
  return PRESENCE_OPTIONS.find((o) => o.status === status)?.label || status;
}

/** Coerce API / WS values to a known presence status. */
export function normalizePresenceStatus(raw: unknown): PresenceStatus {
  const s = String(raw ?? "online").trim().toLowerCase();
  if (s === "idle") return "idle";
  if (s === "dnd" || s === "busy") return "dnd";
  if (s === "offline" || s === "invisible") return "offline";
  return "online";
}

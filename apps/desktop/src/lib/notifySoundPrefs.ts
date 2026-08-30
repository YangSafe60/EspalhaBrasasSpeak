/** Per-category notification sound toggles (Appearance → Notification sounds). */

export type NotifySoundKind = "channel" | "dm" | "friend";

export type NotifySoundPrefs = Record<NotifySoundKind, boolean>;

const STORAGE_KEY = "eb_notify_sounds";
const LEGACY_STORAGE_KEY = "eb_notify_sound";

export const DEFAULT_NOTIFY_SOUND_PREFS: NotifySoundPrefs = {
  channel: true,
  dm: true,
  friend: true,
};

export const NOTIFY_SOUND_LABELS: Record<
  NotifySoundKind,
  { label: string; description: string }
> = {
  channel: {
    label: "Server messages",
    description: "Text channels in servers you belong to.",
  },
  dm: {
    label: "Direct messages",
    description: "Private chats with friends.",
  },
  friend: {
    label: "Friend requests",
    description: "When someone sends you a friend request.",
  },
};

function legacyEnabled(): boolean | null {
  const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
  if (raw === null) return null;
  return raw !== "0";
}

function fromLegacy(enabled: boolean): NotifySoundPrefs {
  return { channel: enabled, dm: enabled, friend: enabled };
}

export function loadNotifySoundPrefs(): NotifySoundPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<NotifySoundPrefs>;
      const legacy = legacyEnabled();
      const fallback = legacy ?? true;
      return {
        channel: parsed.channel ?? fallback,
        dm: parsed.dm ?? fallback,
        friend: parsed.friend ?? fallback,
      };
    }
  } catch {
    /* ignore corrupt prefs */
  }

  const legacy = legacyEnabled();
  if (legacy !== null) return fromLegacy(legacy);
  return { ...DEFAULT_NOTIFY_SOUND_PREFS };
}

export function saveNotifySoundPrefs(prefs: NotifySoundPrefs): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  const anyOn = prefs.channel || prefs.dm || prefs.friend;
  localStorage.setItem(LEGACY_STORAGE_KEY, anyOn ? "1" : "0");
}

export function notifySoundEnabled(kind: NotifySoundKind): boolean {
  return loadNotifySoundPrefs()[kind];
}

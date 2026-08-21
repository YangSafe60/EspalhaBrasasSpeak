const STORAGE_KEY = "speakapp_user_voice_prefs";

export type UserVoicePref = {
  /** Local mute of their microphone for me only */
  muted: boolean;
  /** 0–1 mic volume for me */
  volume: number;
  /** Hide their camera + screen share for me */
  hideVideo: boolean;
};

const DEFAULT: UserVoicePref = {
  muted: false,
  volume: 1,
  hideVideo: false,
};

type Store = Record<string, UserVoicePref>;

function readAll(): Store {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Store;
  } catch {
    return {};
  }
}

function writeAll(store: Store) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

export function getUserVoicePref(userId: string): UserVoicePref {
  const all = readAll();
  return { ...DEFAULT, ...all[userId] };
}

export function setUserVoicePref(
  userId: string,
  patch: Partial<UserVoicePref>,
): UserVoicePref {
  const all = readAll();
  const next = { ...getUserVoicePref(userId), ...patch };
  if (next.volume < 0) next.volume = 0;
  if (next.volume > 1) next.volume = 1;
  all[userId] = next;
  writeAll(all);
  return next;
}

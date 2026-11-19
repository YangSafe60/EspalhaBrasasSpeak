const STORAGE_KEY = "eb_server_notify";

export type ServerNotifyLevel = "all" | "mentions" | "nothing";

export type ServerNotifyPref = {
  level: ServerNotifyLevel;
  suppressEveryone: boolean;
  suppressRoles: boolean;
  suppressHighlights: boolean;
  muteEvents: boolean;
};

export type ServerNotifyMap = Record<string, ServerNotifyPref>;

export const DEFAULT_SERVER_NOTIFY: ServerNotifyPref = {
  level: "all",
  suppressEveryone: false,
  suppressRoles: false,
  suppressHighlights: false,
  muteEvents: false,
};

export function loadServerNotify(): ServerNotifyMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as ServerNotifyMap;
    const next: ServerNotifyMap = {};
    for (const [id, pref] of Object.entries(parsed)) {
      if (!pref || typeof pref !== "object") continue;
      const level =
        pref.level === "mentions" || pref.level === "nothing"
          ? pref.level
          : "all";
      next[id] = {
        level,
        suppressEveryone: Boolean(pref.suppressEveryone),
        suppressRoles: Boolean(pref.suppressRoles),
        suppressHighlights: Boolean(pref.suppressHighlights),
        muteEvents: Boolean(pref.muteEvents),
      };
    }
    return next;
  } catch {
    return {};
  }
}

export function saveServerNotify(map: ServerNotifyMap) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
}

export function serverNotifyOf(
  map: ServerNotifyMap,
  serverId: string,
): ServerNotifyPref {
  return map[serverId] ?? DEFAULT_SERVER_NOTIFY;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mentionsToken(content: string, token: string): boolean {
  if (!token) return false;
  return new RegExp(`(?:^|\\s)@${escapeRegExp(token)}\\b`, "i").test(content);
}

/** Whether a channel message should raise a desktop notification for this server. */
export function serverMessageShouldAlert(
  pref: ServerNotifyPref,
  content: string,
  me: { id: string; username: string; display_name?: string } | null | undefined,
  roles: { id: string; name: string; is_everyone?: boolean }[],
  myRoleIds: string[],
): boolean {
  if (pref.level === "nothing") return false;
  if (pref.level === "all") return true;

  const text = content || "";
  const everyone =
    /(?:^|\s)@everyone\b/i.test(text) || /(?:^|\s)@here\b/i.test(text);
  if (everyone && !pref.suppressEveryone) return true;

  if (me && mentionsToken(text, me.username)) return true;
  if (
    me?.display_name &&
    me.display_name !== me.username &&
    !pref.suppressHighlights &&
    mentionsToken(text, me.display_name)
  ) {
    return true;
  }

  if (!pref.suppressRoles) {
    const held = new Set(
      myRoleIds.map((id) => id.replace(/-/g, "").toLowerCase()),
    );
    for (const role of roles) {
      if (role.is_everyone || role.name === "@everyone") continue;
      const key = role.id.replace(/-/g, "").toLowerCase();
      if (!held.has(key)) continue;
      if (mentionsToken(text, role.name) || text.includes(`<@&${role.id}>`)) {
        return true;
      }
    }
  }

  return false;
}

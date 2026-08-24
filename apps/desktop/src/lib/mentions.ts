import { createElement, type ReactNode } from "react";
import type { Role, UserPublic } from "../types";

const UUID_RE =
  "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";

export type MentionUser = Pick<UserPublic, "id" | "username" | "display_name">;

export type MentionContext = {
  members: MentionUser[];
  roles: Role[];
  me?: MentionUser | null;
  myRoleIds?: string[];
};

export type MentionSuggestion =
  | { kind: "everyone" }
  | { kind: "here" }
  | { kind: "user"; user: MentionUser }
  | { kind: "role"; role: Role };

function sameId(a: string, b: string): boolean {
  return a.replace(/-/g, "").toLowerCase() === b.replace(/-/g, "").toLowerCase();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Insert string for autocomplete selection. */
export function mentionInsertText(item: MentionSuggestion): string {
  switch (item.kind) {
    case "everyone":
      return "@everyone";
    case "here":
      return "@here";
    case "user":
      return `@${item.user.username}`;
    case "role":
      if (/^[\w-]+$/u.test(item.role.name) && !/^everyone$/i.test(item.role.name)) {
        return `@${item.role.name}`;
      }
      return `<@&${item.role.id}>`;
  }
}

export function filterMentionSuggestions(
  query: string,
  members: MentionUser[],
  roles: Role[],
  opts?: { allowEveryone?: boolean },
): MentionSuggestion[] {
  const q = query.trim().toLowerCase();
  const allowEveryone = opts?.allowEveryone !== false;

  const rankUser = (u: MentionUser): number => {
    if (!q) return 0;
    const un = u.username.toLowerCase();
    const dn = (u.display_name || "").toLowerCase();
    if (un.startsWith(q) || dn.startsWith(q)) return 0;
    if (un.includes(q) || dn.includes(q)) return 1;
    return 99;
  };

  const users = members
    .filter((u) => rankUser(u) < 99)
    .sort((a, b) => {
      const ra = rankUser(a);
      const rb = rankUser(b);
      if (ra !== rb) return ra - rb;
      return (a.display_name || a.username).localeCompare(
        b.display_name || b.username,
      );
    })
    .slice(0, 12)
    .map((user): MentionSuggestion => ({ kind: "user", user }));

  const roleHits = roles
    .filter((r) => !r.is_everyone)
    .filter((r) => {
      if (!q) return true;
      const name = r.name.toLowerCase();
      return name.startsWith(q) || name.includes(q);
    })
    .sort((a, b) => a.position - b.position)
    .slice(0, 6)
    .map((role): MentionSuggestion => ({ kind: "role", role }));

  const specials: MentionSuggestion[] = [];
  if (allowEveryone) {
    if (!q || "everyone".startsWith(q)) specials.push({ kind: "everyone" });
    if (!q || "here".startsWith(q)) specials.push({ kind: "here" });
  }

  // People first, then roles, then @everyone / @here.
  return [...users, ...roleHits, ...specials].slice(0, 14);
}

/** True when this message pings the current user. */
export function messageMentionsMe(
  content: string,
  ctx: MentionContext,
): boolean {
  if (!content || !ctx.me) return false;
  const me = ctx.me;
  const myRoles = new Set(
    (ctx.myRoleIds || []).map((id) => id.replace(/-/g, "").toLowerCase()),
  );

  const userTok = new RegExp(`<@!?(${UUID_RE})>`, "gi");
  let m: RegExpExecArray | null;
  while ((m = userTok.exec(content))) {
    if (sameId(m[1], me.id)) return true;
  }

  const roleTok = new RegExp(`<@&(${UUID_RE})>`, "gi");
  while ((m = roleTok.exec(content))) {
    if (myRoles.has(m[1].replace(/-/g, "").toLowerCase())) return true;
  }

  if (/(^|[^\w])@everyone\b/i.test(content)) return true;
  if (/(^|[^\w])@here\b/i.test(content)) return true;

  const userRe = new RegExp(
    `(^|[^\\w])@${escapeRegExp(me.username)}(?![\\w-])`,
    "i",
  );
  if (userRe.test(content)) return true;

  const myRoleNames = ctx.roles
    .filter((r) => myRoles.has(r.id.replace(/-/g, "").toLowerCase()))
    .map((r) => r.name)
    .sort((a, b) => b.length - a.length);
  for (const name of myRoleNames) {
    if (!name || /^everyone$/i.test(name)) continue;
    const re = new RegExp(`(^|[^\\w])@${escapeRegExp(name)}(?![\\w-])`, "i");
    if (re.test(content)) return true;
  }

  return false;
}

type Hit = {
  start: number;
  end: number;
  label: string;
  className: string;
};

function collectHits(text: string, ctx: MentionContext): Hit[] {
  const hits: Hit[] = [];
  const push = (
    start: number,
    end: number,
    label: string,
    className: string,
  ) => {
    if (hits.some((h) => !(end <= h.start || start >= h.end))) return;
    hits.push({ start, end, label, className });
  };

  const structured = new RegExp(`<@!?(${UUID_RE})>|<@&(${UUID_RE})>`, "gi");
  let m: RegExpExecArray | null;
  while ((m = structured.exec(text))) {
    if (m[1]) {
      const user =
        ctx.members.find((u) => sameId(u.id, m![1])) ||
        (ctx.me && sameId(ctx.me.id, m[1]) ? ctx.me : null);
      const isMe = Boolean(ctx.me && sameId(ctx.me.id, m[1]));
      push(
        m.index,
        m.index + m[0].length,
        `@${user?.username || "user"}`,
        `mention${isMe ? " is-me" : ""}`,
      );
    } else if (m[2]) {
      const role = ctx.roles.find((r) => sameId(r.id, m![2]));
      const isMe = Boolean(ctx.myRoleIds?.some((id) => sameId(id, m![2])));
      push(
        m.index,
        m.index + m[0].length,
        `@${role?.name || "role"}`,
        `mention mention-role${isMe ? " is-me" : ""}`,
      );
    }
  }

  const specials = /(?:^|[^\w])(@everyone|@here)\b/gi;
  while ((m = specials.exec(text))) {
    const token = m[1];
    const at = m[0].indexOf("@") + m.index;
    push(at, at + token.length, token, "mention mention-everyone is-me");
  }

  const names: { label: string; match: string; className: string }[] = [];
  for (const u of ctx.members) {
    names.push({
      label: `@${u.username}`,
      match: u.username,
      className: `mention${ctx.me && sameId(ctx.me.id, u.id) ? " is-me" : ""}`,
    });
  }
  for (const r of ctx.roles) {
    if (r.is_everyone) continue;
    const isMe = Boolean(ctx.myRoleIds?.some((id) => sameId(id, r.id)));
    names.push({
      label: `@${r.name}`,
      match: r.name,
      className: `mention mention-role${isMe ? " is-me" : ""}`,
    });
  }
  names.sort((a, b) => b.match.length - a.match.length);

  for (const n of names) {
    const re = new RegExp(
      `(^|[^\\w/@])@(${escapeRegExp(n.match)})(?![\\w-])`,
      "gi",
    );
    while ((m = re.exec(text))) {
      const prefix = m[1] || "";
      const at = m.index + prefix.length;
      push(at, at + 1 + m[2].length, n.label, n.className);
    }
  }

  return hits.sort((a, b) => a.start - b.start);
}

/** Turn plain text into nodes with mention pills. */
export function renderTextWithMentions(
  text: string,
  ctx: MentionContext | undefined,
  keyPrefix: string,
): ReactNode[] {
  if (!text) return [];
  if (!ctx) return [text];

  const hits = collectHits(text, ctx);
  if (hits.length === 0) return [text];

  const nodes: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const h of hits) {
    if (h.start < last) continue;
    if (h.start > last) nodes.push(text.slice(last, h.start));
    nodes.push(
      createElement(
        "span",
        { key: `${keyPrefix}-m-${key++}`, className: h.className },
        h.label,
      ),
    );
    last = h.end;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

/** Find `@query` immediately before cursor for autocomplete. */
export function mentionQueryAtCursor(
  value: string,
  cursor: number,
): { start: number; query: string } | null {
  const before = value.slice(0, cursor);
  // Letters (incl. accents), numbers, _ and - after @
  const m = before.match(/(^|[\s([{])@([\p{L}\p{N}_-]*)$/u);
  if (!m) return null;
  const at = before.length - m[2].length - 1;
  return { start: at, query: m[2] };
}

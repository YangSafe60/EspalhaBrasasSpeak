/**
 * Server / channel invites sent as a DM message. DMs are end-to-end
 * encrypted, so the inviter's app sends a small marker as the message text
 * and both apps draw it as an invite card.
 *
 *   [[invite:server:<serverId>]]
 *   [[invite:channel:<serverId>:<channelId>]]
 */
export type DmInvite =
  | { kind: "server"; serverId: string }
  | { kind: "channel"; serverId: string; channelId: string };

const ID = "[0-9a-fA-F-]{36}";
const RE = new RegExp(`^\\[\\[invite:(?:server:(${ID})|channel:(${ID}):(${ID}))\\]\\]$`);

export function serverInviteMessage(serverId: string): string {
  return `[[invite:server:${serverId}]]`;
}

export function channelInviteMessage(serverId: string, channelId: string): string {
  return `[[invite:channel:${serverId}:${channelId}]]`;
}

export function parseInviteMessage(content: string | null | undefined): DmInvite | null {
  const m = RE.exec((content || "").trim());
  if (!m) return null;
  if (m[1]) return { kind: "server", serverId: m[1] };
  return { kind: "channel", serverId: m[2], channelId: m[3] };
}

/** Notification / list preview for an invite message. */
export function invitePreview(content: string): string | null {
  const inv = parseInviteMessage(content);
  if (!inv) return null;
  return inv.kind === "server" ? "Sent you a server invite" : "Sent you a channel invite";
}

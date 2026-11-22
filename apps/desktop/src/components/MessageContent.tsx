import { createElement, Fragment, useEffect, useMemo } from "react";
import { renderMarkdown } from "../lib/markdown";
import { renderMessageContent } from "../lib/customEmoji";
import type { MentionContext } from "../lib/mentions";
import { useAppStore } from "../store/appStore";
import type { Member, Role } from "../types";

const EMPTY_MEMBERS: Member[] = [];
const EMPTY_ROLES: Role[] = [];

type Props = {
  content: string;
  className?: string;
  children?: React.ReactNode;
  /** Prefer active server; override for DMs (no roles). */
  serverId?: string | null;
};

export function MessageContent({
  content,
  className,
  children,
  serverId,
}: Props) {
  const customEmojisById = useAppStore((s) => s.customEmojisById);
  const resolveCustomEmojis = useAppStore((s) => s.resolveCustomEmojis);
  const activeServerId = useAppStore((s) => s.activeServerId);
  const sid = serverId === undefined ? activeServerId : serverId;
  // Select only this server's lists (stable empty fallbacks), so presence or
  // member changes in other servers don't re-render every message.
  const members = useAppStore((s) => (sid ? s.membersByServer[sid] : undefined) ?? EMPTY_MEMBERS);
  const roles = useAppStore((s) => (sid ? s.rolesByServer[sid] : undefined) ?? EMPTY_ROLES);
  const user = useAppStore((s) => s.user);

  const meMember = useMemo(
    () => members.find((m) => m.user.id === user?.id),
    [members, user?.id],
  );

  const mentionCtx = useMemo((): MentionContext | undefined => {
    if (!user && members.length === 0 && roles.length === 0) return undefined;
    return {
      members: members.map((m) => m.user),
      roles,
      me: user,
      myRoleIds: meMember?.role_ids,
    };
  }, [members, roles, user, meMember?.role_ids]);

  useEffect(() => {
    void resolveCustomEmojis(content);
  }, [content, resolveCustomEmojis]);

  const nodes = useMemo(
    () =>
      renderMarkdown(content, (text, key) => [
        createElement(Fragment, { key }, ...renderMessageContent(text, customEmojisById, mentionCtx)),
      ]),
    [content, customEmojisById, mentionCtx],
  );

  // A div (not p): formatted messages can hold code blocks and quotes.
  return (
    <div className={className ?? "message-content"}>
      {nodes}
      {children}
    </div>
  );
}

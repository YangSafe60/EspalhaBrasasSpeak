import { useEffect, useMemo } from "react";
import { renderMessageContent } from "../lib/customEmoji";
import type { MentionContext } from "../lib/mentions";
import { useAppStore } from "../store/appStore";

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
  const membersByServer = useAppStore((s) => s.membersByServer);
  const rolesByServer = useAppStore((s) => s.rolesByServer);
  const user = useAppStore((s) => s.user);

  const sid = serverId === undefined ? activeServerId : serverId;
  const members = sid ? membersByServer[sid] || [] : [];
  const roles = sid ? rolesByServer[sid] || [] : [];
  const meMember = members.find((m) => m.user.id === user?.id);

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
    () => renderMessageContent(content, customEmojisById, mentionCtx),
    [content, customEmojisById, mentionCtx],
  );

  return (
    <p className={className ?? "message-content"}>
      {nodes}
      {children}
    </p>
  );
}

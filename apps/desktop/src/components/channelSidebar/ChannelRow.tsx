import type { DragEvent, MouseEvent } from "react";
import { mediaCssUrl } from "../../lib/mediaUrl";
import {
  effectiveChannelPerms,
  hasPerm,
  isChannelLocked,
  Perm,
} from "../../lib/serverPerms";
import type {
  Channel,
  Member,
  PermissionOverwrite,
  Role,
  Server,
  VoiceStateView,
} from "../../types";
import { VoiceChannelIcon } from "../VoiceChannelIcon";
import type { DragPayload, DropHint } from "./types";

export type VoiceUserRow = VoiceStateView & { name: string };

export type ChannelRowProps = {
  channel: Channel;
  active: boolean;
  inVoice: boolean;
  muted: boolean;
  unread: number;
  muteLabel: string | null;
  limitLabel: string;
  locked: boolean;
  canManageChannels: boolean;
  canManageThisChannel: boolean;
  canInvitePeople: boolean;
  isDragOver: boolean;
  isDraggingSelf: boolean;
  voiceUsers: VoiceUserRow[];
  speakingIds: string[];
  activeServerId: string | null;
  avatarForUser: (userId: string) => string | null;
  onJoinVoice: (channelId: string) => void;
  onSelectText: (channelId: string) => void;
  onInvite: (channelId: string) => void;
  onOpenSettings: (e: MouseEvent, channelId: string) => void;
  onContextMenu: (e: MouseEvent, channel: Channel) => void;
  onOpenMiniProfile: (opts: {
    userId: string;
    serverId: string | null;
    x: number;
    y: number;
  }) => void;
  onUserContextMenu: (e: MouseEvent, userId: string, name: string) => void;
  draggable: boolean;
  onDragStart: (kind: DragPayload["kind"], id: string, e: DragEvent) => void;
  onDragEnd: () => void;
  onDragOver: (e: DragEvent, hint: DropHint) => void;
  onDrop: (e: DragEvent, hint: DropHint) => void;
  guardClick: () => boolean;
};

/** Single text or voice channel row (with optional connected voice user list). */
export function ChannelRow({
  channel: ch,
  active,
  inVoice,
  muted,
  unread,
  muteLabel,
  limitLabel,
  locked,
  canManageThisChannel,
  canInvitePeople,
  isDragOver,
  isDraggingSelf,
  voiceUsers,
  speakingIds,
  activeServerId,
  avatarForUser,
  onJoinVoice,
  onSelectText,
  onInvite,
  onOpenSettings,
  onContextMenu,
  onOpenMiniProfile,
  onUserContextMenu,
  draggable,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  guardClick,
}: ChannelRowProps) {
  const row = (
    <div
      className={`channel-row ${inVoice ? "connected" : ""} ${active ? "active" : ""} ${muted ? "muted-channel" : ""} ${unread ? "has-unread" : ""} ${isDragOver ? "drop-before" : ""} ${isDraggingSelf ? "is-dragging" : ""}`}
      draggable={draggable}
      onDragStart={(e) => onDragStart("channel", ch.id, e)}
      onDragEnd={onDragEnd}
      onDragOver={(e) =>
        onDragOver(e, {
          zone: "channel-before",
          channelId: ch.id,
          categoryId: ch.category_id,
        })
      }
      onDrop={(e) =>
        onDrop(e, {
          zone: "channel-before",
          channelId: ch.id,
          categoryId: ch.category_id,
        })
      }
      onContextMenu={(e) => onContextMenu(e, ch)}
    >
      <button
        type="button"
        className={`channel-btn ${ch.channel_type === "voice" ? "voice" : ""} ${inVoice ? "connected" : ""} ${active ? "active" : ""}`}
        title={muteLabel || undefined}
        onClick={() => {
          if (guardClick()) return;
          if (ch.channel_type === "voice") onJoinVoice(ch.id);
          else onSelectText(ch.id);
        }}
      >
        <span
          className={`ch-icon${locked ? " is-locked" : ""}`}
          aria-label={locked ? "Private channel" : undefined}
        >
          {ch.channel_type === "voice" ? <VoiceChannelIcon size={15} /> : "#"}
          {locked ? (
            <svg className="ch-lock" viewBox="0 0 24 24" width="10" height="10" aria-hidden>
              <path
                fill="currentColor"
                d="M17 8h-1V6a4 4 0 1 0-8 0v2H7a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2zm-7-2a2 2 0 1 1 4 0v2h-4V6zm7 13H7v-9h10v9z"
              />
            </svg>
          ) : null}
        </span>
        <span className="channel-name">
          {ch.name}
          {limitLabel}
        </span>
        {muted && (
          <span className="channel-mute-icon" title={muteLabel || "Muted"} aria-label="Muted">
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden>
              <path
                fill="currentColor"
                d="M12 22c1.1 0 2-.9 2-2h-4a2 2 0 0 0 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4a1.5 1.5 0 0 0-3 0v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2zm-2.04 1.5H8.04L8 16.04V11c0-2.48 1.51-4.5 4-4.5s4 2.02 4 4.5v5.04l-.04.46zM4.27 3 3 4.27l6.01 6.01 1.41 1.41 8.49 8.49L20.18 19l-5.46-5.46L4.27 3z"
              />
            </svg>
          </span>
        )}
        {unread > 0 && (
          <span className="channel-unread" aria-label={`${unread} unread`}>
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      {canInvitePeople && (
        <button
          type="button"
          className="channel-invite"
          title="Invite people"
          onClick={(e) => {
            e.stopPropagation();
            onInvite(ch.id);
          }}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
            <path
              fill="currentColor"
              d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm0 2c-3.33 0-8 1.67-8 5v1h16v-1c0-3.33-4.67-5-8-5z"
            />
            <path fill="currentColor" d="M19 8h-2v2h-2v2h2v2h2v-2h2v-2h-2z" />
          </svg>
        </button>
      )}
      {canManageThisChannel && (
        <button
          type="button"
          className="channel-gear"
          title="Edit channel"
          onClick={(e) => onOpenSettings(e, ch.id)}
        >
          ⚙
        </button>
      )}
    </div>
  );

  if (ch.channel_type === "voice") {
    return (
      <div key={ch.id} className="channel-block">
        {row}
        {voiceUsers.length > 0 && (
          <ul className="voice-users">
            {voiceUsers.map((u) => {
              const avatar = avatarForUser(u.user_id);
              return (
                <li
                  key={u.user_id}
                  className={`${u.streaming ? "live" : ""}${speakingIds.includes(u.user_id) ? " speaking" : ""}`}
                  onClick={(e) =>
                    onOpenMiniProfile({
                      userId: u.user_id,
                      serverId: activeServerId,
                      x: e.clientX,
                      y: e.clientY,
                    })
                  }
                  onContextMenu={(e) => onUserContextMenu(e, u.user_id, u.name)}
                >
                  <span
                    className={`voice-user-avatar${speakingIds.includes(u.user_id) ? " speaking" : ""}`}
                    style={
                      avatar ? { backgroundImage: mediaCssUrl(avatar) } : undefined
                    }
                  >
                    {!avatar && (u.name.charAt(0) || "?").toUpperCase()}
                  </span>
                  <span className="voice-user-name">{u.name}</span>
                  <span className="voice-user-flags">
                    {u.streaming && (
                      <span className="vu-flag live" title="Screen sharing">
                        LIVE
                      </span>
                    )}
                    {u.muted && (
                      <span className="vu-flag mute" title="Muted">
                        <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden fill="currentColor">
                          <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3 3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z" />
                        </svg>
                      </span>
                    )}
                    {u.deafened && (
                      <span className="vu-flag deaf" title="Deafened">
                        <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden fill="currentColor">
                          <path d="M12 3c-4.97 0-9 4.03-9 9v4c0 1.1.9 2 2 2h2v-8c0-2.76 2.24-5 5-5s5 2.24 5 5v8h2c1.1 0 2-.9 2-2v-4c0-4.97-4.03-9-9-9z" />
                        </svg>
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  }

  return <div key={ch.id}>{row}</div>;
}

/** Resolve whether a channel row should show the lock icon. */
export function channelRowLocked(
  overwrites: PermissionOverwrite[],
  roles: Role[],
  channel: Channel,
): boolean {
  return isChannelLocked(overwrites, roles, channel.channel_type);
}

/** Whether the current member can manage a specific channel. */
export function canManageChannelRow(
  server: Server | undefined,
  roles: Role[],
  me: Member | undefined,
  userId: string | undefined,
  overwrites: PermissionOverwrite[],
): boolean {
  return hasPerm(
    effectiveChannelPerms(server, roles, me, userId, overwrites),
    Perm.MANAGE_CHANNELS,
  );
}

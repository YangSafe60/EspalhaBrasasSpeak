export type ChannelType = "text" | "voice" | "category";
export type PresenceStatus = "online" | "idle" | "dnd" | "offline";
export type Atmosphere = "focus" | "chill" | "gaming";

export interface UserPublic {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  created_at: string;
}

export interface Server {
  id: string;
  name: string;
  icon_url: string | null;
  banner_url: string | null;
  owner_id: string;
  accent_color: string;
  invite_splash_url: string | null;
  created_at: string;
}

export interface Role {
  id: string;
  server_id: string;
  name: string;
  color: string;
  gradient: string | null;
  position: number;
  permissions: number;
  is_everyone: boolean;
}

export interface Channel {
  id: string;
  server_id: string;
  category_id: string | null;
  name: string;
  channel_type: ChannelType;
  position: number;
  topic: string | null;
  background_url: string | null;
  background_blur: number;
  background_dim: number;
  text_color: string | null;
  atmosphere: string | null;
  user_limit: number;
}

export interface PermissionOverwrite {
  id: string;
  channel_id: string;
  target_type: "role" | "member";
  allow: number;
  deny: number;
  target_id: string;
}

export interface ServerRule {
  id: string;
  server_id: string;
  title: string;
  body: string;
  position: number;
}

export interface Attachment {
  id: string;
  message_id: string;
  filename: string;
  content_type: string;
  size: number;
  url: string;
}

export interface ReactionSummary {
  emoji: string;
  count: number;
  me: boolean;
}

export interface Message {
  id: string;
  channel_id: string;
  author_id: string;
  content: string;
  reply_to_id: string | null;
  edited_at: string | null;
  created_at: string;
  attachments: Attachment[];
  reactions: ReactionSummary[];
}

export interface Invite {
  code: string;
  server_id: string;
  creator_id: string;
  max_uses: number | null;
  uses: number;
  expires_at: string | null;
}

export interface Member {
  user: UserPublic;
  server_id: string;
  nickname: string | null;
  role_ids: string[];
  joined_at: string;
  accepted_rules: boolean;
}

export interface BanInfo {
  user_id: string;
  reason: string | null;
  banned_by: string;
  created_at: string;
}

export interface AuthResponse {
  access_token: string;
  refresh_token: string;
  user: UserPublic;
}

export interface VoiceTokenResponse {
  token: string;
  url: string;
  room: string;
}

export interface VoiceStateView {
  user_id: string;
  channel_id: string | null;
  muted: boolean;
  deafened: boolean;
  streaming: boolean;
}

export interface UploadResponse {
  id: string;
  url: string;
  filename: string;
  content_type: string;
  size: number;
}

export type WsEvent =
  | { type: "ready"; user: UserPublic; servers: Server[] }
  | { type: "message_create"; message: Message; author: UserPublic }
  | { type: "message_update"; message: Message }
  | { type: "message_delete"; channel_id: string; message_id: string }
  | { type: "typing_start"; channel_id: string; user_id: string; username: string }
  | { type: "presence_update"; user_id: string; status: PresenceStatus }
  | {
      type: "voice_state_update";
      channel_id: string | null;
      user_id: string;
      muted: boolean;
      deafened: boolean;
      streaming: boolean;
    }
  | { type: "channel_create"; channel: Channel }
  | { type: "channel_update"; channel: Channel }
  | { type: "channel_delete"; server_id: string; channel_id: string }
  | { type: "server_update"; server: Server }
  | { type: "member_join"; member: Member }
  | { type: "member_leave"; server_id: string; user_id: string }
  | {
      type: "reaction_add";
      channel_id: string;
      message_id: string;
      emoji: string;
      user_id: string;
    }
  | {
      type: "reaction_remove";
      channel_id: string;
      message_id: string;
      emoji: string;
      user_id: string;
    };

export const Perm = {
  VIEW_CHANNEL: 1 << 0,
  SEND_MESSAGES: 1 << 1,
  MANAGE_MESSAGES: 1 << 2,
  CONNECT: 1 << 3,
  SPEAK: 1 << 4,
  STREAM: 1 << 5,
  MUTE_MEMBERS: 1 << 6,
  MOVE_MEMBERS: 1 << 7,
  MANAGE_CHANNELS: 1 << 8,
  MANAGE_ROLES: 1 << 9,
  MANAGE_SERVER: 1 << 10,
  KICK_MEMBERS: 1 << 11,
  BAN_MEMBERS: 1 << 12,
  CREATE_INVITE: 1 << 13,
  ATTACH_FILES: 1 << 14,
  ADD_REACTIONS: 1 << 15,
  MENTION_EVERYONE: 1 << 16,
} as const;

/** Discord-style role permission checklist (server-wide). */
export const ROLE_PERM_GROUPS: {
  title: string;
  perms: { bit: number; label: string; description: string }[];
}[] = [
  {
    title: "General",
    perms: [
      {
        bit: Perm.VIEW_CHANNEL,
        label: "View Channels",
        description: "Allow members to view channels by default (unless a channel denies it).",
      },
      {
        bit: Perm.MANAGE_CHANNELS,
        label: "Manage Channels",
        description: "Allow members to create, edit, or delete channels.",
      },
      {
        bit: Perm.MANAGE_ROLES,
        label: "Manage Roles",
        description: "Allow members to create and edit roles below theirs, and channel permissions.",
      },
      {
        bit: Perm.MANAGE_SERVER,
        label: "Manage Server",
        description: "Allow members to change this server’s name, icon, and banner.",
      },
      {
        bit: Perm.CREATE_INVITE,
        label: "Create Invite",
        description: "Allow members to invite people to this server.",
      },
      {
        bit: Perm.KICK_MEMBERS,
        label: "Kick Members",
        description: "Allow members to remove other members from this server.",
      },
      {
        bit: Perm.BAN_MEMBERS,
        label: "Ban Members",
        description: "Allow members to permanently ban other members.",
      },
    ],
  },
  {
    title: "Text",
    perms: [
      {
        bit: Perm.SEND_MESSAGES,
        label: "Send Messages",
        description: "Allow members to send messages in text channels.",
      },
      {
        bit: Perm.MANAGE_MESSAGES,
        label: "Manage Messages",
        description: "Allow members to delete or pin messages by others.",
      },
      {
        bit: Perm.ATTACH_FILES,
        label: "Attach Files",
        description: "Allow members to upload images and files.",
      },
      {
        bit: Perm.ADD_REACTIONS,
        label: "Add Reactions",
        description: "Allow members to add emoji reactions to messages.",
      },
      {
        bit: Perm.MENTION_EVERYONE,
        label: "Mention @everyone",
        description: "Allow members to use @everyone / @here mentions.",
      },
    ],
  },
  {
    title: "Voice",
    perms: [
      {
        bit: Perm.CONNECT,
        label: "Connect",
        description: "Allow members to join voice channels and listen.",
      },
      {
        bit: Perm.SPEAK,
        label: "Speak",
        description: "Allow members to talk in voice channels.",
      },
      {
        bit: Perm.STREAM,
        label: "Video / Screen Share",
        description: "Allow members to share camera or screen.",
      },
      {
        bit: Perm.MUTE_MEMBERS,
        label: "Mute Members",
        description: "Allow members to mute others in voice channels.",
      },
      {
        bit: Perm.MOVE_MEMBERS,
        label: "Move Members",
        description: "Allow members to move others between voice channels.",
      },
    ],
  },
];

export const ATMOSPHERE_PRESETS: Record<
  Atmosphere,
  { blur: number; dim: number; label: string }
> = {
  focus: { blur: 12, dim: 0.62, label: "Focus" },
  chill: { blur: 6, dim: 0.38, label: "Chill" },
  gaming: { blur: 2, dim: 0.28, label: "Gaming" },
};

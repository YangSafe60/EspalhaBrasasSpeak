import type {
  Channel,
  DmChannel,
  DmMessage,
  Friendship,
  Invite,
  Member,
  Message,
  MessageToast,
  PermissionOverwrite,
  PresenceStatus,
  Role,
  Server,
  ServerEmoji,
  ServerRule,
  UserAccount,
  UserPublic,
  VoiceStateView,
  DmCallParticipant,
  WsEvent,
} from "../types";
import type { ChannelMuteMap } from "../lib/channelMutePrefs";

export type ModalKind =
  | null
  | "create-server"
  | "join-invite"
  | "invite-people"
  | "server-settings"
  | "channel-settings"
  | "user-settings";

export type MiniProfileState = {
  userId: string;
  /** When set, show that member's roles on this server. */
  serverId: string | null;
  x: number;
  y: number;
};

export type TypingEntry = { username: string; expires: number };

export interface AppState {
  user: UserAccount | null;
  servers: Server[];
  channelsByServer: Record<string, Channel[]>;
  membersByServer: Record<string, Member[]>;
  rolesByServer: Record<string, Role[]>;
  rulesByServer: Record<string, ServerRule[]>;
  /** channelId → permission overwrites (for private/lock badges). */
  overwritesByChannel: Record<string, PermissionOverwrite[]>;
  messagesByChannel: Record<string, Message[]>;
  authors: Record<string, UserPublic>;
  /** Custom emojis from all joined servers (for picker + cross-server use). */
  customEmojis: ServerEmoji[];
  customEmojisById: Record<string, ServerEmoji>;
  voiceStates: VoiceStateView[];
  typing: Record<string, TypingEntry[]>;
  presenceByUser: Record<string, PresenceStatus>;
  /** My chosen status (offline = invisible while connected). */
  myStatus: PresenceStatus;
  /** Bumped on each manual status change so stale loads cannot overwrite. */
  myStatusRevision: number;

  friendsHome: boolean;
  friends: Friendship[];
  pendingInbound: Friendship[];
  pendingOutbound: Friendship[];
  dmChannels: DmChannel[];
  messagesByDm: Record<string, DmMessage[]>;
  activeDmId: string | null;
  identityPublicKey: string | null;
  e2eIdentityMissing: boolean;
  peerPublicKeys: Record<string, string>;
  dmFingerprints: Record<string, string>;

  activeServerId: string | null;
  activeChannelId: string | null;
  voiceChannelId: string | null;
  dmCallId: string | null;
  /** Who is currently in each DM voice call. */
  dmCallByChannel: Record<string, DmCallParticipant[]>;
  muted: boolean;
  deafened: boolean;
  streaming: boolean;

  modal: ModalKind;
  settingsChannelId: string | null;
  /** When opening invite-people from a channel row. */
  inviteChannelId: string | null;
  miniProfile: MiniProfileState | null;
  /** Insert text into a channel composer (e.g. @mention from member menu). */
  pendingComposerInsert: { channelId: string; text: string } | null;
  /** Join voice from member menu "Start call" (consumed by App). */
  pendingVoiceJoinChannelId: string | null;
  /** Join a private DM call (consumed by App). */
  pendingDmCallJoinId: string | null;
  /** Shown when a friend invites you into a server. */
  pendingServerInvite: {
    server: Server;
    invited_by: UserPublic;
    member_count: number;
    online_count: number;
  } | null;
  /** Shown when invited to a specific channel. */
  pendingChannelInvite: {
    server: Server;
    channel: Channel;
    invited_by: UserPublic;
    member_count: number;
    online_count: number;
  } | null;
  /** channelId → mutedUntil ms, or null = until unmuted */
  channelMutes: ChannelMuteMap;
  /** Unread text-message counts (suppressed while muted). */
  unreadByChannel: Record<string, number>;
  messageToasts: MessageToast[];
  bootstrapped: boolean;
  connecting: boolean;
  error: string | null;

  setError: (error: string | null) => void;
  setModal: (modal: ModalKind, channelId?: string | null) => void;
  openInvitePeople: (channelId?: string | null) => void;
  openMiniProfile: (opts: {
    userId: string;
    serverId?: string | null;
    x: number;
    y: number;
  }) => void;
  closeMiniProfile: () => void;
  mentionMemberInChat: (username: string) => void;
  clearPendingComposerInsert: () => void;
  requestVoiceJoin: (channelId: string) => void;
  clearPendingVoiceJoin: () => void;
  requestDmCallJoin: (dmId: string) => void;
  clearPendingDmCallJoin: () => void;
  clearPendingServerInvite: () => void;
  clearPendingChannelInvite: () => void;
  muteChannel: (channelId: string, durationMs: number | null) => void;
  unmuteChannel: (channelId: string) => void;
  pruneChannelMutes: () => void;
  setActiveServer: (id: string | null) => void;
  setActiveChannel: (id: string | null) => void;
  setVoiceLocal: (partial: {
    voiceChannelId?: string | null;
    dmCallId?: string | null;
    muted?: boolean;
    deafened?: boolean;
    streaming?: boolean;
  }) => void;

  bootstrap: () => Promise<void>;
  login: (login: string, password: string) => Promise<void>;
  register: (
    username: string,
    email: string,
    password: string,
    displayName?: string,
  ) => Promise<void>;
  logout: () => void;
  updateProfile: (body: {
    display_name?: string;
    email?: string;
    avatar_url?: string | null;
    banner_url?: string | null;
  }) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  disableAccount: (password: string) => Promise<void>;
  deleteAccount: (password: string) => Promise<void>;
  setMyStatus: (status: PresenceStatus) => Promise<void>;
  loadMyStatus: () => Promise<void>;

  loadServers: () => Promise<void>;
  selectServer: (serverId: string) => Promise<void>;
  selectChannel: (channelId: string) => Promise<void>;
  navigateToChannel: (serverId: string, channelId: string) => Promise<void>;
  pushMessageToast: (toast: MessageToast) => void;
  dismissMessageToast: (id: string) => void;
  openMessageToast: (id: string) => Promise<void>;
  createServer: (name: string) => Promise<Server>;
  joinInvite: (code: string) => Promise<Server>;
  updateServer: (id: string, body: Partial<Server>) => Promise<void>;
  transferOwnership: (serverId: string, userId: string) => Promise<void>;
  deleteServer: (id: string) => Promise<void>;
  loadRoles: (serverId: string) => Promise<void>;
  loadRules: (serverId: string) => Promise<void>;
  createRole: (
    serverId: string,
    body: { name: string; color?: string; permissions?: number },
  ) => Promise<Role>;
  updateRole: (
    serverId: string,
    roleId: string,
    body: { name?: string; color?: string; permissions?: number },
  ) => Promise<void>;
  deleteRole: (serverId: string, roleId: string) => Promise<void>;
  setRules: (
    serverId: string,
    rules: { title: string; body: string }[],
  ) => Promise<void>;
  createInvite: (
    serverId: string,
    opts?: { max_age?: number | null; max_uses?: number | null },
  ) => Promise<Invite>;
  listInvites: (serverId: string) => Promise<Invite[]>;
  deleteInvite: (serverId: string, code: string) => Promise<void>;
  inviteFriend: (serverId: string, userId: string) => Promise<Member>;
  inviteToChannel: (channelId: string, userId: string) => Promise<void>;
  loadMyEmojis: () => Promise<void>;
  listServerEmojis: (serverId: string) => Promise<ServerEmoji[]>;
  createServerEmoji: (
    serverId: string,
    body: { name: string; image_url: string; animated?: boolean },
  ) => Promise<ServerEmoji>;
  deleteServerEmoji: (serverId: string, emojiId: string) => Promise<void>;
  resolveCustomEmojis: (content: string) => Promise<void>;
  createChannel: (
    serverId: string,
    body: {
      name: string;
      channel_type: "text" | "voice" | "category";
      category_id?: string | null;
    },
  ) => Promise<Channel>;
  duplicateChannel: (id: string) => Promise<Channel>;
  updateChannel: (id: string, body: Record<string, unknown>) => Promise<void>;
  /** Optimistically apply position/category changes, then PATCH each changed channel. */
  applyChannelOrder: (
    serverId: string,
    next: Channel[],
  ) => Promise<void>;
  deleteChannel: (id: string) => Promise<void>;
  loadChannelOverwrites: (channelId: string) => Promise<PermissionOverwrite[]>;
  saveChannelOverwrites: (
    channelId: string,
    overwrites: {
      target_type: "role" | "member";
      target_id: string;
      allow: number;
      deny: number;
    }[],
  ) => Promise<PermissionOverwrite[]>;

  loadMessages: (channelId: string) => Promise<void>;
  sendMessage: (
    channelId: string,
    content: string,
    attachmentIds?: string[],
  ) => Promise<void>;
  editMessage: (messageId: string, content: string) => Promise<void>;
  deleteMessage: (messageId: string, channelId: string) => Promise<void>;
  toggleReaction: (messageId: string, emoji: string, me: boolean) => Promise<void>;
  sendTyping: (channelId: string) => Promise<void>;

  openFriendsHome: () => Promise<void>;
  loadFriends: () => Promise<void>;
  loadDms: () => Promise<void>;
  requestFriend: (username: string) => Promise<void>;
  acceptFriend: (friendshipId: string) => Promise<void>;
  declineFriend: (friendshipId: string) => Promise<void>;
  removeFriend: (friendshipId: string) => Promise<void>;
  muteFriend: (friendshipId: string) => Promise<void>;
  blockFriend: (friendshipId: string) => Promise<void>;
  blockUser: (userId: string) => Promise<void>;
  kickMember: (serverId: string, userId: string) => Promise<void>;
  setMemberRoles: (
    serverId: string,
    userId: string,
    roleIds: string[],
  ) => Promise<Member>;
  banMember: (serverId: string, userId: string, reason?: string) => Promise<void>;
  timeoutMember: (
    serverId: string,
    userId: string,
    body: { duration_seconds?: number; reason?: string; clear?: boolean },
  ) => Promise<Member>;
  moderateMemberVoice: (
    serverId: string,
    userId: string,
    body: { server_muted?: boolean; server_deafened?: boolean },
  ) => Promise<void>;
  closeDm: (dmId: string) => Promise<void>;
  selectDm: (dmId: string) => Promise<void>;
  /** Open/create a DM channel without changing the current view. Returns dm id. */
  ensureDmWithPeer: (peerId: string) => Promise<string | null>;
  openDmWithPeer: (peerId: string) => Promise<void>;
  /** Open the DM with a peer and start a private 1:1 voice call. */
  startDmCallWithPeer: (peerId: string) => Promise<void>;
  loadDmMessages: (dmId: string) => Promise<void>;
  sendDmMessage: (dmId: string, content: string) => Promise<void>;
  editDmMessage: (messageId: string, dmId: string, content: string) => Promise<void>;
  deleteDmMessage: (messageId: string, dmId: string) => Promise<void>;
  sendDmTyping: (dmId: string) => Promise<void>;

  uploadFile: (file: File) => Promise<{ id: string; url: string }>;
  attachRemoteMedia: (body: {
    url: string;
    filename?: string;
    content_type?: string;
    size?: number;
  }) => Promise<{ id: string; url: string }>;
  applyWsEvent: (event: WsEvent) => void;
}

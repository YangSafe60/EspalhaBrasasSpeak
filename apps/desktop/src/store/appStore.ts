import { create } from "zustand";
import {
  api,
  clearTokens,
  getAccessToken,
  getRefreshToken,
  setTokens,
} from "../api/client";
import {
  clearIdentityCache,
  decryptDm,
  encryptDm,
  fingerprint,
  loadOrCreateIdentity,
  type IdentityKeyPair,
} from "../lib/e2e";
import type {
  AuthResponse,
  Channel,
  DmChannel,
  DmMessage,
  DmMessageWire,
  Friendship,
  FriendsList,
  Invite,
  Member,
  Message,
  PermissionOverwrite,
  PresenceStatus,
  Role,
  Server,
  ServerEmoji,
  ServerRule,
  UserIdentityKey,
  UserPublic,
  VoiceStateView,
  WsEvent,
} from "../types";
import { extractCustomEmojiIds } from "../lib/customEmoji";
import {
  channelIsMuted,
  loadChannelMutes,
  pruneExpiredMutes,
  saveChannelMutes,
  type ChannelMuteMap,
} from "../lib/channelMutePrefs";
import { playMessageNotify } from "../lib/messageNotify";
import { permBits } from "../lib/serverPerms";

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

type TypingEntry = { username: string; expires: number };

let identityPair: IdentityKeyPair | null = null;

async function ensureIdentity(userId: string): Promise<IdentityKeyPair> {
  if (identityPair) return identityPair;
  identityPair = await loadOrCreateIdentity(userId);
  await api<UserIdentityKey>("/api/crypto/identity", {
    method: "PUT",
    body: { public_key: identityPair.publicKeyB64 },
  });
  return identityPair;
}

async function decryptWire(
  wire: DmMessageWire,
  peerPublic: string,
): Promise<DmMessage> {
  if (!identityPair) {
    return {
      ...wire,
      content: "",
      decrypt_failed: true,
    };
  }
  try {
    const content = await decryptDm(
      wire.ciphertext,
      wire.nonce,
      identityPair.privateKey,
      peerPublic,
      wire.dm_channel_id,
    );
    return { ...wire, content, decrypt_failed: false };
  } catch {
    return { ...wire, content: "", decrypt_failed: true };
  }
}

function upsertFriendship(list: Friendship[], f: Friendship): Friendship[] {
  const next = list.filter((x) => x.id !== f.id);
  next.push(f);
  return next;
}

function normalizeOverwrite(o: PermissionOverwrite): PermissionOverwrite {
  return {
    ...o,
    target_type:
      String(o.target_type).toLowerCase() === "member" ? "member" : "role",
    allow: permBits(o.allow),
    deny: permBits(o.deny),
  };
}

interface AppState {
  user: UserPublic | null;
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

  friendsHome: boolean;
  friends: Friendship[];
  pendingInbound: Friendship[];
  pendingOutbound: Friendship[];
  dmChannels: DmChannel[];
  messagesByDm: Record<string, DmMessage[]>;
  activeDmId: string | null;
  identityPublicKey: string | null;
  peerPublicKeys: Record<string, string>;
  dmFingerprints: Record<string, string>;

  activeServerId: string | null;
  activeChannelId: string | null;
  voiceChannelId: string | null;
  muted: boolean;
  deafened: boolean;
  streaming: boolean;

  modal: ModalKind;
  settingsChannelId: string | null;
  /** When opening invite-people from a channel row. */
  inviteChannelId: string | null;
  miniProfile: MiniProfileState | null;
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
  clearPendingServerInvite: () => void;
  clearPendingChannelInvite: () => void;
  muteChannel: (channelId: string, durationMs: number | null) => void;
  unmuteChannel: (channelId: string) => void;
  pruneChannelMutes: () => void;
  setActiveServer: (id: string | null) => void;
  setActiveChannel: (id: string | null) => void;
  setVoiceLocal: (partial: {
    voiceChannelId?: string | null;
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
    avatar_url?: string | null;
    banner_url?: string | null;
  }) => Promise<void>;
  setMyStatus: (status: PresenceStatus) => Promise<void>;
  loadMyStatus: () => Promise<void>;

  loadServers: () => Promise<void>;
  selectServer: (serverId: string) => Promise<void>;
  selectChannel: (channelId: string) => Promise<void>;
  createServer: (name: string) => Promise<Server>;
  joinInvite: (code: string) => Promise<Server>;
  updateServer: (id: string, body: Partial<Server>) => Promise<void>;
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
  banMember: (serverId: string, userId: string, reason?: string) => Promise<void>;
  moderateMemberVoice: (
    serverId: string,
    userId: string,
    body: { server_muted?: boolean; server_deafened?: boolean },
  ) => Promise<void>;
  closeDm: (dmId: string) => Promise<void>;
  selectDm: (dmId: string) => Promise<void>;
  openDmWithPeer: (peerId: string) => Promise<void>;
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
  }) => Promise<{ id: string; url: string }>;
  applyWsEvent: (event: WsEvent) => void;
}

function upsertMessage(list: Message[], message: Message): Message[] {
  const idx = list.findIndex((m) => m.id === message.id);
  let next: Message[];
  if (idx >= 0) {
    next = list.slice();
    next[idx] = message;
  } else {
    next = [...list, message].sort(
      (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
  }
  const CAP = 80;
  return next.length > CAP ? next.slice(next.length - CAP) : next;
}

function upsertDm(list: DmMessage[], message: DmMessage): DmMessage[] {
  const idx = list.findIndex((m) => m.id === message.id);
  let next: DmMessage[];
  if (idx >= 0) {
    next = list.slice();
    next[idx] = message;
  } else {
    next = [...list, message].sort(
      (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
  }
  const CAP = 80;
  return next.length > CAP ? next.slice(next.length - CAP) : next;
}

function applyAuth(set: (p: Partial<AppState>) => void, data: AuthResponse) {
  setTokens(data.access_token, data.refresh_token);
  set({ user: data.user, error: null });
}

export const useAppStore = create<AppState>((set, get) => ({
  user: null,
  servers: [],
  channelsByServer: {},
  membersByServer: {},
  rolesByServer: {},
  rulesByServer: {},
  overwritesByChannel: {},
  messagesByChannel: {},
  authors: {},
  customEmojis: [],
  customEmojisById: {},
  voiceStates: [],
  typing: {},
  presenceByUser: {},
  myStatus: "online",

  friendsHome: false,
  friends: [],
  pendingInbound: [],
  pendingOutbound: [],
  dmChannels: [],
  messagesByDm: {},
  activeDmId: null,
  identityPublicKey: null,
  peerPublicKeys: {},
  dmFingerprints: {},

  activeServerId: null,
  activeChannelId: null,
  voiceChannelId: null,
  muted: false,
  deafened: false,
  streaming: false,

  modal: null,
  settingsChannelId: null,
  inviteChannelId: null,
  miniProfile: null,
  pendingServerInvite: null,
  pendingChannelInvite: null,
  channelMutes: loadChannelMutes(),
  unreadByChannel: {},
  bootstrapped: false,
  connecting: false,
  error: null,

  setError: (error) => set({ error }),
  setModal: (modal, channelId = null) =>
    set({
      modal,
      settingsChannelId: modal === "channel-settings" ? channelId ?? null : null,
      inviteChannelId: null,
      miniProfile: null,
    }),
  openInvitePeople: (channelId = null) =>
    set({
      modal: "invite-people",
      inviteChannelId: channelId,
      settingsChannelId: null,
      miniProfile: null,
    }),
  openMiniProfile: ({ userId, serverId = null, x, y }) =>
    set({
      miniProfile: { userId, serverId, x, y },
      modal: null,
    }),
  closeMiniProfile: () => set({ miniProfile: null }),
  clearPendingServerInvite: () => set({ pendingServerInvite: null }),
  clearPendingChannelInvite: () => set({ pendingChannelInvite: null }),
  muteChannel: (channelId, durationMs) => {
    const until = durationMs === null ? null : Date.now() + durationMs;
    set((s) => {
      const channelMutes = pruneExpiredMutes({
        ...s.channelMutes,
        [channelId]: until,
      });
      saveChannelMutes(channelMutes);
      const { [channelId]: _drop, ...unreadByChannel } = s.unreadByChannel;
      void _drop;
      return { channelMutes, unreadByChannel };
    });
  },
  unmuteChannel: (channelId) => {
    set((s) => {
      const { [channelId]: _drop, ...rest } = s.channelMutes;
      void _drop;
      const channelMutes = pruneExpiredMutes(rest);
      saveChannelMutes(channelMutes);
      return { channelMutes };
    });
  },
  pruneChannelMutes: () => {
    set((s) => {
      const channelMutes = pruneExpiredMutes(s.channelMutes);
      if (
        Object.keys(channelMutes).length === Object.keys(s.channelMutes).length
      ) {
        return s;
      }
      saveChannelMutes(channelMutes);
      return { channelMutes };
    });
  },
  setActiveServer: (id) => set({ activeServerId: id }),
  setActiveChannel: (id) => set({ activeChannelId: id }),
  setVoiceLocal: (partial) => set(partial),

  bootstrap: async () => {
    if (!getAccessToken() || !getRefreshToken()) {
      set({ bootstrapped: true, user: null });
      return;
    }
    set({ connecting: true });
    try {
      const user = await api<UserPublic>("/api/auth/me");
      set({ user });
      void get().loadMyStatus();
      // Hard quit leaves a stale voice_states row; we are never in LiveKit on cold start.
      try {
        await api("/api/voice/state", {
          method: "PUT",
          body: { channel_id: null, streaming: false },
        });
      } catch {
        /* best effort */
      }
      set({
        voiceChannelId: null,
        streaming: false,
        voiceStates: get().voiceStates.filter((v) => v.user_id !== user.id),
      });
      await get().loadServers();
      void get().loadMyEmojis();
      try {
        const id = await ensureIdentity(user.id);
        set({ identityPublicKey: id.publicKeyB64 });
        await Promise.all([get().loadFriends(), get().loadDms()]);
      } catch {
        /* E2E bootstrap best-effort */
      }
    } catch {
      clearTokens();
      set({ user: null });
    } finally {
      set({ bootstrapped: true, connecting: false });
    }
  },

  login: async (login, password) => {
    const data = await api<AuthResponse>("/api/auth/login", {
      method: "POST",
      body: { login, password },
      auth: false,
    });
    applyAuth(set, data);
    identityPair = null;
    clearIdentityCache();
    void get().loadMyStatus();
    await get().loadServers();
    try {
      const id = await ensureIdentity(data.user.id);
      set({ identityPublicKey: id.publicKeyB64 });
      await Promise.all([get().loadFriends(), get().loadDms()]);
    } catch {
      /* best effort */
    }
  },

  register: async (username, email, password, displayName) => {
    const data = await api<AuthResponse>("/api/auth/register", {
      method: "POST",
      body: {
        username,
        email,
        password,
        display_name: displayName || undefined,
      },
      auth: false,
    });
    applyAuth(set, data);
    identityPair = null;
    clearIdentityCache();
    void get().loadMyStatus();
    await get().loadServers();
    try {
      const id = await ensureIdentity(data.user.id);
      set({ identityPublicKey: id.publicKeyB64 });
      await Promise.all([get().loadFriends(), get().loadDms()]);
    } catch {
      /* best effort */
    }
  },

  logout: () => {
    clearTokens();
    identityPair = null;
    clearIdentityCache();
    set({
      user: null,
      servers: [],
      channelsByServer: {},
      membersByServer: {},
      rolesByServer: {},
      rulesByServer: {},
      overwritesByChannel: {},
      messagesByChannel: {},
      authors: {},
      customEmojis: [],
      customEmojisById: {},
      voiceStates: [],
      presenceByUser: {},
      myStatus: "online",
      friendsHome: false,
      friends: [],
      pendingInbound: [],
      pendingOutbound: [],
      dmChannels: [],
      messagesByDm: {},
      activeDmId: null,
      identityPublicKey: null,
      peerPublicKeys: {},
      dmFingerprints: {},
      activeServerId: null,
      activeChannelId: null,
      voiceChannelId: null,
      modal: null,
      miniProfile: null,
      pendingServerInvite: null,
      pendingChannelInvite: null,
      inviteChannelId: null,
      unreadByChannel: {},
    });
  },

  updateProfile: async (body) => {
    const user = await api<UserPublic>("/api/auth/me", {
      method: "PATCH",
      body,
    });
    set((s) => {
      const membersByServer: Record<string, Member[]> = {};
      for (const [sid, members] of Object.entries(s.membersByServer)) {
        membersByServer[sid] = members.map((m) =>
          m.user.id === user.id ? { ...m, user } : m,
        );
      }
      return {
        user,
        authors: { ...s.authors, [user.id]: user },
        membersByServer,
        friends: s.friends.map((f) =>
          f.peer.id === user.id ? { ...f, peer: user } : f,
        ),
        dmChannels: s.dmChannels.map((d) =>
          d.peer.id === user.id ? { ...d, peer: user } : d,
        ),
      };
    });
  },

  loadMyStatus: async () => {
    try {
      const res = await api<{ status: PresenceStatus }>("/api/users/me/presence");
      const status = res.status || "online";
      set((s) => ({
        myStatus: status,
        presenceByUser: s.user
          ? {
              ...s.presenceByUser,
              // Invisible still shows as offline to others; keep local truth for self.
              [s.user.id]: status === "offline" ? "offline" : status,
            }
          : s.presenceByUser,
      }));
    } catch {
      /* older servers */
    }
  },

  setMyStatus: async (status) => {
    const res = await api<{ status: PresenceStatus }>("/api/users/me/presence", {
      method: "PUT",
      body: { status },
    });
    const next = res.status || status;
    set((s) => ({
      myStatus: next,
      presenceByUser: s.user
        ? { ...s.presenceByUser, [s.user.id]: next }
        : s.presenceByUser,
    }));
  },

  loadServers: async () => {
    const servers = await api<Server[]>("/api/servers");
    set({ servers });
    const { activeServerId, friendsHome } = get();
    if (friendsHome) return;
    if (!activeServerId && servers.length) {
      await get().selectServer(servers[0].id);
    } else if (activeServerId && !servers.find((s) => s.id === activeServerId)) {
      if (servers.length) await get().selectServer(servers[0].id);
      else set({ activeServerId: null, activeChannelId: null });
    }
  },

  selectServer: async (serverId) => {
    set({
      activeServerId: serverId,
      friendsHome: false,
      activeDmId: null,
      connecting: true,
    });
    try {
      const [channels, members, roles, rules, voiceStates, presence, overwrites] =
        await Promise.all([
        api<Channel[]>(`/api/servers/${serverId}/channels`),
        api<Member[]>(`/api/servers/${serverId}/members`),
        api<Role[]>(`/api/servers/${serverId}/roles`),
        api<ServerRule[]>(`/api/servers/${serverId}/rules`),
        api<VoiceStateView[]>("/api/voice/state", {
          query: { server_id: serverId },
        }),
        api<{ user_id: string; status: PresenceStatus }[]>(
          `/api/servers/${serverId}/presence`,
        ).catch(() => [] as { user_id: string; status: PresenceStatus }[]),
        api<PermissionOverwrite[]>(
          `/api/servers/${serverId}/channel-overwrites`,
        ).catch(() => [] as PermissionOverwrite[]),
      ]);
      const authors: Record<string, UserPublic> = { ...get().authors };
      for (const m of members) authors[m.user.id] = m.user;
      const presenceByUser: Record<string, PresenceStatus> = {
        ...get().presenceByUser,
      };
      for (const p of presence) presenceByUser[p.user_id] = p.status;
      // Prefer local chosen status for self (incl. invisible).
      if (get().user) {
        presenceByUser[get().user!.id] = get().myStatus;
      }

      const normalizedOws = overwrites.map(normalizeOverwrite);
      const owsByChannel: Record<string, PermissionOverwrite[]> = {};
      for (const o of normalizedOws) {
        (owsByChannel[o.channel_id] ||= []).push(o);
      }
      // Ensure every loaded channel has an entry (even empty) so lock checks are stable.
      for (const c of channels) {
        if (!(c.id in owsByChannel)) owsByChannel[c.id] = [];
      }

      set((s) => {
        const keepIds = new Set(channels.map((c) => c.id));
        const messagesByChannel = Object.fromEntries(
          Object.entries(s.messagesByChannel).filter(([cid]) =>
            keepIds.has(cid),
          ),
        );
        const overwritesByChannel = { ...s.overwritesByChannel };
        for (const id of Object.keys(overwritesByChannel)) {
          const ch = Object.values(s.channelsByServer)
            .flat()
            .find((c) => c.id === id);
          if (ch?.server_id === serverId || keepIds.has(id)) {
            delete overwritesByChannel[id];
          }
        }
        Object.assign(overwritesByChannel, owsByChannel);
        return {
          channelsByServer: { ...s.channelsByServer, [serverId]: channels },
          membersByServer: { ...s.membersByServer, [serverId]: members },
          rolesByServer: { ...s.rolesByServer, [serverId]: roles },
          rulesByServer: { ...s.rulesByServer, [serverId]: rules },
          overwritesByChannel,
          authors,
          voiceStates,
          presenceByUser,
          messagesByChannel,
        };
      });

      const text = channels
        .filter((c) => c.channel_type === "text")
        .sort((a, b) => a.position - b.position)[0];
      if (text) await get().selectChannel(text.id);
      else set({ activeChannelId: null });
    } finally {
      set({ connecting: false });
    }
  },

  selectChannel: async (channelId) => {
    set((s) => {
      const { [channelId]: _drop, ...unreadByChannel } = s.unreadByChannel;
      void _drop;
      return { activeChannelId: channelId, unreadByChannel };
    });
    const channel = Object.values(get().channelsByServer)
      .flat()
      .find((c) => c.id === channelId);
    if (channel?.channel_type === "text") {
      await get().loadMessages(channelId);
    }
  },

  createServer: async (name) => {
    const server = await api<Server>("/api/servers", {
      method: "POST",
      body: { name },
    });
    set((s) => ({ servers: [...s.servers, server] }));
    await get().selectServer(server.id);
    void get().loadMyEmojis();
    return server;
  },

  joinInvite: async (code) => {
    const server = await api<Server>(`/api/invites/${code.trim()}`, {
      method: "POST",
    });
    await get().loadServers();
    await get().selectServer(server.id);
    void get().loadMyEmojis();
    return server;
  },

  updateServer: async (id, body) => {
    const server = await api<Server>(`/api/servers/${id}`, {
      method: "PATCH",
      body,
    });
    set((s) => ({
      servers: s.servers.map((x) => (x.id === id ? server : x)),
    }));
  },

  deleteServer: async (id) => {
    await api(`/api/servers/${id}`, { method: "DELETE" });
    const state = get();
    const servers = state.servers.filter((s) => s.id !== id);
    const voiceInDeleted = (state.channelsByServer[id] || []).some(
      (c) => c.id === state.voiceChannelId,
    );
    const {
      [id]: _channels,
      ...channelsByServer
    } = state.channelsByServer;
    const { [id]: _members, ...membersByServer } = state.membersByServer;
    const { [id]: _roles, ...rolesByServer } = state.rolesByServer;
    const { [id]: _rules, ...rulesByServer } = state.rulesByServer;
    void _channels;
    void _members;
    void _roles;
    void _rules;

    const switchingAway = state.activeServerId === id;
    const nextServerId = switchingAway ? servers[0]?.id ?? null : state.activeServerId;

    set({
      servers,
      channelsByServer,
      membersByServer,
      rolesByServer,
      rulesByServer,
      activeServerId: nextServerId,
      activeChannelId: switchingAway ? null : state.activeChannelId,
      voiceChannelId: voiceInDeleted ? null : state.voiceChannelId,
      modal: null,
      settingsChannelId: null,
    });

    if (nextServerId) {
      await get().selectServer(nextServerId);
    }
  },

  loadRoles: async (serverId) => {
    const roles = await api<Role[]>(`/api/servers/${serverId}/roles`);
    set((s) => ({
      rolesByServer: {
        ...s.rolesByServer,
        [serverId]: roles.map((role) => ({
          ...role,
          permissions: Number(role.permissions) || 0,
        })),
      },
    }));
  },

  loadRules: async (serverId) => {
    const rules = await api<ServerRule[]>(`/api/servers/${serverId}/rules`);
    set((s) => ({
      rulesByServer: { ...s.rulesByServer, [serverId]: rules },
    }));
  },

  createRole: async (serverId, body) => {
    const role = await api<Role>(`/api/servers/${serverId}/roles`, {
      method: "POST",
      body,
    });
    await get().loadRoles(serverId);
    return role;
  },

  updateRole: async (serverId, roleId, body) => {
    await api(`/api/servers/${serverId}/roles/${roleId}`, {
      method: "PATCH",
      body,
    });
    await get().loadRoles(serverId);
  },

  deleteRole: async (serverId, roleId) => {
    await api(`/api/servers/${serverId}/roles/${roleId}`, { method: "DELETE" });
    await get().loadRoles(serverId);
  },

  setRules: async (serverId, rules) => {
    const next = await api<ServerRule[]>(`/api/servers/${serverId}/rules`, {
      method: "PUT",
      body: { rules },
    });
    set((s) => ({
      rulesByServer: { ...s.rulesByServer, [serverId]: next },
    }));
  },

  createInvite: async (serverId, opts) => {
    return api<Invite>(`/api/servers/${serverId}/invites`, {
      method: "POST",
      body: {
        max_age: opts?.max_age ?? null,
        max_uses: opts?.max_uses ?? null,
      },
    });
  },

  listInvites: async (serverId) => {
    return api<Invite[]>(`/api/servers/${serverId}/invites`);
  },

  deleteInvite: async (serverId, code) => {
    await api(`/api/servers/${serverId}/invites/${encodeURIComponent(code)}`, {
      method: "DELETE",
    });
  },

  inviteFriend: async (serverId, userId) => {
    const member = await api<Member>(`/api/servers/${serverId}/invite-friend`, {
      method: "POST",
      body: { user_id: userId },
    });
    set((s) => ({
      authors: { ...s.authors, [member.user.id]: member.user },
      membersByServer: {
        ...s.membersByServer,
        [serverId]: [
          ...(s.membersByServer[serverId] || []).filter(
            (m) => m.user.id !== member.user.id,
          ),
          member,
        ],
      },
    }));
    return member;
  },

  inviteToChannel: async (channelId, userId) => {
    await api(`/api/channels/${channelId}/invite`, {
      method: "POST",
      body: { user_id: userId },
    });
    void get().loadChannelOverwrites(channelId).catch(() => {});
  },

  loadMyEmojis: async () => {
    try {
      const list = await api<ServerEmoji[]>("/api/users/me/emojis");
      const customEmojisById: Record<string, ServerEmoji> = {
        ...get().customEmojisById,
      };
      for (const e of list) customEmojisById[e.id] = e;
      set({ customEmojis: list, customEmojisById });
    } catch {
      /* older servers may not have the route yet */
    }
  },

  listServerEmojis: async (serverId) => {
    return api<ServerEmoji[]>(`/api/servers/${serverId}/emojis`);
  },

  createServerEmoji: async (serverId, body) => {
    const emoji = await api<ServerEmoji>(`/api/servers/${serverId}/emojis`, {
      method: "POST",
      body,
    });
    set((s) => ({
      customEmojis: [...s.customEmojis.filter((e) => e.id !== emoji.id), emoji],
      customEmojisById: { ...s.customEmojisById, [emoji.id]: emoji },
    }));
    return emoji;
  },

  deleteServerEmoji: async (serverId, emojiId) => {
    await api(`/api/servers/${serverId}/emojis/${emojiId}`, {
      method: "DELETE",
    });
    set((s) => {
      const { [emojiId]: _drop, ...customEmojisById } = s.customEmojisById;
      void _drop;
      return {
        customEmojis: s.customEmojis.filter((e) => e.id !== emojiId),
        customEmojisById,
      };
    });
  },

  resolveCustomEmojis: async (content) => {
    const ids = extractCustomEmojiIds(content);
    if (!ids.length) return;
    const missing = ids.filter((id) => !get().customEmojisById[id]);
    if (!missing.length) return;
    const fetched = await Promise.all(
      missing.map((id) =>
        api<ServerEmoji>(`/api/emojis/${id}`).catch(() => null),
      ),
    );
    set((s) => {
      const customEmojisById = { ...s.customEmojisById };
      for (const e of fetched) {
        if (e) customEmojisById[e.id] = e;
      }
      return { customEmojisById };
    });
  },

  createChannel: async (serverId, body) => {
    const channel = await api<Channel>(`/api/servers/${serverId}/channels`, {
      method: "POST",
      body,
    });
    // Dedupe: WS channel_create often arrives before this HTTP response lands.
    set((s) => {
      const list = s.channelsByServer[serverId] || [];
      return {
        channelsByServer: {
          ...s.channelsByServer,
          [serverId]: [...list.filter((c) => c.id !== channel.id), channel],
        },
      };
    });
    return channel;
  },

  updateChannel: async (id, body) => {
    const channel = await api<Channel>(`/api/channels/${id}`, {
      method: "PATCH",
      body,
    });
    set((s) => {
      const list = s.channelsByServer[channel.server_id] || [];
      return {
        channelsByServer: {
          ...s.channelsByServer,
          [channel.server_id]: list.map((c) => (c.id === id ? channel : c)),
        },
      };
    });
  },

  applyChannelOrder: async (serverId, next) => {
    const prev = get().channelsByServer[serverId] || [];
    const prevById = new Map(prev.map((c) => [c.id, c]));
    set((s) => ({
      channelsByServer: {
        ...s.channelsByServer,
        [serverId]: next,
      },
    }));
    const changed = next.filter((c) => {
      const o = prevById.get(c.id);
      return (
        !o ||
        o.position !== c.position ||
        o.category_id !== c.category_id
      );
    });
    if (changed.length === 0) return;
    try {
      await Promise.all(
        changed.map((c) =>
          api<Channel>(`/api/channels/${c.id}`, {
            method: "PATCH",
            body: {
              position: c.position,
              category_id: c.category_id,
            },
          }),
        ),
      );
    } catch (err) {
      set((s) => ({
        channelsByServer: {
          ...s.channelsByServer,
          [serverId]: prev,
        },
      }));
      throw err;
    }
  },

  deleteChannel: async (id) => {
    const channel = Object.values(get().channelsByServer)
      .flat()
      .find((c) => c.id === id);
    await api(`/api/channels/${id}`, { method: "DELETE" });
    if (!channel) return;
    set((s) => ({
      channelsByServer: {
        ...s.channelsByServer,
        [channel.server_id]: (s.channelsByServer[channel.server_id] || [])
          .filter((c) => c.id !== id)
          .map((c) =>
            c.category_id === id ? { ...c, category_id: null } : c,
          ),
      },
      activeChannelId: s.activeChannelId === id ? null : s.activeChannelId,
    }));
  },

  loadChannelOverwrites: async (channelId) => {
    const rows = await api<PermissionOverwrite[]>(
      `/api/channels/${channelId}/overwrites`,
    );
    const normalized = rows.map(normalizeOverwrite);
    set((s) => ({
      overwritesByChannel: {
        ...s.overwritesByChannel,
        [channelId]: normalized,
      },
    }));
    return normalized;
  },

  saveChannelOverwrites: async (channelId, overwrites) => {
    const rows = await api<PermissionOverwrite[]>(
      `/api/channels/${channelId}/overwrites`,
      {
        method: "PUT",
        body: { overwrites },
      },
    );
    const normalized = rows.map(normalizeOverwrite);
    set((s) => ({
      overwritesByChannel: {
        ...s.overwritesByChannel,
        [channelId]: normalized,
      },
    }));
    return normalized;
  },

  loadMessages: async (channelId) => {
    const messages = await api<Message[]>(`/api/channels/${channelId}/messages`);
    set((s) => ({
      messagesByChannel: {
        ...s.messagesByChannel,
        // API returns chronological (oldest → newest)
        [channelId]: messages,
      },
    }));
  },

  sendMessage: async (channelId, content, attachmentIds) => {
    const message = await api<Message>(`/api/channels/${channelId}/messages`, {
      method: "POST",
      body: {
        content,
        attachment_ids: attachmentIds,
      },
    });
    const user = get().user;
    set((s) => ({
      messagesByChannel: {
        ...s.messagesByChannel,
        [channelId]: upsertMessage(s.messagesByChannel[channelId] || [], message),
      },
      authors: user
        ? { ...s.authors, [user.id]: user }
        : s.authors,
    }));
  },

  editMessage: async (messageId, content) => {
    const message = await api<Message>(`/api/messages/${messageId}`, {
      method: "PATCH",
      body: { content },
    });
    set((s) => ({
      messagesByChannel: {
        ...s.messagesByChannel,
        [message.channel_id]: upsertMessage(
          s.messagesByChannel[message.channel_id] || [],
          message,
        ),
      },
    }));
  },

  deleteMessage: async (messageId, channelId) => {
    await api(`/api/messages/${messageId}`, { method: "DELETE" });
    set((s) => ({
      messagesByChannel: {
        ...s.messagesByChannel,
        [channelId]: (s.messagesByChannel[channelId] || []).filter(
          (m) => m.id !== messageId,
        ),
      },
    }));
  },

  toggleReaction: async (messageId, emoji, me) => {
    const path = `/api/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`;
    if (me) await api(path, { method: "DELETE" });
    else await api(path, { method: "PUT" });
  },

  sendTyping: async (channelId) => {
    await api(`/api/channels/${channelId}/typing`, { method: "POST" });
  },

  openFriendsHome: async () => {
    set({
      friendsHome: true,
      activeServerId: null,
      activeChannelId: null,
      activeDmId: null,
    });
    await Promise.all([get().loadFriends(), get().loadDms()]);
  },

  loadFriends: async () => {
    const list = await api<FriendsList>("/api/friends");
    const authors: Record<string, UserPublic> = { ...get().authors };
    for (const f of [...list.friends, ...list.inbound, ...list.outbound]) {
      authors[f.peer.id] = f.peer;
    }
    set({
      friends: list.friends,
      pendingInbound: list.inbound,
      pendingOutbound: list.outbound,
      authors,
    });
  },

  loadDms: async () => {
    const channels = await api<DmChannel[]>("/api/dms");
    const authors: Record<string, UserPublic> = { ...get().authors };
    for (const c of channels) authors[c.peer.id] = c.peer;
    set({ dmChannels: channels, authors });
  },

  requestFriend: async (username) => {
    const cleaned = username.trim().replace(/^@+/, "");
    const friendship = await api<Friendship>("/api/friends/request", {
      method: "POST",
      body: { username: cleaned },
    });
    set((s) => ({
      pendingOutbound: upsertFriendship(s.pendingOutbound, friendship),
      authors: { ...s.authors, [friendship.peer.id]: friendship.peer },
    }));
  },

  acceptFriend: async (friendshipId) => {
    const friendship = await api<Friendship>(
      `/api/friends/${friendshipId}/accept`,
      { method: "POST" },
    );
    set((s) => ({
      friends: upsertFriendship(s.friends, friendship),
      pendingInbound: s.pendingInbound.filter((f) => f.id !== friendshipId),
      pendingOutbound: s.pendingOutbound.filter((f) => f.id !== friendshipId),
      authors: { ...s.authors, [friendship.peer.id]: friendship.peer },
    }));
    await get().loadDms();
  },

  declineFriend: async (friendshipId) => {
    await api(`/api/friends/${friendshipId}/decline`, { method: "POST" });
    set((s) => ({
      pendingInbound: s.pendingInbound.filter((f) => f.id !== friendshipId),
      pendingOutbound: s.pendingOutbound.filter((f) => f.id !== friendshipId),
    }));
  },

  removeFriend: async (friendshipId) => {
    await api(`/api/friends/${friendshipId}`, { method: "DELETE" });
    set((s) => {
      const closed = s.dmChannels.find((d) => d.friendship_id === friendshipId);
      return {
        friends: s.friends.filter((f) => f.id !== friendshipId),
        pendingInbound: s.pendingInbound.filter((f) => f.id !== friendshipId),
        pendingOutbound: s.pendingOutbound.filter((f) => f.id !== friendshipId),
        dmChannels: s.dmChannels.map((d) =>
          d.friendship_id === friendshipId ? { ...d, friendship_id: null } : d,
        ),
        activeDmId:
          closed && s.activeDmId === closed.id ? s.activeDmId : s.activeDmId,
      };
    });
  },

  muteFriend: async (friendshipId) => {
    const friendship = await api<Friendship>(
      `/api/friends/${friendshipId}/mute`,
      { method: "POST" },
    );
    set((s) => ({
      friends: s.friends.map((f) =>
        f.id === friendshipId ? friendship : f,
      ),
    }));
  },

  blockFriend: async (friendshipId) => {
    await api(`/api/friends/${friendshipId}/block`, { method: "POST" });
    set((s) => {
      const peerId = s.friends.find((f) => f.id === friendshipId)?.peer.id;
      return {
        friends: s.friends.filter((f) => f.id !== friendshipId),
        pendingInbound: s.pendingInbound.filter((f) => f.id !== friendshipId),
        pendingOutbound: s.pendingOutbound.filter((f) => f.id !== friendshipId),
        dmChannels: peerId
          ? s.dmChannels.filter((d) => d.peer.id !== peerId)
          : s.dmChannels.filter((d) => d.friendship_id !== friendshipId),
        activeDmId:
          peerId &&
          s.dmChannels.find((d) => d.id === s.activeDmId)?.peer.id === peerId
            ? null
            : s.activeDmId,
      };
    });
  },

  blockUser: async (userId) => {
    await api(`/api/users/${userId}/block`, { method: "POST" });
    set((s) => ({
      friends: s.friends.filter((f) => f.peer.id !== userId),
      pendingInbound: s.pendingInbound.filter((f) => f.peer.id !== userId),
      pendingOutbound: s.pendingOutbound.filter((f) => f.peer.id !== userId),
      dmChannels: s.dmChannels.filter((d) => d.peer.id !== userId),
      activeDmId:
        s.dmChannels.find((d) => d.id === s.activeDmId)?.peer.id === userId
          ? null
          : s.activeDmId,
    }));
  },

  kickMember: async (serverId, userId) => {
    await api(`/api/servers/${serverId}/members/${userId}`, {
      method: "DELETE",
    });
    set((s) => ({
      membersByServer: {
        ...s.membersByServer,
        [serverId]: (s.membersByServer[serverId] || []).filter(
          (m) => m.user.id !== userId,
        ),
      },
      voiceStates: s.voiceStates.filter((v) => v.user_id !== userId),
    }));
  },

  banMember: async (serverId, userId, reason) => {
    await api(`/api/servers/${serverId}/bans`, {
      method: "POST",
      body: { user_id: userId, reason: reason || null },
    });
    set((s) => ({
      membersByServer: {
        ...s.membersByServer,
        [serverId]: (s.membersByServer[serverId] || []).filter(
          (m) => m.user.id !== userId,
        ),
      },
      voiceStates: s.voiceStates.filter((v) => v.user_id !== userId),
    }));
  },

  moderateMemberVoice: async (serverId, userId, body) => {
    const view = await api<VoiceStateView>(
      `/api/servers/${serverId}/members/${userId}/voice`,
      { method: "PUT", body },
    );
    set((s) => {
      const others = s.voiceStates.filter((v) => v.user_id !== userId);
      return {
        voiceStates: view.channel_id
          ? [...others, view]
          : others,
      };
    });
  },

  closeDm: async (dmId) => {
    await api(`/api/dms/${dmId}/close`, { method: "POST" });
    set((s) => ({
      dmChannels: s.dmChannels.filter((d) => d.id !== dmId),
      activeDmId: s.activeDmId === dmId ? null : s.activeDmId,
    }));
  },

  selectDm: async (dmId) => {
    try {
      await api(`/api/dms/${dmId}/open`, { method: "POST" });
    } catch {
      /* already open or older server */
    }
    set({
      friendsHome: true,
      activeServerId: null,
      activeChannelId: null,
      activeDmId: dmId,
    });
    await get().loadDmMessages(dmId);
  },

  openDmWithPeer: async (peerId) => {
    let friendship = get().friends.find((f) => f.peer.id === peerId);
    let existing = get().dmChannels.find((d) => d.peer.id === peerId);
    if (existing) {
      await get().selectDm(existing.id);
      return;
    }
    if (friendship) {
      const channel = await api<DmChannel>(
        `/api/dms/by-friendship/${friendship.id}/open`,
        { method: "POST" },
      );
      set((s) => ({
        dmChannels: [
          channel,
          ...s.dmChannels.filter((d) => d.id !== channel.id),
        ],
        authors: { ...s.authors, [channel.peer.id]: channel.peer },
      }));
      await get().selectDm(channel.id);
    }
  },

  loadDmMessages: async (dmId) => {
    const user = get().user;
    if (!user) return;
    await ensureIdentity(user.id);
    const channel = get().dmChannels.find((c) => c.id === dmId);
    if (!channel) {
      await get().loadDms();
    }
    const dm = get().dmChannels.find((c) => c.id === dmId);
    if (!dm) return;

    let peerKey = get().peerPublicKeys[dm.peer.id];
    if (!peerKey) {
      const key = await api<UserIdentityKey>(
        `/api/crypto/identity/${dm.peer.id}`,
      );
      peerKey = key.public_key;
      set((s) => ({
        peerPublicKeys: { ...s.peerPublicKeys, [dm.peer.id]: peerKey! },
      }));
    }

    const wires = await api<DmMessageWire[]>(`/api/dms/${dmId}/messages`);
    const messages = await Promise.all(
      wires.map((w) => decryptWire(w, peerKey!)),
    );
    let fp = get().dmFingerprints[dmId];
    if (!fp && identityPair) {
      fp = await fingerprint(identityPair.publicKeyB64, peerKey!);
    }
    set((s) => ({
      messagesByDm: { ...s.messagesByDm, [dmId]: messages },
      authors: { ...s.authors, [dm.peer.id]: dm.peer },
      dmFingerprints: fp
        ? { ...s.dmFingerprints, [dmId]: fp }
        : s.dmFingerprints,
    }));
  },

  sendDmMessage: async (dmId, content) => {
    const user = get().user;
    if (!user || !content.trim()) return;
    const id = await ensureIdentity(user.id);
    const dm = get().dmChannels.find((c) => c.id === dmId);
    if (!dm) throw new Error("DM not found");

    let peerKey = get().peerPublicKeys[dm.peer.id];
    if (!peerKey) {
      const key = await api<UserIdentityKey>(
        `/api/crypto/identity/${dm.peer.id}`,
      );
      peerKey = key.public_key;
      set((s) => ({
        peerPublicKeys: { ...s.peerPublicKeys, [dm.peer.id]: peerKey! },
      }));
    }

    const { ciphertext, nonce } = await encryptDm(
      content.trim(),
      id.privateKey,
      peerKey,
      dmId,
    );
    const wire = await api<DmMessageWire>(`/api/dms/${dmId}/messages`, {
      method: "POST",
      body: { ciphertext, nonce },
    });
    const message = await decryptWire(wire, peerKey);
    set((s) => ({
      messagesByDm: {
        ...s.messagesByDm,
        [dmId]: upsertDm(s.messagesByDm[dmId] || [], message),
      },
      authors: { ...s.authors, [user.id]: user },
    }));
  },

  editDmMessage: async (messageId, dmId, content) => {
    const user = get().user;
    if (!user) return;
    const id = await ensureIdentity(user.id);
    const dm = get().dmChannels.find((c) => c.id === dmId);
    if (!dm) return;
    let peerKey = get().peerPublicKeys[dm.peer.id];
    if (!peerKey) {
      const key = await api<UserIdentityKey>(
        `/api/crypto/identity/${dm.peer.id}`,
      );
      peerKey = key.public_key;
    }
    const { ciphertext, nonce } = await encryptDm(
      content.trim(),
      id.privateKey,
      peerKey,
      dmId,
    );
    const wire = await api<DmMessageWire>(`/api/dms/messages/${messageId}`, {
      method: "PATCH",
      body: { ciphertext, nonce },
    });
    const message = await decryptWire(wire, peerKey);
    set((s) => ({
      messagesByDm: {
        ...s.messagesByDm,
        [dmId]: upsertDm(s.messagesByDm[dmId] || [], message),
      },
    }));
  },

  deleteDmMessage: async (messageId, dmId) => {
    await api(`/api/dms/messages/${messageId}`, { method: "DELETE" });
    set((s) => ({
      messagesByDm: {
        ...s.messagesByDm,
        [dmId]: (s.messagesByDm[dmId] || []).filter((m) => m.id !== messageId),
      },
    }));
  },

  sendDmTyping: async (dmId) => {
    await api(`/api/dms/${dmId}/typing`, { method: "POST" });
  },

  uploadFile: async (file) => {
    const fd = new FormData();
    fd.append("file", file);
    const res = await api<{ id: string; url: string }>("/api/media/upload", {
      method: "POST",
      formData: fd,
    });
    return res;
  },

  attachRemoteMedia: async (body) => {
    return api<{ id: string; url: string }>("/api/media/remote", {
      method: "POST",
      body,
    });
  },

  applyWsEvent: (event) => {
    const state = get();
    switch (event.type) {
      case "ready":
        set({
          user: event.user,
          servers: event.servers,
          authors: { ...state.authors, [event.user.id]: event.user },
        });
        break;
      case "message_create": {
        const cid = event.message.channel_id;
        const isSelf = state.user?.id === event.author.id;
        const isActive = state.activeChannelId === cid;
        const muted = channelIsMuted(state.channelMutes, cid);
        set((s) => {
          const authors = { ...s.authors, [event.author.id]: event.author };
          // Don't grow caches for channels we've never opened.
          if (!(cid in s.messagesByChannel) && cid !== s.activeChannelId) {
            const next: Partial<AppState> = { authors };
            if (!isSelf && !isActive && !muted) {
              next.unreadByChannel = {
                ...s.unreadByChannel,
                [cid]: (s.unreadByChannel[cid] || 0) + 1,
              };
            }
            return next;
          }
          const next: Partial<AppState> = {
            authors,
            messagesByChannel: {
              ...s.messagesByChannel,
              [cid]: upsertMessage(s.messagesByChannel[cid] || [], event.message),
            },
          };
          if (!isSelf && !isActive && !muted) {
            next.unreadByChannel = {
              ...s.unreadByChannel,
              [cid]: (s.unreadByChannel[cid] || 0) + 1,
            };
          }
          return next;
        });
        if (!isSelf && !isActive && !muted) {
          playMessageNotify();
        }
        break;
      }
      case "message_update":
        set((s) => {
          const cid = event.message.channel_id;
          if (!(cid in s.messagesByChannel)) return s;
          return {
            messagesByChannel: {
              ...s.messagesByChannel,
              [cid]: upsertMessage(
                s.messagesByChannel[cid] || [],
                event.message,
              ),
            },
          };
        });
        break;
      case "message_delete":
        set((s) => {
          if (!(event.channel_id in s.messagesByChannel)) return s;
          return {
            messagesByChannel: {
              ...s.messagesByChannel,
              [event.channel_id]: (
                s.messagesByChannel[event.channel_id] || []
              ).filter((m) => m.id !== event.message_id),
            },
          };
        });
        break;
      case "typing_start": {
        const expires = Date.now() + 4000;
        set((s) => {
          const prev = (s.typing[event.channel_id] || []).filter(
            (t) => t.expires > Date.now() && t.username !== event.username,
          );
          return {
            typing: {
              ...s.typing,
              [event.channel_id]: [...prev, { username: event.username, expires }],
            },
          };
        });
        break;
      }
      case "presence_update":
        set((s) => ({
          presenceByUser: {
            ...s.presenceByUser,
            [event.user_id]: event.status,
          },
        }));
        break;
      case "channel_create":
        set((s) => ({
          channelsByServer: {
            ...s.channelsByServer,
            [event.channel.server_id]: [
              ...(s.channelsByServer[event.channel.server_id] || []).filter(
                (c) => c.id !== event.channel.id,
              ),
              event.channel,
            ],
          },
        }));
        // Overwrite saves rebroadcast as channel_create — refresh lock state.
        void get().loadChannelOverwrites(event.channel.id).catch(() => {});
        break;
      case "channel_update":
        set((s) => {
          const list = s.channelsByServer[event.channel.server_id] || [];
          const exists = list.some((c) => c.id === event.channel.id);
          return {
            channelsByServer: {
              ...s.channelsByServer,
              [event.channel.server_id]: exists
                ? list.map((c) =>
                    c.id === event.channel.id ? event.channel : c,
                  )
                : [...list, event.channel],
            },
          };
        });
        break;
      case "channel_delete":
        set((s) => {
          const { [event.channel_id]: _ow, ...overwritesByChannel } =
            s.overwritesByChannel;
          void _ow;
          return {
            channelsByServer: {
              ...s.channelsByServer,
              [event.server_id]: (s.channelsByServer[event.server_id] || [])
                .filter((c) => c.id !== event.channel_id)
                .map((c) =>
                  c.category_id === event.channel_id
                    ? { ...c, category_id: null }
                    : c,
                ),
            },
            overwritesByChannel,
            activeChannelId:
              s.activeChannelId === event.channel_id ? null : s.activeChannelId,
          };
        });
        break;
      case "server_update":
        set((s) => ({
          servers: s.servers.map((x) =>
            x.id === event.server.id ? event.server : x,
          ),
        }));
        break;
      case "member_join": {
        const joinedSelf = state.user?.id === event.member.user.id;
        const knownServer = state.servers.some(
          (s) => s.id === event.member.server_id,
        );
        set((s) => ({
          authors: { ...s.authors, [event.member.user.id]: event.member.user },
          membersByServer: {
            ...s.membersByServer,
            [event.member.server_id]: [
              ...(s.membersByServer[event.member.server_id] || []).filter(
                (m) => m.user.id !== event.member.user.id,
              ),
              event.member,
            ],
          },
        }));
        // Friend invite: pull the new server into the rail when we were added.
        if (joinedSelf && !knownServer) {
          void get().loadServers().then(() => get().loadMyEmojis());
        } else if (joinedSelf) {
          void get().loadMyEmojis();
        }
        break;
      }
      case "server_invite": {
        set({
          pendingServerInvite: {
            server: event.server,
            invited_by: event.invited_by,
            member_count: event.member_count,
            online_count: event.online_count,
          },
          authors: {
            ...state.authors,
            [event.invited_by.id]: event.invited_by,
          },
        });
        if (!state.servers.some((s) => s.id === event.server.id)) {
          void get().loadServers().then(() => get().loadMyEmojis());
        }
        break;
      }
      case "channel_invite": {
        set({
          pendingChannelInvite: {
            server: event.server,
            channel: event.channel,
            invited_by: event.invited_by,
            member_count: event.member_count,
            online_count: event.online_count,
          },
          authors: {
            ...state.authors,
            [event.invited_by.id]: event.invited_by,
          },
        });
        if (!state.servers.some((s) => s.id === event.server.id)) {
          void get()
            .loadServers()
            .then(() => get().loadMyEmojis());
        } else {
          void get().loadChannelOverwrites(event.channel.id).catch(() => {});
        }
        break;
      }
      case "member_leave":
        set((s) => ({
          membersByServer: {
            ...s.membersByServer,
            [event.server_id]: (s.membersByServer[event.server_id] || []).filter(
              (m) => m.user.id !== event.user_id,
            ),
          },
        }));
        break;
      case "voice_state_update": {
        set((s) => {
          const others = s.voiceStates.filter((v) => v.user_id !== event.user_id);
          const next = event.channel_id
            ? [
                ...others,
                {
                  user_id: event.user_id,
                  channel_id: event.channel_id,
                  muted: event.muted,
                  deafened: event.deafened,
                  streaming: event.streaming,
                  server_muted: event.server_muted ?? false,
                  server_deafened: event.server_deafened ?? false,
                },
              ]
            : others;
          // LiveKit join/leave owns local voiceChannelId. WS only syncs flags while
          // already connected, or clears membership when the server says we left.
          let local: Partial<AppState> = {};
          if (s.user?.id === event.user_id) {
            if (!event.channel_id) {
              local = {
                voiceChannelId: null,
                streaming: false,
                muted: event.muted,
                deafened: event.deafened,
              };
            } else if (s.voiceChannelId) {
              // LiveKit / syncLocalScreen owns local streaming while connected.
              local = {
                voiceChannelId: event.channel_id,
                muted: event.muted,
                deafened: event.deafened,
              };
            }
          }
          return { voiceStates: next, ...local };
        });
        break;
      }
      case "reaction_add":
      case "reaction_remove": {
        const me = state.user?.id === event.user_id;
        set((s) => {
          const list = s.messagesByChannel[event.channel_id] || [];
          return {
            messagesByChannel: {
              ...s.messagesByChannel,
              [event.channel_id]: list.map((m) => {
                if (m.id !== event.message_id) return m;
                const reactions = [...m.reactions];
                const idx = reactions.findIndex((r) => r.emoji === event.emoji);
                if (event.type === "reaction_add") {
                  if (idx >= 0) {
                    reactions[idx] = {
                      ...reactions[idx],
                      count: reactions[idx].count + 1,
                      me: reactions[idx].me || me,
                    };
                  } else {
                    reactions.push({ emoji: event.emoji, count: 1, me });
                  }
                } else if (idx >= 0) {
                  const nextCount = reactions[idx].count - 1;
                  if (nextCount <= 0) reactions.splice(idx, 1);
                  else
                    reactions[idx] = {
                      ...reactions[idx],
                      count: nextCount,
                      me: me ? false : reactions[idx].me,
                    };
                }
                return { ...m, reactions };
              }),
            },
          };
        });
        break;
      }
      case "friend_request": {
        const f = event.friendship;
        set((s) => ({
          authors: { ...s.authors, [f.peer.id]: f.peer },
          pendingInbound:
            f.requested_by !== s.user?.id
              ? upsertFriendship(s.pendingInbound, f)
              : s.pendingInbound,
          pendingOutbound:
            f.requested_by === s.user?.id
              ? upsertFriendship(s.pendingOutbound, f)
              : s.pendingOutbound,
        }));
        break;
      }
      case "friend_update": {
        const f = event.friendship;
        set((s) => {
          let pendingInbound = s.pendingInbound.filter((x) => x.id !== f.id);
          let pendingOutbound = s.pendingOutbound.filter((x) => x.id !== f.id);
          let friends = s.friends.filter((x) => x.id !== f.id);
          if (f.status === "accepted") {
            friends = upsertFriendship(friends, f);
          } else if (f.status === "pending") {
            if (f.requested_by === s.user?.id) {
              pendingOutbound = upsertFriendship(pendingOutbound, f);
            } else {
              pendingInbound = upsertFriendship(pendingInbound, f);
            }
          }
          return {
            friends,
            pendingInbound,
            pendingOutbound,
            authors: { ...s.authors, [f.peer.id]: f.peer },
          };
        });
        if (event.friendship.status === "accepted") {
          void get().loadDms();
        }
        break;
      }
      case "friend_removed":
        set((s) => ({
          friends: s.friends.filter((f) => f.id !== event.friendship_id),
          pendingInbound: s.pendingInbound.filter(
            (f) => f.id !== event.friendship_id,
          ),
          pendingOutbound: s.pendingOutbound.filter(
            (f) => f.id !== event.friendship_id,
          ),
          dmChannels: s.dmChannels.map((d) =>
            d.friendship_id === event.friendship_id
              ? { ...d, friendship_id: null }
              : d,
          ),
        }));
        break;
      case "dm_channel_create":
        set((s) => ({
          dmChannels: [
            event.channel,
            ...s.dmChannels.filter((c) => c.id !== event.channel.id),
          ],
          authors: {
            ...s.authors,
            [event.channel.peer.id]: event.channel.peer,
          },
        }));
        break;
      case "dm_message_create": {
        set((s) => ({
          authors: { ...s.authors, [event.author.id]: event.author },
        }));
        void (async () => {
          const dm = get().dmChannels.find(
            (c) => c.id === event.message.dm_channel_id,
          );
          const peerId =
            event.author.id === get().user?.id
              ? dm?.peer.id
              : event.author.id;
          if (!peerId || !get().user) return;
          try {
            await ensureIdentity(get().user!.id);
            let peerKey = get().peerPublicKeys[peerId];
            if (!peerKey) {
              const key = await api<UserIdentityKey>(
                `/api/crypto/identity/${peerId}`,
              );
              peerKey = key.public_key;
              set((s) => ({
                peerPublicKeys: {
                  ...s.peerPublicKeys,
                  [peerId]: peerKey!,
                },
              }));
            }
            const message = await decryptWire(event.message, peerKey);
            set((s) => {
              const dmId = event.message.dm_channel_id;
              if (!(dmId in s.messagesByDm) && dmId !== s.activeDmId) {
                return s;
              }
              return {
                messagesByDm: {
                  ...s.messagesByDm,
                  [dmId]: upsertDm(s.messagesByDm[dmId] || [], message),
                },
              };
            });
          } catch {
            /* ignore decrypt race */
          }
        })();
        break;
      }
      case "dm_message_update": {
        void (async () => {
          const dm = get().dmChannels.find(
            (c) => c.id === event.message.dm_channel_id,
          );
          if (!dm || !get().user) return;
          try {
            await ensureIdentity(get().user!.id);
            let peerKey = get().peerPublicKeys[dm.peer.id];
            if (!peerKey) {
              const key = await api<UserIdentityKey>(
                `/api/crypto/identity/${dm.peer.id}`,
              );
              peerKey = key.public_key;
            }
            const message = await decryptWire(event.message, peerKey);
            set((s) => ({
              messagesByDm: {
                ...s.messagesByDm,
                [event.message.dm_channel_id]: upsertDm(
                  s.messagesByDm[event.message.dm_channel_id] || [],
                  message,
                ),
              },
            }));
          } catch {
            /* ignore */
          }
        })();
        break;
      }
      case "dm_message_delete":
        set((s) => ({
          messagesByDm: {
            ...s.messagesByDm,
            [event.dm_channel_id]: (
              s.messagesByDm[event.dm_channel_id] || []
            ).filter((m) => m.id !== event.message_id),
          },
        }));
        break;
      case "dm_typing_start": {
        const expires = Date.now() + 4000;
        set((s) => {
          const prev = (s.typing[event.dm_channel_id] || []).filter(
            (t) => t.expires > Date.now() && t.username !== event.username,
          );
          return {
            typing: {
              ...s.typing,
              [event.dm_channel_id]: [
                ...prev,
                { username: event.username, expires },
              ],
            },
          };
        });
        break;
      }
      default:
        break;
    }
  },
}));

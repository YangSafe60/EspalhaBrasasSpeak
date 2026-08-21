import { create } from "zustand";
import {
  api,
  clearTokens,
  getAccessToken,
  getRefreshToken,
  setTokens,
} from "../api/client";
import type {
  AuthResponse,
  Channel,
  Invite,
  Member,
  Message,
  PermissionOverwrite,
  Role,
  Server,
  ServerRule,
  UserPublic,
  VoiceStateView,
  WsEvent,
} from "../types";

export type ModalKind =
  | null
  | "create-server"
  | "join-invite"
  | "server-settings"
  | "channel-settings"
  | "user-settings";

type TypingEntry = { username: string; expires: number };

interface AppState {
  user: UserPublic | null;
  servers: Server[];
  channelsByServer: Record<string, Channel[]>;
  membersByServer: Record<string, Member[]>;
  rolesByServer: Record<string, Role[]>;
  rulesByServer: Record<string, ServerRule[]>;
  messagesByChannel: Record<string, Message[]>;
  authors: Record<string, UserPublic>;
  voiceStates: VoiceStateView[];
  typing: Record<string, TypingEntry[]>;

  activeServerId: string | null;
  activeChannelId: string | null;
  voiceChannelId: string | null;
  muted: boolean;
  deafened: boolean;
  streaming: boolean;

  modal: ModalKind;
  settingsChannelId: string | null;
  bootstrapped: boolean;
  connecting: boolean;
  error: string | null;

  setError: (error: string | null) => void;
  setModal: (modal: ModalKind, channelId?: string | null) => void;
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
  }) => Promise<void>;

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
  createInvite: (serverId: string) => Promise<Invite>;
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

  uploadFile: (file: File) => Promise<{ id: string; url: string }>;
  applyWsEvent: (event: WsEvent) => void;
}

function upsertMessage(list: Message[], message: Message): Message[] {
  const idx = list.findIndex((m) => m.id === message.id);
  if (idx >= 0) {
    const next = list.slice();
    next[idx] = message;
    return next;
  }
  return [...list, message].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
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
  messagesByChannel: {},
  authors: {},
  voiceStates: [],
  typing: {},

  activeServerId: null,
  activeChannelId: null,
  voiceChannelId: null,
  muted: false,
  deafened: false,
  streaming: false,

  modal: null,
  settingsChannelId: null,
  bootstrapped: false,
  connecting: false,
  error: null,

  setError: (error) => set({ error }),
  setModal: (modal, channelId = null) =>
    set({ modal, settingsChannelId: channelId ?? null }),
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
    await get().loadServers();
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
    await get().loadServers();
  },

  logout: () => {
    clearTokens();
    set({
      user: null,
      servers: [],
      channelsByServer: {},
      membersByServer: {},
      rolesByServer: {},
      rulesByServer: {},
      messagesByChannel: {},
      authors: {},
      voiceStates: [],
      activeServerId: null,
      activeChannelId: null,
      voiceChannelId: null,
      modal: null,
    });
  },

  updateProfile: async (body) => {
    const user = await api<UserPublic>("/api/auth/me", {
      method: "PATCH",
      body,
    });
    set((s) => ({
      user,
      authors: { ...s.authors, [user.id]: user },
    }));
  },

  loadServers: async () => {
    const servers = await api<Server[]>("/api/servers");
    set({ servers });
    const { activeServerId } = get();
    if (!activeServerId && servers.length) {
      await get().selectServer(servers[0].id);
    } else if (activeServerId && !servers.find((s) => s.id === activeServerId)) {
      if (servers.length) await get().selectServer(servers[0].id);
      else set({ activeServerId: null, activeChannelId: null });
    }
  },

  selectServer: async (serverId) => {
    set({ activeServerId: serverId, connecting: true });
    try {
      const [channels, members, roles, rules, voiceStates] = await Promise.all([
        api<Channel[]>(`/api/servers/${serverId}/channels`),
        api<Member[]>(`/api/servers/${serverId}/members`),
        api<Role[]>(`/api/servers/${serverId}/roles`),
        api<ServerRule[]>(`/api/servers/${serverId}/rules`),
        api<VoiceStateView[]>("/api/voice/state", {
          query: { server_id: serverId },
        }),
      ]);
      const authors: Record<string, UserPublic> = { ...get().authors };
      for (const m of members) authors[m.user.id] = m.user;

      set((s) => ({
        channelsByServer: { ...s.channelsByServer, [serverId]: channels },
        membersByServer: { ...s.membersByServer, [serverId]: members },
        rolesByServer: { ...s.rolesByServer, [serverId]: roles },
        rulesByServer: { ...s.rulesByServer, [serverId]: rules },
        authors,
        voiceStates,
      }));

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
    set({ activeChannelId: channelId });
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
    return server;
  },

  joinInvite: async (code) => {
    const server = await api<Server>(`/api/invites/${code.trim()}`, {
      method: "POST",
    });
    await get().loadServers();
    await get().selectServer(server.id);
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

  createInvite: async (serverId) => {
    return api<Invite>(`/api/servers/${serverId}/invites`, {
      method: "POST",
      body: {},
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
    return api<PermissionOverwrite[]>(`/api/channels/${channelId}/overwrites`);
  },

  saveChannelOverwrites: async (channelId, overwrites) => {
    return api<PermissionOverwrite[]>(`/api/channels/${channelId}/overwrites`, {
      method: "PUT",
      body: { overwrites },
    });
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

  uploadFile: async (file) => {
    const fd = new FormData();
    fd.append("file", file);
    const res = await api<{ id: string; url: string }>("/api/media/upload", {
      method: "POST",
      formData: fd,
    });
    return res;
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
      case "message_create":
        set((s) => ({
          authors: { ...s.authors, [event.author.id]: event.author },
          messagesByChannel: {
            ...s.messagesByChannel,
            [event.message.channel_id]: upsertMessage(
              s.messagesByChannel[event.message.channel_id] || [],
              event.message,
            ),
          },
        }));
        break;
      case "message_update":
        set((s) => ({
          messagesByChannel: {
            ...s.messagesByChannel,
            [event.message.channel_id]: upsertMessage(
              s.messagesByChannel[event.message.channel_id] || [],
              event.message,
            ),
          },
        }));
        break;
      case "message_delete":
        set((s) => ({
          messagesByChannel: {
            ...s.messagesByChannel,
            [event.channel_id]: (s.messagesByChannel[event.channel_id] || []).filter(
              (m) => m.id !== event.message_id,
            ),
          },
        }));
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
        break;
      case "channel_update":
        set((s) => ({
          channelsByServer: {
            ...s.channelsByServer,
            [event.channel.server_id]: (
              s.channelsByServer[event.channel.server_id] || []
            ).map((c) => (c.id === event.channel.id ? event.channel : c)),
          },
        }));
        break;
      case "channel_delete":
        set((s) => ({
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
          activeChannelId:
            s.activeChannelId === event.channel_id ? null : s.activeChannelId,
        }));
        break;
      case "server_update":
        set((s) => ({
          servers: s.servers.map((x) =>
            x.id === event.server.id ? event.server : x,
          ),
        }));
        break;
      case "member_join":
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
        break;
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
              local = {
                voiceChannelId: event.channel_id,
                muted: event.muted,
                deafened: event.deafened,
                streaming: event.streaming,
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
      default:
        break;
    }
  },
}));

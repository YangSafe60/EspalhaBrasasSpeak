/** Servers, channels, roles, invites, emojis, and navigation. */
import { api } from "../../api/client";
import { extractCustomEmojiIds } from "../../lib/customEmoji";
import { focusMainWindow } from "../../lib/screenBridge";
import { permBits, sameId } from "../../lib/serverPerms";
import {
  channelCreateKey,
  dedupeChannelList,
  indexOverwritesByChannel,
  normalizeOverwrite,
  pendingChannelCreates,
  setChannelOverwrites,
  upsertChannelList,
} from "../helpers/channelHelpers";
import type {
  Channel,
  Invite,
  Member,
  PermissionOverwrite,
  PresenceStatus,
  Role,
  Server,
  ServerEmoji,
  ServerRule,
  UserPublic,
  VoiceStateView,
} from "../../types";
import type { AppStoreSlice } from "./sliceTypes";

export const createServerSlice: AppStoreSlice = (set, get) => ({
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
        ).then(
          (rows) => rows,
          () => null as PermissionOverwrite[] | null,
        ),
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

      const owsByChannel =
        overwrites == null
          ? null
          : indexOverwritesByChannel(
              overwrites.map(normalizeOverwrite),
              channels,
            );

      set((s) => {
        const keepIds = new Set(channels.map((c) => c.id));
        const messagesByChannel = Object.fromEntries(
          Object.entries(s.messagesByChannel).filter(([cid]) =>
            keepIds.has(cid),
          ),
        );
        let overwritesByChannel = { ...s.overwritesByChannel };
        if (owsByChannel) {
          for (const id of Object.keys(overwritesByChannel)) {
            const ch = Object.values(s.channelsByServer)
              .flat()
              .find((c) => sameId(c.id, id));
            if (
              (ch && sameId(ch.server_id, serverId)) ||
              keepIds.has(id) ||
              [...keepIds].some((kid) => sameId(kid, id))
            ) {
              delete overwritesByChannel[id];
            }
          }
          overwritesByChannel = { ...overwritesByChannel, ...owsByChannel };
        }
        return {
          channelsByServer: { ...s.channelsByServer, [serverId]: dedupeChannelList(channels) },
          membersByServer: { ...s.membersByServer, [serverId]: members },
          rolesByServer: {
            ...s.rolesByServer,
            [serverId]: roles.map((role) => ({
              ...role,
              id: String(role.id),
              server_id: String(role.server_id),
              permissions: permBits(role.permissions),
              is_everyone: Boolean(
                role.is_everyone || role.name === "@everyone",
              ),
            })),
          },
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

      // If bulk overwrite fetch failed, fall back per-channel so lock badges work.
      if (owsByChannel == null && channels.length > 0) {
        void (async () => {
          const pairs = await Promise.all(
            channels.map(async (c) => {
              try {
                const rows = await api<PermissionOverwrite[]>(
                  `/api/channels/${c.id}/overwrites`,
                );
                return [c.id, rows.map(normalizeOverwrite)] as const;
              } catch {
                return null;
              }
            }),
          );
          set((s) => {
            const overwritesByChannel = { ...s.overwritesByChannel };
            for (const pair of pairs) {
              if (!pair) continue;
              const [id, rows] = pair;
              overwritesByChannel[id] = rows;
            }
            return { overwritesByChannel };
          });
        })();
      }
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

  navigateToChannel: async (serverId, channelId) => {
    set({ friendsHome: false });
    if (get().activeServerId !== serverId) {
      await get().selectServer(serverId);
    }
    await get().selectChannel(channelId);
  },

  pushMessageToast: (toast) => {
    set((s) => {
      const withoutDup = s.messageToasts.filter((t) => t.id !== toast.id);
      const next = [...withoutDup, toast].slice(-5);
      return { messageToasts: next };
    });
  },

  dismissMessageToast: (id) => {
    set((s) => ({
      messageToasts: s.messageToasts.filter((t) => t.id !== id),
    }));
  },

  openMessageToast: async (id) => {
    const toast = get().messageToasts.find((t) => t.id === id);
    if (!toast) return;
    get().dismissMessageToast(id);
    if (toast.kind === "channel" && toast.serverId) {
      await get().navigateToChannel(toast.serverId, toast.channelId);
    } else if (toast.kind === "dm") {
      await get().selectDm(toast.channelId);
    }
    await focusMainWindow();
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

  transferOwnership: async (serverId, userId) => {
    const server = await api<Server>(
      `/api/servers/${serverId}/transfer-ownership`,
      {
        method: "POST",
        body: { user_id: userId },
      },
    );
    set((s) => ({
      servers: s.servers.map((x) => (x.id === serverId ? server : x)),
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
          id: String(role.id),
          server_id: String(role.server_id),
          permissions: permBits(role.permissions),
          is_everyone: Boolean(
            role.is_everyone || role.name === "@everyone",
          ),
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
    const key = channelCreateKey(serverId, body);
    const inflight = pendingChannelCreates.get(key);
    if (inflight) return inflight;

    const promise = (async () => {
      const channel = await api<Channel>(`/api/servers/${serverId}/channels`, {
        method: "POST",
        body,
      });
      set((s) => {
        const list = s.channelsByServer[serverId] || [];
        return {
          channelsByServer: {
            ...s.channelsByServer,
            [serverId]: upsertChannelList(list, channel),
          },
        };
      });
      return channel;
    })();

    pendingChannelCreates.set(key, promise);
    try {
      return await promise;
    } finally {
      pendingChannelCreates.delete(key);
    }
  },

  duplicateChannel: async (id) => {
    const channel = await api<Channel>(`/api/channels/${id}/duplicate`, {
      method: "POST",
    });
    set((s) => {
      const list = s.channelsByServer[channel.server_id] || [];
      return {
        channelsByServer: {
          ...s.channelsByServer,
          [channel.server_id]: upsertChannelList(list, channel),
        },
      };
    });
    void get().loadChannelOverwrites(channel.id).catch(() => {});
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
      overwritesByChannel: setChannelOverwrites(
        s.overwritesByChannel,
        channelId,
        normalized,
        s.channelsByServer,
      ),
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
      overwritesByChannel: setChannelOverwrites(
        s.overwritesByChannel,
        channelId,
        normalized,
        s.channelsByServer,
      ),
    }));
    return normalized;
  },
});

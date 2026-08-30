/** Friends, DMs, and server member moderation. */
import { api } from "../../api/client";
import {
  encryptDm,
  fingerprint,
} from "../../lib/e2e";
import { sameId } from "../../lib/serverPerms";
import {
  decryptWire,
  ensureIdentity,
  getCachedIdentity,
  upsertFriendship,
} from "../helpers/dmHelpers";
import { upsertDm } from "../helpers/messageHelpers";
import type {
  DmChannel,
  DmMessageWire,
  Friendship,
  FriendsList,
  Member,
  UserIdentityKey,
  UserPublic,
  VoiceStateView,
} from "../../types";
import type { AppStoreSlice } from "./sliceTypes";

export const createSocialSlice: AppStoreSlice = (set, get) => ({
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

  setMemberRoles: async (serverId, userId, roleIds) => {
    const member = await api<Member>(
      `/api/servers/${serverId}/members/${userId}/roles`,
      {
        method: "PUT",
        body: { role_ids: roleIds },
      },
    );
    set((s) => ({
      authors: { ...s.authors, [member.user.id]: member.user },
      membersByServer: {
        ...s.membersByServer,
        [serverId]: [
          ...(s.membersByServer[serverId] || []).filter(
            (m) => !sameId(m.user.id, userId),
          ),
          {
            ...member,
            role_ids: (member.role_ids || []).map(String),
          },
        ],
      },
    }));
    return member;
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

  timeoutMember: async (serverId, userId, body) => {
    const member = await api<Member>(
      `/api/servers/${serverId}/members/${userId}/timeout`,
      {
        method: "PUT",
        body,
      },
    );
    set((s) => ({
      authors: { ...s.authors, [member.user.id]: member.user },
      membersByServer: {
        ...s.membersByServer,
        [serverId]: [
          ...(s.membersByServer[serverId] || []).filter(
            (m) => m.user.id !== userId,
          ),
          member,
        ],
      },
      voiceStates: member.timeout_until
        ? s.voiceStates.filter((v) => v.user_id !== userId)
        : s.voiceStates,
    }));
    return member;
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
    if (!fp && getCachedIdentity()) {
      fp = await fingerprint(getCachedIdentity()!.publicKeyB64, peerKey!);
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
});

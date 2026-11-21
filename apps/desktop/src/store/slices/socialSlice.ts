/** Friends, DMs, and server member moderation. */
import { api } from "../../api/client";
import {
  encryptDm,
  encryptGroupDm,
  fingerprint,
} from "../../lib/e2e";
import { sameId } from "../../lib/serverPerms";
import {
  decryptWire,
  decryptWireResilient,
  ensureIdentity,
  fetchPeerPublicKey,
  fetchPeerPublicKeyHistory,
  getCachedIdentity,
  prefetchPeerPublicKey,
  upsertFriendship,
} from "../helpers/dmHelpers";
import { upsertDm } from "../helpers/messageHelpers";
import type {
  DmChannel,
  DmMessageWire,
  Friendship,
  FriendsList,
  Member,
  UserPublic,
  VoiceStateView,
} from "../../types";
import type { AppStoreSlice } from "./sliceTypes";

/** Encrypt for every current member of a group DM (me included). */
async function sealForGroup(
  dm: DmChannel,
  plain: string,
  myId: string,
  identity: { privateKey: CryptoKey; publicKeyB64: string },
) {
  const members = dm.members || [];
  const missing: string[] = [];
  const keyed = await Promise.all(
    members.map(async (m) => {
      if (m.id === myId) return { userId: m.id, publicKey: identity.publicKeyB64 };
      try {
        return { userId: m.id, publicKey: await fetchPeerPublicKey(m.id) };
      } catch {
        missing.push(m.display_name || m.username);
        return null;
      }
    }),
  );
  if (missing.length) {
    throw new Error(
      `${missing.join(", ")} ${missing.length === 1 ? "hasn't" : "haven't"} set up encrypted messaging yet.`,
    );
  }
  return encryptGroupDm(
    plain,
    identity.privateKey,
    keyed.filter((k): k is { userId: string; publicKey: string } => k !== null),
    dm.id,
  );
}

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
    try {
      const dmId = await get().ensureDmWithPeer(peerId);
      if (!dmId) {
        get().setError("Could not open a direct message with this user.");
        return;
      }
      await get().selectDm(dmId);
    } catch (e) {
      get().setError(
        e instanceof Error ? e.message : "Could not open a direct message with this user.",
      );
    }
  },

  startDmCallWithPeer: async (peerId) => {
    try {
      const dmId = await get().ensureDmWithPeer(peerId);
      if (!dmId) {
        get().setError("Could not start a call with this user.");
        return;
      }
      await get().selectDm(dmId);
      get().requestDmCallJoin(dmId);
    } catch (e) {
      get().setError(
        e instanceof Error ? e.message : "Could not start a call with this user.",
      );
    }
  },

  ensureDmWithPeer: async (peerId) => {
    const existing = get().dmChannels.find((d) => sameId(d.peer.id, peerId));
    if (existing) {
      try {
        await api(`/api/dms/${existing.id}/open`, { method: "POST" });
      } catch {
        /* already open or older server */
      }
      return existing.id;
    }

    const channel = await api<DmChannel>(
      `/api/dms/by-peer/${peerId}/open`,
      { method: "POST" },
    );
    set((s) => ({
      dmChannels: [
        channel,
        ...s.dmChannels.filter((d) => d.id !== channel.id),
      ],
      authors: { ...s.authors, [channel.peer.id]: channel.peer },
    }));
    return channel.id;
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

    const peerId = dm.peer.id;
    const cachePeerKey = (id: string, key: string) =>
      set((s) => ({
        peerPublicKeys: { ...s.peerPublicKeys, [id]: key },
      }));
    try {
      await prefetchPeerPublicKey(peerId, dmId, cachePeerKey);
    } catch {
      /* peer may not have registered keys yet */
    }

    const wires = await api<DmMessageWire[]>(`/api/dms/${dmId}/messages`);
    let peerHistory: string[] = [];
    try {
      peerHistory = await fetchPeerPublicKeyHistory(peerId);
    } catch {
      /* peer may not have registered keys yet */
    }
    const messages = await Promise.all(
      wires.map((w) =>
        decryptWireResilient(
          w,
          peerId,
          user.id,
          (id) => get().peerPublicKeys[id],
          cachePeerKey,
          peerHistory,
        ),
      ),
    );
    const peerKey = get().peerPublicKeys[peerId];
    let fp = get().dmFingerprints[dmId];
    // Fingerprints are per pair of people; a group has no single one.
    if (!fp && peerKey && getCachedIdentity() && !dm.is_group) {
      fp = await fingerprint(getCachedIdentity()!.publicKeyB64, peerKey);
    }
    set((s) => ({
      messagesByDm: { ...s.messagesByDm, [dmId]: messages },
      authors: {
        ...s.authors,
        [dm.peer.id]: dm.peer,
        ...Object.fromEntries((dm.members || []).map((m) => [m.id, m])),
      },
      dmFingerprints: fp
        ? { ...s.dmFingerprints, [dmId]: fp }
        : s.dmFingerprints,
    }));
  },

  sendDmMessage: async (dmId, content, attachmentIds) => {
    const user = get().user;
    const ids = (attachmentIds ?? []).filter(Boolean);
    const plain = content.trim();
    if (!user || (!plain && ids.length === 0)) return;
    const id = await ensureIdentity(user.id);
    const dm = get().dmChannels.find((c) => c.id === dmId);
    if (!dm) throw new Error("DM not found");

    if (dm.is_group) {
      const sealed = await sealForGroup(dm, plain, user.id, id);
      const wire = await api<DmMessageWire>(`/api/dms/${dmId}/messages`, {
        method: "POST",
        body: { ...sealed, sender_public_key: id.publicKeyB64, attachment_ids: ids },
      });
      const message = { ...wire, content: plain, decrypt_failed: false };
      set((s) => ({
        messagesByDm: {
          ...s.messagesByDm,
          [dmId]: upsertDm(s.messagesByDm[dmId] || [], message),
        },
        authors: { ...s.authors, [user.id]: user },
      }));
      return;
    }

    let peerKey: string;
    try {
      peerKey = await prefetchPeerPublicKey(
        dm.peer.id,
        dmId,
        (id, key) =>
          set((s) => ({
            peerPublicKeys: { ...s.peerPublicKeys, [id]: key },
          })),
      );
    } catch {
      throw new Error(
        "This person has not set up encrypted messaging on their device yet.",
      );
    }

    const { ciphertext, nonce } = await encryptDm(
      plain,
      id.privateKey,
      peerKey,
      dmId,
    );
    const wire = await api<DmMessageWire>(`/api/dms/${dmId}/messages`, {
      method: "POST",
      body: {
        ciphertext,
        nonce,
        sender_public_key: id.publicKeyB64,
        recipient_public_key: peerKey,
        attachment_ids: ids,
      },
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
    if (dm.is_group) {
      const plain = content.trim();
      let sealed: Awaited<ReturnType<typeof sealForGroup>>;
      try {
        sealed = await sealForGroup(dm, plain, user.id, id);
      } catch (e) {
        get().setError(e instanceof Error ? e.message : "Could not encrypt the message.");
        return;
      }
      const wire = await api<DmMessageWire>(`/api/dms/messages/${messageId}`, {
        method: "PATCH",
        body: { ...sealed, sender_public_key: id.publicKeyB64 },
      });
      const message = { ...wire, content: plain, decrypt_failed: false };
      set((s) => ({
        messagesByDm: {
          ...s.messagesByDm,
          [dmId]: upsertDm(s.messagesByDm[dmId] || [], message),
        },
      }));
      return;
    }
    let peerKey: string;
    try {
      peerKey = await prefetchPeerPublicKey(
        dm.peer.id,
        dmId,
        (id, key) =>
          set((s) => ({
            peerPublicKeys: { ...s.peerPublicKeys, [id]: key },
          })),
      );
    } catch {
      get().setError("Could not load encryption keys for this conversation.");
      return;
    }
    const { ciphertext, nonce } = await encryptDm(
      content.trim(),
      id.privateKey,
      peerKey,
      dmId,
    );
    const wire = await api<DmMessageWire>(`/api/dms/messages/${messageId}`, {
      method: "PATCH",
      body: {
        ciphertext,
        nonce,
        sender_public_key: id.publicKeyB64,
        recipient_public_key: peerKey,
      },
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

  createGroupDm: async (userIds, name) => {
    const channel = await api<DmChannel>("/api/dms/groups", {
      method: "POST",
      body: { user_ids: userIds, name: name?.trim() || null },
    });
    get().upsertDmChannel(channel);
    return channel.id;
  },

  addGroupDmMember: async (dmId, userId) => {
    const channel = await api<DmChannel>(`/api/dms/${dmId}/members`, {
      method: "POST",
      body: { user_id: userId },
    });
    get().upsertDmChannel(channel);
  },

  removeGroupDmMember: async (dmId, userId) => {
    await api(`/api/dms/${dmId}/members/${userId}`, { method: "DELETE" });
    if (userId === get().user?.id) get().dropDmChannel(dmId);
  },

  renameGroupDm: async (dmId, name) => {
    const channel = await api<DmChannel>(`/api/dms/${dmId}/group`, {
      method: "PATCH",
      body: { name: name.trim() || null },
    });
    get().upsertDmChannel(channel);
  },

  upsertDmChannel: (channel) => {
    set((s) => {
      const authors = { ...s.authors, [channel.peer.id]: channel.peer };
      for (const m of channel.members || []) authors[m.id] = m;
      const exists = s.dmChannels.some((d) => d.id === channel.id);
      return {
        dmChannels: exists
          ? s.dmChannels.map((d) => (d.id === channel.id ? channel : d))
          : [channel, ...s.dmChannels],
        authors,
      };
    });
  },

  dropDmChannel: (dmId) => {
    set((s) => {
      const { [dmId]: _m, ...messagesByDm } = s.messagesByDm;
      void _m;
      return {
        dmChannels: s.dmChannels.filter((d) => d.id !== dmId),
        messagesByDm,
        activeDmId: s.activeDmId === dmId ? null : s.activeDmId,
      };
    });
  },
});

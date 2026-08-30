/** Authentication, account management, and presence status. */
import {
  api,
  clearTokens,
  getAccessToken,
  getRefreshToken,
} from "../../api/client";
import { clearIdentityCache } from "../../lib/e2e";
import { normalizePresenceStatus } from "../../lib/presence";
import { applyAuth } from "../helpers/authHelpers";
import {
  ensureIdentity,
  resetIdentityCache,
} from "../helpers/dmHelpers";
import type { AuthResponse, Member, PresenceStatus, UserAccount } from "../../types";
import type { AppStoreSlice } from "./sliceTypes";

export const createAuthSlice: AppStoreSlice = (set, get) => ({
  bootstrap: async () => {
    if (!getAccessToken() || !getRefreshToken()) {
      set({ bootstrapped: true, user: null });
      return;
    }
    set({ connecting: true });
    try {
      const account = await api<UserAccount>("/api/auth/me");
      set({ user: account });
      await get().loadMyStatus();
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
        dmCallId: null,
        streaming: false,
        voiceStates: get().voiceStates.filter((v) => v.user_id !== account.id),
      });
      await get().loadServers();
      void get().loadMyEmojis();
      try {
        const id = await ensureIdentity(account.id);
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
    resetIdentityCache();
    clearIdentityCache();
    const account = await api<UserAccount>("/api/auth/me");
    set({ user: account });
    await get().loadMyStatus();
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
    resetIdentityCache();
    clearIdentityCache();
    const account = await api<UserAccount>("/api/auth/me");
    set({ user: account });
    await get().loadMyStatus();
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
    resetIdentityCache();
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
      myStatusRevision: 0,
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
      messageToasts: [],
    });
  },

  updateProfile: async (body) => {
    const account = await api<UserAccount>("/api/auth/me", {
      method: "PATCH",
      body,
    });
    set((s) => {
      const membersByServer: Record<string, Member[]> = {};
      for (const [sid, members] of Object.entries(s.membersByServer)) {
        membersByServer[sid] = members.map((m) =>
          m.user.id === account.id ? { ...m, user: account } : m,
        );
      }
      return {
        user: account,
        authors: { ...s.authors, [account.id]: account },
        membersByServer,
        friends: s.friends.map((f) =>
          f.peer.id === account.id ? { ...f, peer: account } : f,
        ),
        dmChannels: s.dmChannels.map((d) =>
          d.peer.id === account.id ? { ...d, peer: account } : d,
        ),
      };
    });
  },

  changePassword: async (currentPassword, newPassword) => {
    await api("/api/users/me/password", {
      method: "PUT",
      body: {
        current_password: currentPassword,
        new_password: newPassword,
      },
    });
  },

  disableAccount: async (password) => {
    await api("/api/users/me/disable", {
      method: "POST",
      body: { password },
    });
  },

  deleteAccount: async (password) => {
    await api("/api/users/me", {
      method: "DELETE",
      body: { password },
    });
  },

  loadMyStatus: async () => {
    const revAtStart = get().myStatusRevision;
    try {
      const res = await api<{ status: PresenceStatus }>("/api/users/me/presence");
      if (get().myStatusRevision !== revAtStart) return;
      const status = normalizePresenceStatus(res.status);
      set((s) => ({
        myStatus: status,
        presenceByUser: s.user
          ? {
              ...s.presenceByUser,
              [s.user.id]: status,
            }
          : s.presenceByUser,
      }));
    } catch {
      /* older servers without presence API */
    }
  },

  setMyStatus: async (status) => {
    const normalized = normalizePresenceStatus(status);
    const prev = get().myStatus;
    const rev = get().myStatusRevision + 1;
    set((s) => ({
      myStatusRevision: rev,
      myStatus: normalized,
      presenceByUser: s.user
        ? { ...s.presenceByUser, [s.user.id]: normalized }
        : s.presenceByUser,
    }));
    try {
      const res = await api<{ status: PresenceStatus }>("/api/users/me/presence", {
        method: "PUT",
        body: { status: normalized },
      });
      const next = normalizePresenceStatus(res.status || normalized);
      set((s) => ({
        myStatus: next,
        presenceByUser: s.user
          ? { ...s.presenceByUser, [s.user.id]: next }
          : s.presenceByUser,
      }));
    } catch (error) {
      if (get().myStatusRevision === rev) {
        set((s) => ({
          myStatusRevision: rev - 1,
          myStatus: prev,
          presenceByUser: s.user
            ? { ...s.presenceByUser, [s.user.id]: prev }
            : s.presenceByUser,
        }));
      }
      throw error;
    }
  },
});

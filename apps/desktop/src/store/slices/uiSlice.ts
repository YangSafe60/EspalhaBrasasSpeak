/** UI state: modals, mini profile, channel mutes, and navigation helpers. */
import {
  pruneExpiredMutes,
  saveChannelMutes,
} from "../../lib/channelMutePrefs";
import type { AppStoreSlice } from "./sliceTypes";

export const createUiSlice: AppStoreSlice = (set, get) => ({
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
  mentionMemberInChat: (username) => {
    const trimmed = username.trim();
    const { activeServerId, activeChannelId, channelsByServer } = get();
    if (!activeServerId || !trimmed) return;
    const channels = channelsByServer[activeServerId] || [];
    const active = channels.find((c) => c.id === activeChannelId);
    let targetId =
      active?.channel_type === "text" ? activeChannelId : null;
    if (!targetId) {
      targetId =
        channels.find((c) => c.channel_type === "text")?.id ?? null;
    }
    if (!targetId) {
      set({ error: "No text channel to mention in." });
      return;
    }
    if (targetId !== activeChannelId) {
      void get().selectChannel(targetId);
    }
    set({
      pendingComposerInsert: {
        channelId: targetId,
        text: `@${trimmed} `,
      },
    });
  },
  clearPendingComposerInsert: () => set({ pendingComposerInsert: null }),
  requestVoiceJoin: (channelId) =>
    set({ pendingVoiceJoinChannelId: channelId }),
  clearPendingVoiceJoin: () => set({ pendingVoiceJoinChannelId: null }),
  requestDmCallJoin: (dmId) => set({ pendingDmCallJoinId: dmId }),
  clearPendingDmCallJoin: () => set({ pendingDmCallJoinId: null }),
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
});

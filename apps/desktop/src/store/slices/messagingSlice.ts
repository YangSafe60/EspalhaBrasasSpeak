/** Channel messaging: load, send, edit, delete, reactions, and typing. */
import { api } from "../../api/client";
import { upsertMessage } from "../helpers/messageHelpers";
import type { Message } from "../../types";
import type { AppStoreSlice } from "./sliceTypes";

export const createMessagingSlice: AppStoreSlice = (set, get) => ({
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
});

/** Channel messaging: load, send, edit, delete, reactions, and typing. */
import { api } from "../../api/client";
import { upsertMessage } from "../helpers/messageHelpers";
import type { Message } from "../../types";
import type { AppStoreSlice } from "./sliceTypes";

/** Messages per page (the server allows up to 100). */
const PAGE = 50;

export const createMessagingSlice: AppStoreSlice = (set, get) => ({
  loadMessages: async (channelId) => {
    const messages = await api<Message[]>(`/api/channels/${channelId}/messages`, {
      query: { limit: PAGE },
    });
    set((s) => {
      const { [channelId]: _d, ...historyDoneByChannel } = s.historyDoneByChannel;
      void _d;
      return {
        messagesByChannel: {
          ...s.messagesByChannel,
          // API returns chronological (oldest → newest)
          [channelId]: messages,
        },
        historyDoneByChannel:
          messages.length < PAGE ? { ...historyDoneByChannel, [channelId]: true } : historyDoneByChannel,
      };
    });
  },

  loadOlderMessages: async (channelId) => {
    const current = get().messagesByChannel[channelId] || [];
    const oldest = current[0];
    if (!oldest || get().historyDoneByChannel[channelId]) return 0;
    const older = await api<Message[]>(`/api/channels/${channelId}/messages`, {
      query: { before: oldest.id, limit: PAGE },
    });
    set((s) => {
      const list = s.messagesByChannel[channelId] || [];
      const have = new Set(list.map((m) => m.id));
      const fresh = older.filter((m) => !have.has(m.id));
      return {
        messagesByChannel: { ...s.messagesByChannel, [channelId]: [...fresh, ...list] },
        historyDoneByChannel:
          older.length < PAGE
            ? { ...s.historyDoneByChannel, [channelId]: true }
            : s.historyDoneByChannel,
      };
    });
    return older.length;
  },

  setReplyTo: (channelId, messageId) =>
    set((s) => {
      const { [channelId]: _old, ...rest } = s.replyToByChannel;
      return { replyToByChannel: messageId ? { ...rest, [channelId]: messageId } : rest };
    }),

  sendMessage: async (channelId, content, attachmentIds, replyToId) => {
    const message = await api<Message>(`/api/channels/${channelId}/messages`, {
      method: "POST",
      body: {
        content,
        attachment_ids: attachmentIds,
        reply_to_id: replyToId || undefined,
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

  setMessagePinned: async (messageId, pinned) => {
    const message = await api<Message>(`/api/messages/${messageId}/pin`, {
      method: pinned ? "PUT" : "DELETE",
    });
    set((s) => ({
      messagesByChannel: {
        ...s.messagesByChannel,
        [message.channel_id]: upsertMessage(s.messagesByChannel[message.channel_id] || [], message),
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

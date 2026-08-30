/** WebSocket event handler: real-time sync for messages, presence, voice, and social. */
import { api } from "../../api/client";
import { isAppFocused } from "../../lib/appFocus";
import { channelIsMuted } from "../../lib/channelMutePrefs";
import { messagePreview } from "../../lib/messagePreview";
import { playMessageNotify } from "../../lib/messageNotify";
import { normalizePresenceStatus } from "../../lib/presence";
import { permBits, sameId } from "../../lib/serverPerms";
import { upsertChannelList } from "../helpers/channelHelpers";
import {
  decryptWire,
  ensureIdentity,
  upsertFriendship,
} from "../helpers/dmHelpers";
import { upsertDm, upsertMessage } from "../helpers/messageHelpers";
import type { AppState } from "../appStoreTypes";
import type { UserIdentityKey } from "../../types";
import type { AppStoreSlice } from "./sliceTypes";

export const createWsSlice: AppStoreSlice = (set, get) => ({
  applyWsEvent: (event) => {
    const state = get();
    switch (event.type) {
      case "ready":
        set({
          user: {
            ...event.user,
            email: state.user?.email ?? "",
          },
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
        if (
          !isSelf &&
          !muted &&
          (!isAppFocused() || !isActive || state.friendsHome)
        ) {
          const channel = Object.values(state.channelsByServer)
            .flat()
            .find((c) => c.id === cid);
          if (channel?.channel_type === "text" && channel.server_id) {
            get().pushMessageToast({
              id: event.message.id,
              kind: "channel",
              channelId: cid,
              serverId: channel.server_id,
              channelName: channel.name,
              authorName:
                event.author.display_name || event.author.username,
              authorAvatar: event.author.avatar_url,
              preview: messagePreview(event.message.content || ""),
            });
          }
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
        set((s) => {
          const status = normalizePresenceStatus(event.status);
          const isSelf = Boolean(s.user && sameId(s.user.id, event.user_id));
          return {
            presenceByUser: {
              ...s.presenceByUser,
              [event.user_id]: isSelf ? s.myStatus : status,
            },
          };
        });
        break;
      case "channel_create":
        set((s) => {
          const serverKey =
            Object.keys(s.channelsByServer).find((id) =>
              sameId(id, event.channel.server_id),
            ) || event.channel.server_id;
          return {
            channelsByServer: {
              ...s.channelsByServer,
              [serverKey]: upsertChannelList(
                s.channelsByServer[serverKey] || [],
                event.channel,
              ),
            },
          };
        });
        // Overwrite saves rebroadcast as channel_create — refresh lock state.
        void get().loadChannelOverwrites(event.channel.id).catch(() => {});
        break;
      case "channel_update":
        set((s) => {
          const serverKey =
            Object.keys(s.channelsByServer).find((id) =>
              sameId(id, event.channel.server_id),
            ) || event.channel.server_id;
          const list = s.channelsByServer[serverKey] || [];
          return {
            channelsByServer: {
              ...s.channelsByServer,
              [serverKey]: upsertChannelList(list, event.channel),
            },
          };
        });
        break;
      case "channel_delete":
        set((s) => {
          const serverKey =
            Object.keys(s.channelsByServer).find((id) =>
              sameId(id, event.server_id),
            ) || event.server_id;
          const overwritesByChannel = Object.fromEntries(
            Object.entries(s.overwritesByChannel).filter(
              ([id]) => !sameId(id, event.channel_id),
            ),
          );
          return {
            channelsByServer: {
              ...s.channelsByServer,
              [serverKey]: (s.channelsByServer[serverKey] || [])
                .filter((c) => !sameId(c.id, event.channel_id))
                .map((c) =>
                  sameId(c.category_id, event.channel_id)
                    ? { ...c, category_id: null }
                    : c,
                ),
            },
            overwritesByChannel,
            activeChannelId: sameId(s.activeChannelId, event.channel_id)
              ? null
              : s.activeChannelId,
          };
        });
        break;
      case "server_update":
        set((s) => ({
          servers: s.servers.map((x) =>
            sameId(x.id, event.server.id) ? event.server : x,
          ),
        }));
        break;
      case "member_join": {
        const joinedSelf = state.user?.id === event.member.user.id;
        const knownServer = state.servers.some((s) =>
          sameId(s.id, event.member.server_id),
        );
        set((s) => {
          const serverKey =
            Object.keys(s.membersByServer).find((id) =>
              sameId(id, event.member.server_id),
            ) || event.member.server_id;
          return {
            authors: { ...s.authors, [event.member.user.id]: event.member.user },
            membersByServer: {
              ...s.membersByServer,
              [serverKey]: [
                ...(s.membersByServer[serverKey] || []).filter(
                  (m) => !sameId(m.user.id, event.member.user.id),
                ),
                {
                  ...event.member,
                  role_ids: (event.member.role_ids || []).map(String),
                },
              ],
            },
          };
        });
        // Friend invite: pull the new server into the rail when we were added.
        if (joinedSelf && !knownServer) {
          void get().loadServers().then(() => get().loadMyEmojis());
        } else if (joinedSelf) {
          void get().loadMyEmojis();
        }
        break;
      }
      case "member_update":
        set((s) => {
          const serverKey =
            Object.keys(s.membersByServer).find((id) =>
              sameId(id, event.member.server_id),
            ) || event.member.server_id;
          return {
            authors: { ...s.authors, [event.member.user.id]: event.member.user },
            membersByServer: {
              ...s.membersByServer,
              [serverKey]: [
                ...(s.membersByServer[serverKey] || []).filter(
                  (m) => !sameId(m.user.id, event.member.user.id),
                ),
                {
                  ...event.member,
                  role_ids: (event.member.role_ids || []).map(String),
                },
              ],
            },
            voiceStates: event.member.timeout_until
              ? s.voiceStates.filter(
                  (v) => !sameId(v.user_id, event.member.user.id),
                )
              : s.voiceStates,
          };
        });
        break;
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
        set((s) => {
          const serverKey =
            Object.keys(s.membersByServer).find((id) =>
              sameId(id, event.server_id),
            ) || event.server_id;
          return {
            membersByServer: {
              ...s.membersByServer,
              [serverKey]: (s.membersByServer[serverKey] || []).filter(
                (m) => !sameId(m.user.id, event.user_id),
              ),
            },
          };
        });
        break;
      case "role_create":
      case "role_update":
        set((s) => {
          const serverKey =
            Object.keys(s.rolesByServer).find((id) =>
              sameId(id, event.role.server_id),
            ) || event.role.server_id;
          const normalized = {
            ...event.role,
            id: String(event.role.id),
            server_id: String(event.role.server_id),
            permissions: permBits(event.role.permissions),
            is_everyone: Boolean(
              event.role.is_everyone || event.role.name === "@everyone",
            ),
          };
          const list = s.rolesByServer[serverKey] || [];
          const next = list.some((r) => sameId(r.id, normalized.id))
            ? list.map((r) => (sameId(r.id, normalized.id) ? normalized : r))
            : [...list, normalized];
          return {
            rolesByServer: {
              ...s.rolesByServer,
              [serverKey]: next,
            },
          };
        });
        break;
      case "role_delete":
        set((s) => {
          const serverKey =
            Object.keys(s.rolesByServer).find((id) =>
              sameId(id, event.server_id),
            ) || event.server_id;
          return {
            rolesByServer: {
              ...s.rolesByServer,
              [serverKey]: (s.rolesByServer[serverKey] || []).filter(
                (r) => !sameId(r.id, event.role_id),
              ),
            },
            membersByServer: {
              ...s.membersByServer,
              [serverKey]: (s.membersByServer[serverKey] || []).map((m) => ({
                ...m,
                role_ids: (m.role_ids || []).filter(
                  (id) => !sameId(id, event.role_id),
                ),
              })),
            },
          };
        });
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
      case "dm_call_update": {
        set((s) => {
          const list = s.dmCallByChannel[event.dm_channel_id] || [];
          const others = list.filter((p) => !sameId(p.user_id, event.user_id));
          const next = event.active
            ? [
                ...others,
                {
                  user_id: event.user_id,
                  muted: event.muted,
                  deafened: event.deafened,
                  streaming: event.streaming,
                },
              ]
            : others;
          let local: Partial<typeof s> = {};
          if (s.user?.id && sameId(s.user.id, event.user_id)) {
            if (!event.active) {
              local = { dmCallId: null, streaming: false };
            } else if (s.dmCallId) {
              local = {
                muted: event.muted,
                deafened: event.deafened,
                streaming: event.streaming,
              };
            }
          }
          return {
            dmCallByChannel: {
              ...s.dmCallByChannel,
              [event.dm_channel_id]: next,
            },
            ...local,
          };
        });
        break;
      }
      default:
        break;
    }
  },
});

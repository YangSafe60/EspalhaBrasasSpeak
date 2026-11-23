import {
  Fragment,
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { MessageMoreMenu, ReplyIcon } from "./MessageMoreMenu";
import type { ContextMenuItem } from "./ContextMenu";
import logoMark from "../assets/logo-mark.png";
import { messageMentionsMe, type MentionContext } from "../lib/mentions";
import { effectiveChannelPerms, effectiveServerPerms, hasPerm, Perm } from "../lib/serverPerms";
import { matchCustomEmojiToken } from "../lib/customEmoji";
import { mediaUrl } from "../lib/mediaUrl";
import { MAX_MESSAGE_CHARS, messageLength } from "../lib/messageLimits";
import { useStableHandlers } from "../hooks/useStableHandlers";
import { ChannelComposer } from "./ChannelComposer";
import { CharCounter } from "./CharCounter";
import { ConfirmDialog } from "./ConfirmDialog";
import { EmojiPickerButton } from "./EmojiPickerButton";
import { MessageAttachment } from "./MessageAttachment";
import { MessageContent } from "./MessageContent";
import { MessageEmbeds } from "./MessageEmbeds";
import { MessageSearch } from "./MessageSearch";
import { PinIcon, PinnedMessagesButton } from "./PinnedMessagesButton";
import { PollCard } from "./PollCard";
import { PlayerGroupCard } from "./PlayerGroupCard";
import { ForwardDialog } from "./ForwardDialog";
import { useAppStore } from "../store/appStore";
import type { Atmosphere, Channel, Member, Message, ReactionSummary, Role, UserPublic } from "../types";

const EMPTY_MESSAGES: Message[] = [];
const EMPTY_MEMBERS: Member[] = [];
const EMPTY_ROLES: Role[] = [];

const QUICK_EMOJIS = ["👍", "🔥", "😂"];
/** Discord-like: group consecutive messages from the same author within this window. */
const GROUP_WINDOW_MS = 7 * 60 * 1000;


function shouldStartGroup(prev: Message | undefined, current: Message): boolean {
  if (!prev) return true;
  // App-written messages (welcome) stand alone, and so does what follows.
  if (prev.system || current.system) return true;
  if (prev.author_id !== current.author_id) return true;
  const gap = new Date(current.created_at).getTime() - new Date(prev.created_at).getTime();
  return gap > GROUP_WINDOW_MS;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Row callbacks. The object identity never changes, so rows can be memoized. */
type RowActions = {
  openProfile: (userId: string, e: MouseEvent) => void;
  react: (m: Message, emoji: string) => void;
  toggleSelect: (m: Message, e: MouseEvent) => void;
  startEdit: (id: string) => void;
  cancelEdit: () => void;
  saveEdit: (id: string, content: string) => Promise<void>;
  remove: (m: Message) => void;
  reply: (m: Message) => void;
  jumpTo: (messageId: string) => void;
  togglePin: (m: Message) => void;
  forward: (m: Message) => void;
  /** Open the message's thread, starting it if needed. */
  openThread: (m: Message) => void;
};

/** The message a reply points at, as shown above the reply. */
type ReplyQuote = { authorName: string; text: string } | null;

export function MessageView() {
  const activeChannelId = useAppStore((s) => s.activeChannelId);
  const channelsByServer = useAppStore((s) => s.channelsByServer);
  const messages = useAppStore((s) => {
    const id = s.activeChannelId;
    if (!id) return EMPTY_MESSAGES;
    return s.messagesByChannel[id] ?? EMPTY_MESSAGES;
  });
  const authors = useAppStore((s) => s.authors);
  const user = useAppStore((s) => s.user);
  const activeServerId = useAppStore((s) => s.activeServerId);
  const openMiniProfile = useAppStore((s) => s.openMiniProfile);
  const editMessage = useAppStore((s) => s.editMessage);
  const deleteMessage = useAppStore((s) => s.deleteMessage);
  const toggleReaction = useAppStore((s) => s.toggleReaction);
  const createThread = useAppStore((s) => s.createThread);
  const selectChannel = useAppStore((s) => s.selectChannel);
  const [forwardSource, setForwardSource] = useState<{ content: string; attachments: Message["attachments"] } | null>(null);
  const setReplyTo = useAppStore((s) => s.setReplyTo);
  const setMessagePinned = useAppStore((s) => s.setMessagePinned);
  const unreadMarker = useAppStore((s) => s.unreadMarker);
  const resolveCustomEmojis = useAppStore((s) => s.resolveCustomEmojis);

  const channel: Channel | undefined = useMemo(
    () =>
      activeChannelId
        ? Object.values(channelsByServer)
            .flat()
            .find((c) => c.id === activeChannelId)
        : undefined,
    [channelsByServer, activeChannelId],
  );
  const serverId = channel?.server_id;
  /** In a thread: the channel it was started in. */
  const parentChannel = useMemo(
    () =>
      channel?.parent_channel_id
        ? Object.values(channelsByServer).flat().find((c) => c.id === channel.parent_channel_id)
        : undefined,
    [channelsByServer, channel?.parent_channel_id],
  );
  const server = useAppStore((s) =>
    serverId ? s.servers.find((sv) => sv.id === serverId) : undefined,
  );
  const members = useAppStore((s) =>
    serverId ? s.membersByServer[serverId] ?? EMPTY_MEMBERS : EMPTY_MEMBERS,
  );
  const roles = useAppStore((s) =>
    serverId ? s.rolesByServer[serverId] ?? EMPTY_ROLES : EMPTY_ROLES,
  );

  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Message | null>(null);
  const [pendingBulkDelete, setPendingBulkDelete] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [deleting, setDeleting] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const loadOlderMessages = useAppStore((s) => s.loadOlderMessages);
  const historyDone = useAppStore((s) =>
    activeChannelId ? Boolean(s.historyDoneByChannel[activeChannelId]) : true,
  );
  const [loadingOlder, setLoadingOlder] = useState(false);
  /** Scroll height before older messages were added on top, to keep our place. */
  const restoreFrom = useRef<number | null>(null);

  const me = useMemo(() => members.find((m) => m.user.id === user?.id), [members, user?.id]);
  const myPerms = useMemo(
    () => effectiveServerPerms(server, roles, me, user?.id),
    [server, roles, me, user?.id],
  );
  const canMentionEveryone = hasPerm(myPerms, Perm.MENTION_EVERYONE);
  // Manage Messages in this channel (role overwrites included): may delete
  // other people's messages, like the server allows.
  const channelOverwrites = useAppStore((s) =>
    activeChannelId ? s.overwritesByChannel[activeChannelId] : undefined,
  );
  const canManageMessages = useMemo(
    () =>
      hasPerm(
        effectiveChannelPerms(server, roles, me, user?.id, channelOverwrites),
        Perm.MANAGE_MESSAGES,
      ),
    [server, roles, me, user?.id, channelOverwrites],
  );
  const canDelete = (m: Message) => m.author_id === user?.id || canManageMessages;
  const canSendHere = useMemo(
    () => hasPerm(effectiveChannelPerms(server, roles, me, user?.id, channelOverwrites), Perm.SEND_MESSAGES),
    [server, roles, me, user?.id, channelOverwrites],
  );

  const mentionCtx = useMemo<MentionContext>(
    () => ({
      members: members.map((m) => m.user),
      roles,
      me: user,
      myRoleIds: me?.role_ids,
    }),
    [members, roles, user, me?.role_ids],
  );

  // "New messages" divider: pinned to the first unread message when the
  // channel was opened, so live messages arriving later don't move it.
  const [dividerId, setDividerId] = useState<string | null>(null);
  useEffect(() => {
    setDividerId(null);
  }, [activeChannelId]);
  useEffect(() => {
    if (dividerId || !unreadMarker || unreadMarker.channelId !== activeChannelId) return;
    if (messages.length === 0) return;
    const idx = Math.max(0, messages.length - unreadMarker.count);
    setDividerId(messages[idx]?.id ?? null);
  }, [dividerId, unreadMarker, activeChannelId, messages]);

  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);
  const quoteFor = (m: Message): ReplyQuote | undefined => {
    if (!m.reply_to_id) return undefined;
    const target = byId.get(m.reply_to_id);
    if (!target) return null; // deleted, or older than what's loaded
    const text =
      target.content ||
      (target.attachments?.length ? "Attachment" : "");
    return {
      authorName: authors[target.author_id]?.display_name || "Unknown",
      text: text.length > 140 ? `${text.slice(0, 140)}…` : text,
    };
  };

  const mentionedIds = useMemo(() => {
    const out = new Set<string>();
    for (const m of messages) {
      if (m.content && messageMentionsMe(m.content, mentionCtx)) out.add(m.id);
    }
    return out;
  }, [messages, mentionCtx]);

  // Follow new messages only when already near the bottom (or it's mine), so
  // reading older history isn't interrupted. Older pages prepended on top
  // don't change the newest message, so they don't scroll either.
  const newestId = messages[messages.length - 1]?.id;
  const newestMine = messages[messages.length - 1]?.author_id === user?.id;
  const lastChannel = useRef<string | null>(null);
  const lastNewest = useRef<string | undefined>(undefined);
  useEffect(() => {
    const el = listRef.current;
    const switched = lastChannel.current !== activeChannelId;
    // First page of a channel (nothing shown before): jump, don't animate.
    const firstLoad = lastNewest.current === undefined;
    lastChannel.current = activeChannelId;
    lastNewest.current = newestId;
    if (switched || firstLoad) {
      bottomRef.current?.scrollIntoView();
      return;
    }
    const nearBottom = !el || el.scrollHeight - el.scrollTop - el.clientHeight < 200;
    if (nearBottom || newestMine) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newestId, activeChannelId]);

  // After older messages land on top, keep the same messages on screen.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el || restoreFrom.current == null) return;
    el.scrollTop += el.scrollHeight - restoreFrom.current;
    restoreFrom.current = null;
  }, [messages]);

  async function maybeLoadOlder() {
    const el = listRef.current;
    if (!el || !activeChannelId || loadingOlder || historyDone || messages.length === 0) return;
    if (el.scrollTop > 300) return;
    setLoadingOlder(true);
    restoreFrom.current = el.scrollHeight;
    try {
      const n = await loadOlderMessages(activeChannelId);
      if (n === 0) restoreFrom.current = null;
    } catch {
      restoreFrom.current = null;
    } finally {
      setLoadingOlder(false);
    }
  }

  useEffect(() => {
    setEditingId(null);
    setSelectedIds(new Set());
    setPendingBulkDelete(false);
    setPendingDelete(null);
  }, [activeChannelId]);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape" && selectedIds.size > 0) {
        setSelectedIds(new Set());
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedIds.size > 0 && !editingId) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        e.preventDefault();
        setPendingDelete(null);
        setPendingBulkDelete(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedIds, editingId]);

  useEffect(() => {
    for (const m of messages) {
      for (const r of m.reactions) {
        if (matchCustomEmojiToken(r.emoji)) void resolveCustomEmojis(r.emoji);
      }
    }
  }, [messages, resolveCustomEmojis]);

  const actions = useStableHandlers<RowActions>({
    openProfile: (userId, e) =>
      openMiniProfile({ userId, serverId: activeServerId, x: e.clientX, y: e.clientY }),
    react: (m, emoji) => {
      const existing = m.reactions.find((r) => r.emoji === emoji);
      void toggleReaction(m.id, emoji, !!existing?.me);
    },
    toggleSelect: (m, e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (!canDelete(m)) return;
      const t = e.target as HTMLElement;
      if (t.closest("button, a, input, textarea, .emoji-picker-root")) return;
      e.preventDefault();
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(m.id)) next.delete(m.id);
        else next.add(m.id);
        return next;
      });
    },
    startEdit: (id) => setEditingId(id),
    cancelEdit: () => setEditingId(null),
    saveEdit: async (id, content) => {
      await editMessage(id, content);
      setEditingId((cur) => (cur === id ? null : cur));
    },
    togglePin: (m) => {
      void setMessagePinned(m.id, !m.pinned_at).catch(() => undefined);
    },
    reply: (m) => {
      setReplyTo(m.channel_id, m.id);
      requestAnimationFrame(() =>
        (document.querySelector(".composer textarea") as HTMLTextAreaElement | null)?.focus(),
      );
    },
    forward: (m) => setForwardSource({ content: m.content, attachments: m.attachments || [] }),
    openThread: (m) => {
      if (m.thread) {
        void selectChannel(m.thread.id);
        return;
      }
      // Name it after the start of the message (rename like any channel).
      const words = m.content.replace(/\s+/g, " ").trim();
      const name = words ? (words.length > 40 ? `${words.slice(0, 40)}…` : words) : "Thread";
      void createThread(m.id, name).then((t) => selectChannel(t.id)).catch(() => undefined);
    },
    jumpTo: (messageId) => {
      const el = document.getElementById(`msg-${messageId}`);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.remove("flash");
      void el.offsetWidth;
      el.classList.add("flash");
    },
    remove: (m) => {
      if (selectedIds.size > 1 && selectedIds.has(m.id)) {
        setPendingDelete(null);
        setPendingBulkDelete(true);
        return;
      }
      setPendingBulkDelete(false);
      setPendingDelete(m);
    },
  });

  if (!channel || channel.channel_type !== "text") {
    return (
      <main className="message-view empty-state">
        <div className="empty-brand">
          <img className="brand-logo-mark" src={logoMark} alt="" />
          <p className="brand-mark inline">Espalha Brasas</p>
          <h2>Pick a text channel</h2>
          <p className="muted">Or hop into voice when you’re ready to talk.</p>
        </div>
      </main>
    );
  }

  const atmosphere = (channel.atmosphere || "") as Atmosphere;
  const textColor = channel.text_color || undefined;

  async function confirmDelete() {
    setDeleting(true);
    try {
      if (pendingBulkDelete) {
        const toDelete = messages.filter(
          (m) => selectedIds.has(m.id) && canDelete(m),
        );
        await Promise.all(toDelete.map((m) => deleteMessage(m.id, m.channel_id)));
        if (editingId && selectedIds.has(editingId)) setEditingId(null);
        setSelectedIds(new Set());
        setPendingBulkDelete(false);
      } else if (pendingDelete) {
        await deleteMessage(pendingDelete.id, pendingDelete.channel_id);
        if (editingId === pendingDelete.id) setEditingId(null);
        setSelectedIds((prev) => {
          if (!prev.has(pendingDelete.id)) return prev;
          const next = new Set(prev);
          next.delete(pendingDelete.id);
          return next;
        });
        setPendingDelete(null);
      }
    } finally {
      setDeleting(false);
    }
  }

  return (
    <main
      className={`message-view${atmosphere ? ` atmosphere-${atmosphere}` : ""}`}
      style={textColor ? { color: textColor } : undefined}
    >
      {atmosphere === "gaming" && <div className="channel-dim" />}

      <header className="message-header">
        {parentChannel ? (
          <div className="thread-header">
            <button
              type="button"
              className="thread-back"
              title={`Back to #${parentChannel.name}`}
              onClick={() => void selectChannel(parentChannel.id)}
            >
              <span className="ch-icon">#</span>
              {parentChannel.name}
            </button>
            <span className="thread-sep" aria-hidden>›</span>
            <h2>
              <ThreadIcon /> {channel.name}
            </h2>
          </div>
        ) : (
          <div>
            <h2>
              <span className="ch-icon">#</span> {channel.name}
            </h2>
            {channel.topic && <p className="topic">{channel.topic}</p>}
          </div>
        )}
        <div className="message-header-actions">
          <PinnedMessagesButton channelId={channel.id} onJump={actions.jumpTo} />
          <MessageSearch serverId={channel.server_id} onJump={actions.jumpTo} />
        </div>
      </header>

      <div className="message-list" ref={listRef} onScroll={() => void maybeLoadOlder()}>
        {historyDone && messages.length > 0 ? (
          <div className="history-start">
            <span className="ch-icon">#</span>
            <p>
              This is the start of <strong>#{channel.name}</strong>.
            </p>
          </div>
        ) : loadingOlder ? (
          <p className="muted tiny history-loading">Loading older messages…</p>
        ) : null}
        {messages.map((m, i) => {
          return (
            <Fragment key={m.id}>
            {m.id === dividerId && (
              <div className="new-messages-divider" role="separator">
                <span>New messages</span>
              </div>
            )}
            <MessageRow
              m={m}
              author={authors[m.author_id]}
              isGroupStart={Boolean(m.reply_to_id) || shouldStartGroup(messages[i - 1], m)}
              replyQuote={quoteFor(m)}
              mine={user?.id === m.author_id}
              canDelete={canDelete(m)}
              canPin={canManageMessages}
              editing={editingId === m.id}
              selected={selectedIds.has(m.id)}
              mentioned={mentionedIds.has(m.id)}
              serverId={channel.server_id}
              canThread={!channel.parent_channel_id && canSendHere}
              actions={actions}
            />
            </Fragment>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {selectedIds.size > 0 && (
        <div className="message-selection-bar" role="status">
          <span>
            {selectedIds.size} message{selectedIds.size === 1 ? "" : "s"} selected
          </span>
          <div className="row">
            <button type="button" className="btn ghost sm" onClick={() => setSelectedIds(new Set())}>
              Clear
            </button>
            <button
              type="button"
              className="btn danger sm"
              onClick={() => {
                setPendingDelete(null);
                setPendingBulkDelete(true);
              }}
            >
              Delete
            </button>
          </div>
        </div>
      )}

      <ChannelComposer
        channel={channel}
        mentionCtx={mentionCtx}
        canMentionEveryone={canMentionEveryone}
        slowmodeExempt={canManageMessages}
      />

      {forwardSource && <ForwardDialog source={forwardSource} onClose={() => setForwardSource(null)} />}
      <ConfirmDialog
        open={!!pendingDelete || pendingBulkDelete}
        title={
          pendingBulkDelete
            ? `Delete ${selectedIds.size} message${selectedIds.size === 1 ? "" : "s"}?`
            : "Delete message?"
        }
        description={
          pendingBulkDelete
            ? "Selected messages will be permanently removed for everyone in the channel."
            : pendingDelete && pendingDelete.author_id !== user?.id
              ? `This message from ${authors[pendingDelete.author_id]?.display_name || "another member"} will be permanently removed for everyone in the channel.`
              : pendingDelete?.content
                ? `“${pendingDelete.content.slice(0, 120)}${pendingDelete.content.length > 120 ? "…" : ""}” will be gone for everyone.`
                : "This message will be permanently removed for everyone in the channel."
        }
        confirmLabel={pendingBulkDelete ? "Delete Messages" : "Delete Message"}
        cancelLabel="Keep it"
        danger
        busy={deleting}
        onConfirm={() => void confirmDelete()}
        onCancel={() => {
          if (deleting) return;
          setPendingDelete(null);
          setPendingBulkDelete(false);
        }}
      />
    </main>
  );
}

type RowProps = {
  m: Message;
  author: UserPublic | undefined;
  isGroupStart: boolean;
  mine: boolean;
  /** Set when this message is a reply (null: original not available). */
  replyQuote?: ReplyQuote;
  /** Own message, or Manage Messages in this channel. */
  canDelete: boolean;
  /** Manage Messages in this channel. */
  canPin: boolean;
  editing: boolean;
  selected: boolean;
  mentioned: boolean;
  serverId: string;
  /** May start/open a thread from it (not inside a thread). */
  canThread: boolean;
  actions: RowActions;
};

function ThreadIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden fill="currentColor">
      <path d="M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-6.6l-4.2 3.4A1 1 0 0 1 5.6 18.6V16H6a2 2 0 0 1-2-2V5zm4 3a1 1 0 0 0 0 2h8a1 1 0 1 0 0-2H8zm0 3.5a1 1 0 1 0 0 2h5a1 1 0 1 0 0-2H8z" />
    </svg>
  );
}

/** One message. Re-renders only when its own props change. */
const MessageRow = memo(function MessageRow({
  m,
  author,
  isGroupStart,
  mine,
  replyQuote,
  canDelete,
  canPin,
  editing,
  selected,
  mentioned,
  serverId,
  canThread,
  actions,
}: RowProps) {
  const displayName = author?.display_name || "Unknown";
  const onReact = (emoji: string) => actions.react(m, emoji);
  const [menuOpen, setMenuOpen] = useState(false);

  // Welcome message written by the app when someone joins.
  if (m.system === "member_join") {
    return (
      <article id={`msg-${m.id}`} className="message system-message">
        <span className="system-message-icon" aria-hidden>
          👋
        </span>
        <div className="system-message-body">
          <MessageContent content={m.content} serverId={serverId} />
          <time dateTime={m.created_at} title={new Date(m.created_at).toLocaleString()}>
            {formatTime(m.created_at)}
          </time>
        </div>
        {canDelete && (
          <div className={`message-actions${menuOpen ? " is-open" : ""}`}>
            <MessageMoreMenu
              onOpenChange={setMenuOpen}
              items={[{ label: "Delete message", danger: true, onClick: () => actions.remove(m) }]}
            />
          </div>
        )}
      </article>
    );
  }

  return (
    <article
      id={`msg-${m.id}`}
      className={`message ${isGroupStart ? "group-start" : "grouped"}${mentioned ? " mentioned" : ""}${selected ? " selected" : ""}${replyQuote !== undefined ? " is-reply" : ""}`}
      onClick={(e) => actions.toggleSelect(m, e)}
    >
      {replyQuote !== undefined && (
        <button
          type="button"
          className="message-reply-quote"
          disabled={replyQuote === null}
          onClick={() => m.reply_to_id && actions.jumpTo(m.reply_to_id)}
          title={replyQuote ? "Jump to message" : undefined}
        >
          <span className="message-reply-line" aria-hidden />
          {replyQuote ? (
            <>
              <strong>{replyQuote.authorName}</strong>
              <span className="message-reply-text">{replyQuote.text}</span>
            </>
          ) : (
            <span className="message-reply-text muted">Original message was deleted or isn't loaded</span>
          )}
        </button>
      )}
      <div className="avatar-col">
        {isGroupStart ? (
          <button
            type="button"
            className="avatar clickable-user"
            onClick={(e) => actions.openProfile(m.author_id, e)}
          >
            {author?.avatar_url ? (
              <img src={mediaUrl(author.avatar_url)} alt="" referrerPolicy="no-referrer" />
            ) : (
              <span>{(author?.display_name || "?").charAt(0).toUpperCase()}</span>
            )}
          </button>
        ) : (
          <time className="grouped-time" dateTime={m.created_at} title={formatTime(m.created_at)}>
            {new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </time>
        )}
      </div>
      <div className="message-body">
        {isGroupStart && (
          <div className="message-meta">
            <button
              type="button"
              className="message-author-btn"
              onClick={(e) => actions.openProfile(m.author_id, e)}
            >
              {displayName}
            </button>
            <time dateTime={m.created_at}>{formatTime(m.created_at)}</time>
            {m.pinned_at && (
              <span className="message-pinned-flag" title="Pinned">
                <PinIcon />
              </span>
            )}
          </div>
        )}

        {m.forwarded && (
          <span className="message-forwarded">
            <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden fill="currentColor">
              <path d="M14 4l7 7-7 7v-4.1C9 13.9 5.5 15.5 3 19c1-5 4-10 11-11V4z" />
            </svg>
            Forwarded
          </span>
        )}
        {editing ? (
          <MessageEditBox
            messageId={m.id}
            initial={m.content}
            onSave={actions.saveEdit}
            onCancel={actions.cancelEdit}
          />
        ) : m.poll || m.lfg ? null : (
          <>
            {m.content && (
              <>
                <MessageContent content={m.content} serverId={serverId}>
                  {m.edited_at && <span className="edited"> (edited)</span>}
                </MessageContent>
                <MessageEmbeds content={m.content} />
              </>
            )}
            {!m.content && m.edited_at && <span className="edited"> (edited)</span>}
          </>
        )}

        {m.attachments?.length > 0 && (
          <div className="attachments">
            {m.attachments.map((a) => (
              <MessageAttachment key={a.id} attachment={a} allowDownload={!mine} />
            ))}
          </div>
        )}

        {m.poll && <PollCard message={m} />}

        {m.lfg && <PlayerGroupCard message={m} />}

        {m.thread && (
          <button type="button" className="thread-chip" onClick={() => actions.openThread(m)}>
            <ThreadIcon />
            <strong>{m.thread.name}</strong>
            <span className="muted">
              {m.thread.message_count} {m.thread.message_count === 1 ? "message" : "messages"}
            </span>
          </button>
        )}

        <div className={`message-actions${menuOpen ? " is-open" : ""}`}>
          {QUICK_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className="msg-action"
              title={`React ${emoji}`}
              onClick={() => onReact(emoji)}
            >
              {emoji}
            </button>
          ))}
          <EmojiPickerButton
            className="msg-react-picker"
            variant="reaction"
            title="Add reaction"
            placement="auto"
            onPick={onReact}
          />
          <button
            type="button"
            className="msg-action msg-action-icon"
            title="Reply"
            aria-label="Reply"
            onClick={() => actions.reply(m)}
          >
            <ReplyIcon />
          </button>
          {!editing && (
            <MessageMoreMenu
              onOpenChange={setMenuOpen}
              items={[
                // Only the author edits; moderators may delete anyone's message.
                ...(mine ? [{ label: "Edit message", onClick: () => actions.startEdit(m.id) }] : []),
                ...(canPin
                  ? [{ label: m.pinned_at ? "Unpin message" : "Pin message", onClick: () => actions.togglePin(m) }]
                  : []),
                ...(m.content
                  ? [{ label: "Copy text", onClick: () => void navigator.clipboard?.writeText(m.content) }]
                  : []),
                ...(m.content || m.attachments?.length
                  ? [{ label: "Forward", onClick: () => actions.forward(m) }]
                  : []),
                ...(canThread
                  ? [{ label: m.thread ? "Open thread" : "Create thread", onClick: () => actions.openThread(m) }]
                  : []),
                ...(canDelete
                  ? [{ label: mine ? "Delete message" : "Delete message (moderator)", danger: true, onClick: () => actions.remove(m) }]
                  : []),
              ] satisfies ContextMenuItem[]}
            />
          )}
        </div>

        {m.reactions.length > 0 && <ReactionBar reactions={m.reactions} onReact={onReact} />}
      </div>
    </article>
  );
});

/** Reaction chips; only rows that have reactions subscribe to custom emojis. */
function ReactionBar({
  reactions,
  onReact,
}: {
  reactions: ReactionSummary[];
  onReact: (emoji: string) => void;
}) {
  const customEmojisById = useAppStore((s) => s.customEmojisById);
  return (
    <div className="reactions">
      {reactions.map((r) => {
        const custom = matchCustomEmojiToken(r.emoji);
        const customEmoji = custom ? customEmojisById[custom.id] : undefined;
        return (
          <button
            key={r.emoji}
            type="button"
            className={`reaction ${r.me ? "me" : ""}`}
            title={custom ? `:${custom.name}:` : r.emoji}
            onClick={() => onReact(r.emoji)}
          >
            {customEmoji ? (
              <img
                className="reaction-custom-emoji"
                src={mediaUrl(customEmoji.image_url)}
                alt={`:${customEmoji.name}:`}
                referrerPolicy="no-referrer"
              />
            ) : custom ? (
              `:${custom.name}:`
            ) : (
              r.emoji
            )}{" "}
            {r.count}
          </button>
        );
      })}
      <EmojiPickerButton
        className="reaction-add-picker"
        variant="reaction"
        title="Add reaction"
        placement="auto"
        onPick={onReact}
      />
    </div>
  );
}

/** Inline editor; keeps its own draft so typing re-renders only this box. */
function MessageEditBox({
  messageId,
  initial,
  onSave,
  onCancel,
}: {
  messageId: string;
  initial: string;
  onSave: (id: string, content: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    const content = draft.trim();
    if (!content || messageLength(draft) > MAX_MESSAGE_CHARS) return;
    setBusy(true);
    setErr(null);
    try {
      await onSave(messageId, content);
    } catch (error) {
      setErr(error instanceof Error ? error.message : "Failed to edit message");
      setBusy(false);
    }
  }

  return (
    <div className="edit-box">
      <textarea
        rows={3}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void save();
          }
        }}
        autoFocus
      />
      <div className="row">
        <button type="button" className="btn primary sm" disabled={busy} onClick={() => void save()}>
          Save
        </button>
        <button type="button" className="btn ghost sm" onClick={onCancel}>
          Cancel
        </button>
        <span className="muted tiny">esc to cancel · enter to save</span>
        <CharCounter text={draft} />
      </div>
      {err && <p className="form-error tiny">{err}</p>}
    </div>
  );
}

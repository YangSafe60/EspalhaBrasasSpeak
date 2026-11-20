import { memo, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import logoMark from "../assets/logo-mark.png";
import { messageMentionsMe, type MentionContext } from "../lib/mentions";
import { effectiveServerPerms, hasPerm, Perm } from "../lib/serverPerms";
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
import { useAppStore } from "../store/appStore";
import type { Atmosphere, Channel, Member, Message, ReactionSummary, Role, UserPublic } from "../types";

const EMPTY_MESSAGES: Message[] = [];
const EMPTY_MEMBERS: Member[] = [];
const EMPTY_ROLES: Role[] = [];

const QUICK_EMOJIS = ["👍", "🔥", "😂"];
/** Discord-like: group consecutive messages from the same author within this window. */
const GROUP_WINDOW_MS = 7 * 60 * 1000;

function messageIdentity(m: Message): string {
  if (m.webhook_id) return `wh:${m.webhook_id}`;
  return `user:${m.author_id}`;
}

function isIntegrationMessage(m: Message): boolean {
  return Boolean(m.webhook_id);
}

function shouldStartGroup(prev: Message | undefined, current: Message): boolean {
  if (!prev) return true;
  if (messageIdentity(prev) !== messageIdentity(current)) return true;
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
};

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

  const me = useMemo(() => members.find((m) => m.user.id === user?.id), [members, user?.id]);
  const myPerms = useMemo(
    () => effectiveServerPerms(server, roles, me, user?.id),
    [server, roles, me, user?.id],
  );
  const canMentionEveryone = hasPerm(myPerms, Perm.MENTION_EVERYONE);

  const mentionCtx = useMemo<MentionContext>(
    () => ({
      members: members.map((m) => m.user),
      roles,
      me: user,
      myRoleIds: me?.role_ids,
    }),
    [members, roles, user, me?.role_ids],
  );

  const mentionedIds = useMemo(() => {
    const out = new Set<string>();
    for (const m of messages) {
      if (m.content && messageMentionsMe(m.content, mentionCtx)) out.add(m.id);
    }
    return out;
  }, [messages, mentionCtx]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, activeChannelId]);

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
      if (m.author_id !== user?.id) return;
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
          (m) => selectedIds.has(m.id) && m.author_id === user?.id,
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
        <div>
          <h2>
            <span className="ch-icon">#</span> {channel.name}
          </h2>
          {channel.topic && <p className="topic">{channel.topic}</p>}
        </div>
      </header>

      <div className="message-list">
        {messages.map((m, i) => {
          const integration = isIntegrationMessage(m);
          return (
            <MessageRow
              key={m.id}
              m={m}
              author={authors[m.author_id]}
              isGroupStart={shouldStartGroup(messages[i - 1], m)}
              mine={user?.id === m.author_id && !integration}
              editing={editingId === m.id}
              selected={selectedIds.has(m.id)}
              mentioned={mentionedIds.has(m.id)}
              serverId={channel.server_id}
              actions={actions}
            />
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
      />

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
  editing: boolean;
  selected: boolean;
  mentioned: boolean;
  serverId: string;
  actions: RowActions;
};

/** One message. Re-renders only when its own props change. */
const MessageRow = memo(function MessageRow({
  m,
  author,
  isGroupStart,
  mine,
  editing,
  selected,
  mentioned,
  serverId,
  actions,
}: RowProps) {
  const integration = isIntegrationMessage(m);
  const displayName = m.webhook_name || author?.display_name || "Unknown";
  const onReact = (emoji: string) => actions.react(m, emoji);

  return (
    <article
      className={`message ${isGroupStart ? "group-start" : "grouped"}${mentioned ? " mentioned" : ""}${selected ? " selected" : ""}`}
      onClick={(e) => actions.toggleSelect(m, e)}
    >
      <div className="avatar-col">
        {isGroupStart ? (
          integration ? (
            <div className="avatar integration-avatar" aria-hidden>
              <span>{displayName.charAt(0).toUpperCase()}</span>
            </div>
          ) : (
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
          )
        ) : (
          <time className="grouped-time" dateTime={m.created_at} title={formatTime(m.created_at)}>
            {new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </time>
        )}
      </div>
      <div className="message-body">
        {isGroupStart && (
          <div className="message-meta">
            {integration ? (
              <span className="message-author integration-author">{displayName}</span>
            ) : (
              <button
                type="button"
                className="message-author-btn"
                onClick={(e) => actions.openProfile(m.author_id, e)}
              >
                {displayName}
              </button>
            )}
            <time dateTime={m.created_at}>{formatTime(m.created_at)}</time>
          </div>
        )}

        {editing ? (
          <MessageEditBox
            messageId={m.id}
            initial={m.content}
            onSave={actions.saveEdit}
            onCancel={actions.cancelEdit}
          />
        ) : (
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

        <div className="message-actions">
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
          {mine && !editing && (
            <>
              <button
                type="button"
                className="msg-action"
                title="Edit"
                onClick={() => actions.startEdit(m.id)}
              >
                Edit
              </button>
              <button
                type="button"
                className="msg-action danger"
                title="Delete"
                onClick={() => actions.remove(m)}
              >
                Delete
              </button>
            </>
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

import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent } from "react";
import logoMark from "../assets/logo-mark.png";
import { insertAtCursor } from "../lib/emojis";
import {
  filterMentionSuggestions,
  mentionInsertText,
  mentionQueryAtCursor,
  messageMentionsMe,
  type MentionSuggestion,
} from "../lib/mentions";
import {
  effectiveServerPerms,
  hasPerm,
  Perm,
} from "../lib/serverPerms";
import { matchCustomEmojiToken } from "../lib/customEmoji";
import { mediaUrl } from "../lib/mediaUrl";
import { ConfirmDialog } from "./ConfirmDialog";
import { EmojiPickerButton } from "./EmojiPickerButton";
import { GifPickerButton, type GifHit } from "./GifPickerButton";
import { MessageAttachment } from "./MessageAttachment";
import { MessageContent } from "./MessageContent";
import { MessageEmbeds } from "./MessageEmbeds";
import { useAppStore } from "../store/appStore";
import type { Atmosphere, Channel, Message } from "../types";

const QUICK_EMOJIS = ["👍", "🔥", "😂"];
/** Discord-like: group consecutive messages from the same author within this window. */
const GROUP_WINDOW_MS = 7 * 60 * 1000;

function messageIdentity(m: Message): string {
  if (m.webhook_id) return `wh:${m.webhook_id}`;
  if (m.bot_id) return `bot:${m.bot_id}`;
  return `user:${m.author_id}`;
}

function messageDisplayName(m: Message, authorName?: string): string {
  return m.webhook_name || m.bot_name || authorName || "Unknown";
}

function isIntegrationMessage(m: Message): boolean {
  return Boolean(m.webhook_id || m.bot_id);
}

function shouldStartGroup(prev: Message | undefined, current: Message): boolean {
  if (!prev) return true;
  if (messageIdentity(prev) !== messageIdentity(current)) return true;
  const gap =
    new Date(current.created_at).getTime() - new Date(prev.created_at).getTime();
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

export function MessageView() {
  const activeChannelId = useAppStore((s) => s.activeChannelId);
  const channelsByServer = useAppStore((s) => s.channelsByServer);
  const messagesByChannel = useAppStore((s) => s.messagesByChannel);
  const authors = useAppStore((s) => s.authors);
  const typing = useAppStore((s) => s.typing);
  const user = useAppStore((s) => s.user);
  const activeServerId = useAppStore((s) => s.activeServerId);
  const openMiniProfile = useAppStore((s) => s.openMiniProfile);
  const sendMessage = useAppStore((s) => s.sendMessage);
  const editMessage = useAppStore((s) => s.editMessage);
  const deleteMessage = useAppStore((s) => s.deleteMessage);
  const sendTyping = useAppStore((s) => s.sendTyping);
  const toggleReaction = useAppStore((s) => s.toggleReaction);
  const customEmojisById = useAppStore((s) => s.customEmojisById);
  const resolveCustomEmojis = useAppStore((s) => s.resolveCustomEmojis);
  const uploadFile = useAppStore((s) => s.uploadFile);
  const attachRemoteMedia = useAppStore((s) => s.attachRemoteMedia);
  const servers = useAppStore((s) => s.servers);
  const membersByServer = useAppStore((s) => s.membersByServer);
  const rolesByServer = useAppStore((s) => s.rolesByServer);
  const pendingComposerInsert = useAppStore((s) => s.pendingComposerInsert);
  const clearPendingComposerInsert = useAppStore(
    (s) => s.clearPendingComposerInsert,
  );

  const [draft, setDraft] = useState("");
  const [pendingFiles, setPendingFiles] = useState<
    { id: string; url: string; name: string; preview: boolean }[]
  >([]);
  const [fileUploading, setFileUploading] = useState(false);
  const [composerErr, setComposerErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [pendingDelete, setPendingDelete] = useState<Message | null>(null);
  const [pendingBulkDelete, setPendingBulkDelete] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [deleting, setDeleting] = useState(false);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionQuery, setMentionQuery] = useState<{
    start: number;
    query: string;
  } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const typingTimer = useRef<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const draftRef = useRef<HTMLTextAreaElement>(null);

  const channel: Channel | undefined = Object.values(channelsByServer)
    .flat()
    .find((c) => c.id === activeChannelId);

  const messages = activeChannelId
    ? messagesByChannel[activeChannelId] || []
    : [];

  const typers = (activeChannelId ? typing[activeChannelId] || [] : [])
    .filter((t) => t.expires > Date.now() && t.username !== user?.username)
    .map((t) => t.username);

  const server = channel
    ? servers.find((s) => s.id === channel.server_id)
    : undefined;
  const members = channel ? membersByServer[channel.server_id] || [] : [];
  const roles = channel ? rolesByServer[channel.server_id] || [] : [];
  const me = members.find((m) => m.user.id === user?.id);
  const myPerms = useMemo(
    () => effectiveServerPerms(server, roles, me, user?.id),
    [server, roles, me, user?.id],
  );
  const canMentionEveryone = hasPerm(myPerms, Perm.MENTION_EVERYONE);

  const mentionCtx = useMemo(
    () => ({
      members: members.map((m) => m.user),
      roles,
      me: user,
      myRoleIds: me?.role_ids,
    }),
    [members, roles, user, me?.role_ids],
  );

  const mentionSuggestions = useMemo(() => {
    if (!mentionQuery) return [] as MentionSuggestion[];
    return filterMentionSuggestions(
      mentionQuery.query,
      mentionCtx.members,
      roles,
      { allowEveryone: canMentionEveryone },
    );
  }, [mentionQuery, mentionCtx.members, roles, canMentionEveryone]);

  useEffect(() => {
    setMentionIndex(0);
  }, [mentionSuggestions, mentionQuery?.query]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, activeChannelId]);

  useEffect(() => {
    setEditingId(null);
    setEditDraft("");
    setMentionQuery(null);
    setSelectedIds(new Set());
    setPendingBulkDelete(false);
    setPendingDelete(null);
  }, [activeChannelId]);

  useEffect(() => {
    if (!pendingComposerInsert || !activeChannelId) return;
    if (pendingComposerInsert.channelId !== activeChannelId) return;
    const insert = pendingComposerInsert.text;
    setDraft((prev) => prev + insert);
    clearPendingComposerInsert();
    requestAnimationFrame(() => {
      const el = draftRef.current;
      if (!el) return;
      el.focus();
      const pos = el.value.length;
      el.setSelectionRange(pos, pos);
    });
  }, [
    pendingComposerInsert,
    activeChannelId,
    clearPendingComposerInsert,
  ]);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape" && selectedIds.size > 0) {
        setSelectedIds(new Set());
        return;
      }
      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        selectedIds.size > 0 &&
        !editingId
      ) {
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
        if (matchCustomEmojiToken(r.emoji)) {
          void resolveCustomEmojis(r.emoji);
        }
      }
    }
  }, [messages, resolveCustomEmojis]);

  function applyMention(item: MentionSuggestion) {
    const el = draftRef.current;
    if (!el || !mentionQuery) return;
    const cursor = el.selectionStart ?? draft.length;
    const insert = `${mentionInsertText(item)} `;
    const next =
      draft.slice(0, mentionQuery.start) + insert + draft.slice(cursor);
    setDraft(next);
    setMentionQuery(null);
    requestAnimationFrame(() => {
      const pos = mentionQuery.start + insert.length;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  }

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

  async function onSubmit(e?: FormEvent) {
    e?.preventDefault();
    if (!activeChannelId || fileUploading) return;
    if (!draft.trim() && !pendingFiles.length) return;
    setBusy(true);
    setComposerErr(null);
    try {
      await sendMessage(
        activeChannelId,
        draft.trim(),
        pendingFiles.map((f) => f.id),
      );
      setDraft("");
      setPendingFiles([]);
      setMentionQuery(null);
    } catch (error) {
      setComposerErr(
        error instanceof Error ? error.message : "Failed to send message",
      );
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (mentionQuery && mentionSuggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((i) => (i + 1) % mentionSuggestions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex(
          (i) =>
            (i - 1 + mentionSuggestions.length) % mentionSuggestions.length,
        );
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        applyMention(mentionSuggestions[mentionIndex] || mentionSuggestions[0]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionQuery(null);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void onSubmit();
    }
    if (!typingTimer.current && activeChannelId) {
      void sendTyping(activeChannelId);
      typingTimer.current = window.setTimeout(() => {
        typingTimer.current = null;
      }, 2500);
    }
  }

  async function onPickGif(gif: GifHit) {
    if (!activeChannelId) return;
    setBusy(true);
    try {
      const att = await attachRemoteMedia({
        url: gif.url,
        filename: `${gif.title || "gif"}.gif`,
        content_type: "image/gif",
      });
      await sendMessage(activeChannelId, "", [att.id]);
    } finally {
      setBusy(false);
    }
  }

  function insertEmoji(emoji: string) {
    const el = draftRef.current;
    const start = el?.selectionStart ?? draft.length;
    const end = el?.selectionEnd ?? draft.length;
    const { next, caret } = insertAtCursor(draft, emoji, start, end);
    setDraft(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(caret, caret);
    });
  }

  async function onPickFile(file: File | null) {
    if (!file || !activeChannelId) return;
    setFileUploading(true);
    setComposerErr(null);
    try {
      const uploaded = await uploadFile(file);
      const preview =
        file.type.startsWith("image/") ||
        /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(file.name || "");
      setPendingFiles((prev) => [
        ...prev,
        {
          id: uploaded.id,
          url: uploaded.url,
          name: file.name,
          preview,
        },
      ]);
    } catch (error) {
      setComposerErr(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setFileUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function removePendingFile(id: string) {
    setPendingFiles((prev) => prev.filter((f) => f.id !== id));
  }

  function startEdit(m: Message) {
    setEditingId(m.id);
    setEditDraft(m.content);
  }

  async function saveEdit() {
    if (!editingId || !editDraft.trim()) return;
    setBusy(true);
    try {
      await editMessage(editingId, editDraft.trim());
      setEditingId(null);
      setEditDraft("");
    } finally {
      setBusy(false);
    }
  }

  async function removeMessage(m: Message) {
    if (selectedIds.size > 1 && selectedIds.has(m.id)) {
      setPendingDelete(null);
      setPendingBulkDelete(true);
      return;
    }
    setPendingBulkDelete(false);
    setPendingDelete(m);
  }

  function toggleMessageSelect(m: Message, e: MouseEvent) {
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
  }

  async function confirmDelete() {
    setDeleting(true);
    try {
      if (pendingBulkDelete) {
        const channelId = activeChannelId;
        if (!channelId) return;
        const toDelete = messages.filter(
          (m) => selectedIds.has(m.id) && m.author_id === user?.id,
        );
        await Promise.all(
          toDelete.map((m) => deleteMessage(m.id, m.channel_id)),
        );
        if (editingId && selectedIds.has(editingId)) {
          setEditingId(null);
          setEditDraft("");
        }
        setSelectedIds(new Set());
        setPendingBulkDelete(false);
      } else if (pendingDelete) {
        await deleteMessage(pendingDelete.id, pendingDelete.channel_id);
        if (editingId === pendingDelete.id) {
          setEditingId(null);
          setEditDraft("");
        }
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
          const author = authors[m.author_id];
          const prev = i > 0 ? messages[i - 1] : undefined;
          const isGroupStart = shouldStartGroup(prev, m);
          const mine = user?.id === m.author_id && !isIntegrationMessage(m);
          const displayName = messageDisplayName(m, author?.display_name);
          const integration = isIntegrationMessage(m);
          const editing = editingId === m.id;
          const selected = selectedIds.has(m.id);
          const mentioned = messageMentionsMe(m.content || "", mentionCtx);

          return (
            <article
              key={m.id}
              className={`message ${isGroupStart ? "group-start" : "grouped"}${mentioned ? " mentioned" : ""}${selected ? " selected" : ""}`}
              onClick={(e) => toggleMessageSelect(m, e)}
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
                    onClick={(e: MouseEvent) =>
                      openMiniProfile({
                        userId: m.author_id,
                        serverId: activeServerId,
                        x: e.clientX,
                        y: e.clientY,
                      })
                    }
                  >
                    {author?.avatar_url ? (
                      <img
                        src={mediaUrl(author.avatar_url)}
                        alt=""
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <span>
                        {(author?.display_name || "?").charAt(0).toUpperCase()}
                      </span>
                    )}
                  </button>
                  )
                ) : (
                  <time className="grouped-time" dateTime={m.created_at} title={formatTime(m.created_at)}>
                    {new Date(m.created_at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                )}
              </div>
              <div className="message-body">
                {isGroupStart && (
                  <div className="message-meta">
                    {integration ? (
                      <span className="message-author integration-author">
                        {displayName}
                        {m.bot_id && <span className="bot-tag">APP</span>}
                      </span>
                    ) : (
                    <button
                      type="button"
                      className="message-author-btn"
                      onClick={(e: MouseEvent) =>
                        openMiniProfile({
                          userId: m.author_id,
                          serverId: activeServerId,
                          x: e.clientX,
                          y: e.clientY,
                        })
                      }
                    >
                      {displayName}
                    </button>
                    )}
                    <time dateTime={m.created_at}>{formatTime(m.created_at)}</time>
                  </div>
                )}

                {editing ? (
                  <div className="edit-box">
                    <textarea
                      rows={3}
                      value={editDraft}
                      onChange={(e) => setEditDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          setEditingId(null);
                          setEditDraft("");
                        }
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          void saveEdit();
                        }
                      }}
                      autoFocus
                    />
                    <div className="row">
                      <button
                        type="button"
                        className="btn primary sm"
                        disabled={busy}
                        onClick={() => void saveEdit()}
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        className="btn ghost sm"
                        onClick={() => {
                          setEditingId(null);
                          setEditDraft("");
                        }}
                      >
                        Cancel
                      </button>
                      <span className="muted tiny">esc to cancel · enter to save</span>
                    </div>
                  </div>
                ) : (
                  <>
                    {m.content && (
                      <>
                        <MessageContent
                          content={m.content}
                          serverId={channel.server_id}
                        >
                          {m.edited_at && <span className="edited"> (edited)</span>}
                        </MessageContent>
                        <MessageEmbeds content={m.content} />
                      </>
                    )}
                    {!m.content && m.edited_at && (
                      <span className="edited"> (edited)</span>
                    )}
                  </>
                )}

                {m.attachments?.length > 0 && (
                  <div className="attachments">
                    {m.attachments.map((a) => (
                      <MessageAttachment
                        key={a.id}
                        attachment={a}
                        allowDownload={!mine}
                      />
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
                      onClick={() => {
                        const existing = m.reactions.find(
                          (r) => r.emoji === emoji,
                        );
                        void toggleReaction(m.id, emoji, !!existing?.me);
                      }}
                    >
                      {emoji}
                    </button>
                  ))}
                  <EmojiPickerButton
                    className="msg-react-picker"
                    variant="reaction"
                    title="Add reaction"
                    placement="auto"
                    onPick={(emoji) => {
                      const existing = m.reactions.find(
                        (r) => r.emoji === emoji,
                      );
                      void toggleReaction(m.id, emoji, !!existing?.me);
                    }}
                  />
                  {mine && !editing && (
                    <>
                      <button
                        type="button"
                        className="msg-action"
                        title="Edit"
                        onClick={() => startEdit(m)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="msg-action danger"
                        title="Delete"
                        onClick={() => void removeMessage(m)}
                      >
                        Delete
                      </button>
                    </>
                  )}
                </div>

                {m.reactions.length > 0 && (
                  <div className="reactions">
                    {m.reactions.map((r) => {
                      const custom = matchCustomEmojiToken(r.emoji);
                      const customEmoji = custom
                        ? customEmojisById[custom.id]
                        : undefined;
                      return (
                        <button
                          key={r.emoji}
                          type="button"
                          className={`reaction ${r.me ? "me" : ""}`}
                          title={custom ? `:${custom.name}:` : r.emoji}
                          onClick={() =>
                            void toggleReaction(m.id, r.emoji, r.me)
                          }
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
                      onPick={(emoji) => {
                        const existing = m.reactions.find(
                          (r) => r.emoji === emoji,
                        );
                        void toggleReaction(m.id, emoji, !!existing?.me);
                      }}
                    />
                  </div>
                )}
              </div>
            </article>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {selectedIds.size > 0 && (
        <div className="message-selection-bar" role="status">
          <span>
            {selectedIds.size} message{selectedIds.size === 1 ? "" : "s"}{" "}
            selected
          </span>
          <div className="row">
            <button
              type="button"
              className="btn ghost sm"
              onClick={() => setSelectedIds(new Set())}
            >
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

      <div className="composer-wrap">
        {mentionQuery && mentionSuggestions.length > 0 && (
          <div className="mention-autocomplete" role="listbox">
            {mentionSuggestions.map((item, i) => {
              const active = i === mentionIndex;
              if (item.kind === "everyone" || item.kind === "here") {
                return (
                  <button
                    key={item.kind}
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={`mention-autocomplete-item${active ? " active" : ""}`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      applyMention(item);
                    }}
                  >
                    <span className="mention-autocomplete-avatar">@</span>
                    <div className="mention-autocomplete-meta">
                      <strong>@{item.kind}</strong>
                      <span>
                        {item.kind === "everyone"
                          ? "Notify everyone online who can see this channel"
                          : "Notify everyone online in this channel"}
                      </span>
                    </div>
                  </button>
                );
              }
              if (item.kind === "role") {
                return (
                  <button
                    key={`role-${item.role.id}`}
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={`mention-autocomplete-item${active ? " active" : ""}`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      applyMention(item);
                    }}
                  >
                    <span
                      className="mention-autocomplete-avatar"
                      style={{ background: item.role.color || "#5865f2" }}
                    >
                      R
                    </span>
                    <div className="mention-autocomplete-meta">
                      <strong>@{item.role.name}</strong>
                      <span>Role</span>
                    </div>
                  </button>
                );
              }
              const u = item.user;
              return (
                <button
                  key={`user-${u.id}`}
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={`mention-autocomplete-item${active ? " active" : ""}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    applyMention(item);
                  }}
                >
                  {authors[u.id]?.avatar_url ? (
                    <img
                      className="mention-autocomplete-avatar"
                      src={mediaUrl(authors[u.id]!.avatar_url!)}
                      alt=""
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <span className="mention-autocomplete-avatar">
                      {(u.display_name || u.username || "?")
                        .charAt(0)
                        .toUpperCase()}
                    </span>
                  )}
                  <div className="mention-autocomplete-meta">
                    <strong>{u.display_name || u.username}</strong>
                    <span>@{u.username}</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
        {typers.length > 0 && (
          <p className="typing-indicator">
            {typers.join(", ")} {typers.length === 1 ? "is" : "are"} typing…
          </p>
        )}
        {pendingFiles.length > 0 && (
          <div className="pending-files">
            {pendingFiles.map((f) => (
              <div key={f.id} className="pending-file-chip">
                {f.preview ? (
                  <img
                    className="pending-file-thumb"
                    src={mediaUrl(f.url)}
                    alt={f.name}
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <span className="pending-file-name">{f.name}</span>
                )}
                <button
                  type="button"
                  className="pending-file-remove"
                  aria-label={`Remove ${f.name}`}
                  onClick={() => removePendingFile(f.id)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        {fileUploading && (
          <p className="muted tiny pending-upload-status">Uploading…</p>
        )}
        {composerErr && <p className="form-error composer-error">{composerErr}</p>}
        <form className="composer" onSubmit={(e) => void onSubmit(e)}>
          <button
            type="button"
            className="icon-btn"
            title="Attach file"
            disabled={fileUploading}
            onClick={() => fileRef.current?.click()}
          >
            +
          </button>
          <input
            ref={fileRef}
            type="file"
            hidden
            onChange={(e) => void onPickFile(e.target.files?.[0] || null)}
          />
          <textarea
            ref={draftRef}
            rows={1}
            placeholder={`Message #${channel.name}`}
            value={draft}
            onChange={(e) => {
              const next = e.target.value;
              const cursor = e.target.selectionStart ?? next.length;
              setDraft(next);
              setMentionQuery(mentionQueryAtCursor(next, cursor));
            }}
            onSelect={(e) => {
              const el = e.currentTarget;
              setMentionQuery(
                mentionQueryAtCursor(el.value, el.selectionStart ?? el.value.length),
              );
            }}
            onKeyDown={onKeyDown}
          />
          <EmojiPickerButton onPick={insertEmoji} />
          <GifPickerButton onPick={(g) => void onPickGif(g)} />
          <button type="submit" className="btn primary sm" disabled={busy || fileUploading}>
            Send
          </button>
        </form>
      </div>

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
        confirmLabel={
          pendingBulkDelete ? "Delete Messages" : "Delete Message"
        }
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

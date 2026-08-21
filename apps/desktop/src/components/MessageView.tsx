import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import logoMark from "../assets/logo-mark-square.png";
import { ConfirmDialog } from "./ConfirmDialog";
import { useAppStore } from "../store/appStore";
import type { Channel, Message } from "../types";
import { ATMOSPHERE_PRESETS, type Atmosphere } from "../types";

const QUICK_EMOJIS = ["👍", "🔥", "😂", "❤️", "👀"];
/** Discord-like: group consecutive messages from the same author within this window. */
const GROUP_WINDOW_MS = 7 * 60 * 1000;

function shouldStartGroup(prev: Message | undefined, current: Message): boolean {
  if (!prev) return true;
  if (prev.author_id !== current.author_id) return true;
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
  const sendMessage = useAppStore((s) => s.sendMessage);
  const editMessage = useAppStore((s) => s.editMessage);
  const deleteMessage = useAppStore((s) => s.deleteMessage);
  const sendTyping = useAppStore((s) => s.sendTyping);
  const toggleReaction = useAppStore((s) => s.toggleReaction);
  const uploadFile = useAppStore((s) => s.uploadFile);
  const setModal = useAppStore((s) => s.setModal);

  const [draft, setDraft] = useState("");
  const [pendingFiles, setPendingFiles] = useState<
    { id: string; url: string; name: string }[]
  >([]);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [pendingDelete, setPendingDelete] = useState<Message | null>(null);
  const [deleting, setDeleting] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const typingTimer = useRef<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const channel: Channel | undefined = Object.values(channelsByServer)
    .flat()
    .find((c) => c.id === activeChannelId);

  const messages = activeChannelId
    ? messagesByChannel[activeChannelId] || []
    : [];

  const typers = (activeChannelId ? typing[activeChannelId] || [] : [])
    .filter((t) => t.expires > Date.now() && t.username !== user?.username)
    .map((t) => t.username);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, activeChannelId]);

  useEffect(() => {
    setEditingId(null);
    setEditDraft("");
  }, [activeChannelId]);

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
  const preset = ATMOSPHERE_PRESETS[atmosphere];
  const blur = channel.background_blur ?? preset?.blur ?? 0;
  const dim = channel.background_dim ?? preset?.dim ?? 0.45;
  const textColor = channel.text_color || undefined;

  async function onSubmit(e?: FormEvent) {
    e?.preventDefault();
    if (!activeChannelId || (!draft.trim() && !pendingFiles.length)) return;
    setBusy(true);
    try {
      await sendMessage(
        activeChannelId,
        draft.trim(),
        pendingFiles.map((f) => f.id),
      );
      setDraft("");
      setPendingFiles([]);
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
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

  async function onPickFile(file: File | null) {
    if (!file) return;
    const uploaded = await uploadFile(file);
    setPendingFiles((prev) => [
      ...prev,
      { id: uploaded.id, url: uploaded.url, name: file.name },
    ]);
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
    setPendingDelete(m);
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await deleteMessage(pendingDelete.id, pendingDelete.channel_id);
      if (editingId === pendingDelete.id) {
        setEditingId(null);
        setEditDraft("");
      }
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <main
      className={`message-view atmosphere-${atmosphere || "none"}`}
      style={{ color: textColor }}
    >
      {channel.background_url && (
        <div
          className="channel-bg"
          style={{
            backgroundImage: `url(${channel.background_url})`,
            filter: `blur(${blur}px)`,
          }}
        />
      )}
      <div className="channel-dim" style={{ opacity: dim }} />

      <header className="message-header">
        <div>
          <h2>
            <span className="ch-icon">#</span> {channel.name}
          </h2>
          {channel.topic && <p className="topic">{channel.topic}</p>}
        </div>
        <button
          type="button"
          className="btn ghost sm"
          onClick={() => setModal("channel-settings", channel.id)}
        >
          Channel settings
        </button>
      </header>

      <div className="message-list">
        {messages.map((m, i) => {
          const author = authors[m.author_id];
          const prev = i > 0 ? messages[i - 1] : undefined;
          const isGroupStart = shouldStartGroup(prev, m);
          const mine = user?.id === m.author_id;
          const editing = editingId === m.id;

          return (
            <article
              key={m.id}
              className={`message ${isGroupStart ? "group-start" : "grouped"}`}
            >
              <div className="avatar-col">
                {isGroupStart ? (
                  <div className="avatar">
                    {author?.avatar_url ? (
                      <img src={author.avatar_url} alt="" />
                    ) : (
                      <span>
                        {(author?.display_name || "?").charAt(0).toUpperCase()}
                      </span>
                    )}
                  </div>
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
                    <strong>{author?.display_name || "Unknown"}</strong>
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
                      <p className="message-content">
                        {m.content}
                        {m.edited_at && <span className="edited"> (edited)</span>}
                      </p>
                    )}
                    {!m.content && m.edited_at && (
                      <span className="edited"> (edited)</span>
                    )}
                  </>
                )}

                {m.attachments?.length > 0 && (
                  <div className="attachments">
                    {m.attachments.map((a) =>
                      a.content_type.startsWith("image/") ? (
                        <a key={a.id} href={a.url} target="_blank" rel="noreferrer">
                          <img src={a.url} alt={a.filename} />
                        </a>
                      ) : (
                        <a key={a.id} href={a.url} target="_blank" rel="noreferrer">
                          {a.filename}
                        </a>
                      ),
                    )}
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
                        const existing = m.reactions.find((r) => r.emoji === emoji);
                        void toggleReaction(m.id, emoji, !!existing?.me);
                      }}
                    >
                      {emoji}
                    </button>
                  ))}
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
                    {m.reactions.map((r) => (
                      <button
                        key={r.emoji}
                        type="button"
                        className={`reaction ${r.me ? "me" : ""}`}
                        onClick={() => void toggleReaction(m.id, r.emoji, r.me)}
                      >
                        {r.emoji} {r.count}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </article>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <div className="composer-wrap">
        {typers.length > 0 && (
          <p className="typing-indicator">
            {typers.join(", ")} {typers.length === 1 ? "is" : "are"} typing…
          </p>
        )}
        {pendingFiles.length > 0 && (
          <div className="pending-files">
            {pendingFiles.map((f) => (
              <span key={f.id}>{f.name}</span>
            ))}
          </div>
        )}
        <form className="composer" onSubmit={(e) => void onSubmit(e)}>
          <button
            type="button"
            className="icon-btn"
            title="Attach file"
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
            rows={1}
            placeholder={`Message #${channel.name}`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <button type="submit" className="btn primary sm" disabled={busy}>
            Send
          </button>
        </form>
      </div>

      <ConfirmDialog
        open={!!pendingDelete}
        title="Delete message?"
        description={
          pendingDelete?.content
            ? `“${pendingDelete.content.slice(0, 120)}${pendingDelete.content.length > 120 ? "…" : ""}” will be gone for everyone.`
            : "This message will be permanently removed for everyone in the channel."
        }
        confirmLabel="Delete Message"
        cancelLabel="Keep it"
        danger
        busy={deleting}
        onConfirm={() => void confirmDelete()}
        onCancel={() => {
          if (!deleting) setPendingDelete(null);
        }}
      />
    </main>
  );
}

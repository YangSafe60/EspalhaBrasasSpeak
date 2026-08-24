import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent } from "react";
import logoMark from "../assets/logo-mark.png";
import { insertAtCursor } from "../lib/emojis";
import { mediaUrl } from "../lib/mediaUrl";
import { ConfirmDialog } from "./ConfirmDialog";
import { EmojiPickerButton } from "./EmojiPickerButton";
import { MessageContent } from "./MessageContent";
import { useAppStore } from "../store/appStore";
import type { DmMessage } from "../types";

const GROUP_WINDOW_MS = 7 * 60 * 1000;

function shouldStartGroup(prev: DmMessage | undefined, current: DmMessage): boolean {
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

export function DmMessageView() {
  const activeDmId = useAppStore((s) => s.activeDmId);
  const dmChannels = useAppStore((s) => s.dmChannels);
  const messagesByDm = useAppStore((s) => s.messagesByDm);
  const authors = useAppStore((s) => s.authors);
  const typing = useAppStore((s) => s.typing);
  const user = useAppStore((s) => s.user);
  const openMiniProfile = useAppStore((s) => s.openMiniProfile);
  const dmFingerprints = useAppStore((s) => s.dmFingerprints);
  const sendDmMessage = useAppStore((s) => s.sendDmMessage);
  const editDmMessage = useAppStore((s) => s.editDmMessage);
  const deleteDmMessage = useAppStore((s) => s.deleteDmMessage);
  const sendDmTyping = useAppStore((s) => s.sendDmTyping);

  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [pendingDelete, setPendingDelete] = useState<DmMessage | null>(null);
  const [deleting, setDeleting] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const typingTimer = useRef<number | null>(null);
  const draftRef = useRef<HTMLTextAreaElement>(null);

  const channel = dmChannels.find((c) => c.id === activeDmId);
  const messages = activeDmId ? messagesByDm[activeDmId] || [] : [];
  const canSend = Boolean(channel?.friendship_id);
  const fp = activeDmId ? dmFingerprints[activeDmId] : null;

  const typers = (activeDmId ? typing[activeDmId] || [] : [])
    .filter((t) => t.expires > Date.now() && t.username !== user?.username)
    .map((t) => t.username);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, activeDmId]);

  useEffect(() => {
    setEditingId(null);
    setEditDraft("");
    setDraft("");
  }, [activeDmId]);

  if (!channel) {
    return (
      <main className="message-view empty-state">
        <div className="empty-brand">
          <img className="brand-logo-mark" src={logoMark} alt="" />
          <p className="brand-mark inline">Espalha Brasas</p>
          <h2>Private messages</h2>
          <p className="muted">
            Add a friend and open a chat. Messages are end-to-end encrypted on
            this device.
          </p>
        </div>
      </main>
    );
  }

  async function onSubmit(e?: FormEvent) {
    e?.preventDefault();
    if (!activeDmId || !draft.trim() || !canSend) return;
    setBusy(true);
    try {
      await sendDmMessage(activeDmId, draft.trim());
      setDraft("");
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void onSubmit();
    }
    if (!typingTimer.current && activeDmId && canSend) {
      void sendDmTyping(activeDmId);
      typingTimer.current = window.setTimeout(() => {
        typingTimer.current = null;
      }, 2500);
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

  async function saveEdit() {
    if (!editingId || !editDraft.trim() || !activeDmId) return;
    setBusy(true);
    try {
      await editDmMessage(editingId, activeDmId, editDraft.trim());
      setEditingId(null);
      setEditDraft("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="message-view dm-message-view">
      <header className="message-header dm-header">
        <div>
          <h2>@{channel.peer.username}</h2>
          <p className="topic">{channel.peer.display_name}</p>
        </div>
        <div className="dm-e2e-badge" title={fp ? `Fingerprint: ${fp}` : undefined}>
          <span className="dm-e2e-lock" aria-hidden>
            E2E
          </span>
          <div>
            <strong>End-to-end encrypted</strong>
            {fp && <span className="muted dm-fingerprint">{fp}</span>}
          </div>
        </div>
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
                  <button
                    type="button"
                    className="avatar clickable-user"
                    onClick={(e: MouseEvent) =>
                      openMiniProfile({
                        userId: m.author_id,
                        serverId: null,
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
                ) : (
                  <time
                    className="grouped-time"
                    dateTime={m.created_at}
                    title={formatTime(m.created_at)}
                  >
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
                    <button
                      type="button"
                      className="message-author-btn"
                      onClick={(e: MouseEvent) =>
                        openMiniProfile({
                          userId: m.author_id,
                          serverId: null,
                          x: e.clientX,
                          y: e.clientY,
                        })
                      }
                    >
                      {author?.display_name || "Unknown"}
                    </button>
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
                    </div>
                  </div>
                ) : m.decrypt_failed ? (
                  <p className="message-content muted">
                    Unable to decrypt this message on this device.
                    {m.edited_at && <span className="edited"> (edited)</span>}
                  </p>
                ) : (
                  <MessageContent content={m.content}>
                    {m.edited_at && <span className="edited"> (edited)</span>}
                  </MessageContent>
                )}

                {mine && canSend && !editing && (
                  <div className="message-actions">
                    <button
                      type="button"
                      className="msg-action"
                      onClick={() => {
                        setEditingId(m.id);
                        setEditDraft(m.content);
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="msg-action"
                      onClick={() => setPendingDelete(m)}
                    >
                      Delete
                    </button>
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
        {!canSend ? (
          <p className="muted composer-locked">
            Friendship ended — you can still read history, but cannot send.
          </p>
        ) : (
          <form className="composer composer-dm" onSubmit={(e) => void onSubmit(e)}>
            <textarea
              ref={draftRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={`Message @${channel.peer.username}`}
              rows={1}
              disabled={busy}
            />
            <EmojiPickerButton onPick={insertEmoji} />
            <button
              type="submit"
              className="btn primary sm"
              disabled={busy || !draft.trim()}
            >
              Send
            </button>
          </form>
        )}
      </div>

      <ConfirmDialog
        open={pendingDelete != null}
        title="Delete message?"
        description="This removes the ciphertext from the server for both of you."
        confirmLabel="Delete"
        busy={deleting}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (!pendingDelete || !activeDmId) return;
          setDeleting(true);
          void deleteDmMessage(pendingDelete.id, activeDmId)
            .then(() => setPendingDelete(null))
            .finally(() => setDeleting(false));
        }}
      />
    </main>
  );
}

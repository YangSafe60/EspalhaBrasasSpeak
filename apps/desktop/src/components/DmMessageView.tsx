import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent } from "react";
import logoMark from "../assets/logo-mark.png";
import { insertAtCursor } from "../lib/emojis";
import { mediaUrl } from "../lib/mediaUrl";
import { sameId } from "../lib/serverPerms";
import { ConfirmDialog } from "./ConfirmDialog";
import { EmojiPickerButton } from "./EmojiPickerButton";
import { GifPickerButton, type GifHit } from "./GifPickerButton";
import { MessageAttachment } from "./MessageAttachment";
import { MessageContent } from "./MessageContent";
import { MessageEmbeds } from "./MessageEmbeds";
import { useAppStore } from "../store/appStore";
import type { DmMessage } from "../types";

const EMPTY_DM_MESSAGES: DmMessage[] = [];

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
  const messages = useAppStore((s) => {
    const id = s.activeDmId;
    if (!id) return EMPTY_DM_MESSAGES;
    return s.messagesByDm[id] ?? EMPTY_DM_MESSAGES;
  });
  const authors = useAppStore((s) => s.authors);
  const typing = useAppStore((s) => s.typing);
  const user = useAppStore((s) => s.user);
  const openMiniProfile = useAppStore((s) => s.openMiniProfile);
  const sendDmMessage = useAppStore((s) => s.sendDmMessage);
  const uploadFile = useAppStore((s) => s.uploadFile);
  const attachRemoteMedia = useAppStore((s) => s.attachRemoteMedia);
  const editDmMessage = useAppStore((s) => s.editDmMessage);
  const deleteDmMessage = useAppStore((s) => s.deleteDmMessage);
  const sendDmTyping = useAppStore((s) => s.sendDmTyping);
  const requestDmCallJoin = useAppStore((s) => s.requestDmCallJoin);
  const dmCallByChannel = useAppStore((s) => s.dmCallByChannel);
  const dmCallId = useAppStore((s) => s.dmCallId);
  const e2eIdentityMissing = useAppStore((s) => s.e2eIdentityMissing);
  const setModal = useAppStore((s) => s.setModal);

  const [draft, setDraft] = useState("");
  const [pendingFiles, setPendingFiles] = useState<
    { id: string; url: string; name: string; preview: boolean }[]
  >([]);
  const [fileUploading, setFileUploading] = useState(false);
  const [composerErr, setComposerErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [pendingDelete, setPendingDelete] = useState<DmMessage | null>(null);
  const [pendingBulkDelete, setPendingBulkDelete] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [deleting, setDeleting] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const typingTimer = useRef<number | null>(null);
  const draftRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const refocusComposerRef = useRef(false);

  function focusComposer() {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = draftRef.current;
        if (!el) return;
        el.focus();
        const pos = el.value.length;
        el.setSelectionRange(pos, pos);
      });
    });
  }

  const channel = dmChannels.find((c) => c.id === activeDmId);
  const canSend = Boolean(channel);
  const dmCallParticipants = activeDmId ? dmCallByChannel[activeDmId] || [] : [];
  const selfInCall = Boolean(
    activeDmId && dmCallId && sameId(dmCallId, activeDmId),
  );
  const peerInCall = Boolean(
    channel &&
      dmCallParticipants.some((p) => sameId(p.user_id, channel.peer.id)),
  );

  const typers = (activeDmId ? typing[activeDmId] || [] : [])
    .filter((t) => t.expires > Date.now() && t.username !== user?.username)
    .map((t) => t.username);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    if (refocusComposerRef.current) {
      refocusComposerRef.current = false;
      focusComposer();
    }
  }, [messages.length, activeDmId]);

  useEffect(() => {
    setEditingId(null);
    setEditDraft("");
    setDraft("");
    setPendingFiles([]);
    setComposerErr(null);
    setSelectedIds(new Set());
    setPendingBulkDelete(false);
    setPendingDelete(null);
  }, [activeDmId]);

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

  const canSubmit =
    canSend &&
    !busy &&
    !fileUploading &&
    (draft.trim().length > 0 || pendingFiles.length > 0);

  async function onSubmit(e?: FormEvent) {
    e?.preventDefault();
    if (!activeDmId || !canSubmit) return;
    const ids = pendingFiles.map((f) => f.id);
    setBusy(true);
    setComposerErr(null);
    refocusComposerRef.current = true;
    try {
      await sendDmMessage(activeDmId, draft.trim(), ids);
      setDraft("");
      setPendingFiles([]);
    } catch (error) {
      setComposerErr(error instanceof Error ? error.message : "Could not send");
    } finally {
      setBusy(false);
      focusComposer();
    }
  }

  async function onPickGif(gif: GifHit) {
    if (!activeDmId || !canSend || busy) return;
    setBusy(true);
    setComposerErr(null);
    try {
      const att = await attachRemoteMedia({
        url: gif.url,
        filename: `${gif.title || "gif"}.gif`,
        content_type: "image/gif",
      });
      await sendDmMessage(activeDmId, "", [att.id]);
    } catch (error) {
      setComposerErr(error instanceof Error ? error.message : "Could not send GIF");
    } finally {
      setBusy(false);
    }
  }

  async function onPickFile(file: File | null) {
    if (!file || !activeDmId || !canSend) return;
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

  function toggleMessageSelect(m: DmMessage, e: MouseEvent) {
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

  function requestDelete(m: DmMessage) {
    if (selectedIds.size > 1 && selectedIds.has(m.id)) {
      setPendingDelete(null);
      setPendingBulkDelete(true);
      return;
    }
    setPendingBulkDelete(false);
    setPendingDelete(m);
  }

  async function confirmDelete() {
    if (!activeDmId) return;
    setDeleting(true);
    try {
      if (pendingBulkDelete) {
        const toDelete = messages.filter(
          (m) => selectedIds.has(m.id) && m.author_id === user?.id,
        );
        await Promise.all(
          toDelete.map((m) => deleteDmMessage(m.id, activeDmId)),
        );
        if (editingId && selectedIds.has(editingId)) {
          setEditingId(null);
          setEditDraft("");
        }
        setSelectedIds(new Set());
        setPendingBulkDelete(false);
      } else if (pendingDelete) {
        await deleteDmMessage(pendingDelete.id, activeDmId);
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
    <main className="message-view dm-message-view">
      <header className="message-header dm-header">
        <div>
          <h2>@{channel.peer.username}</h2>
          <p className="topic">{channel.peer.display_name}</p>
        </div>
        <div className="dm-header-actions">
          <button
            type="button"
            className={`icon-btn dm-call-btn${selfInCall ? " active" : ""}`}
            title={selfInCall ? "In call" : "Start call"}
            aria-label={selfInCall ? "In call" : "Start call"}
            onClick={() => {
              if (activeDmId) requestDmCallJoin(activeDmId);
            }}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden fill="currentColor">
              <path d="M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1.01-.24c1.12.37 2.33.57 3.58.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1C10.85 21 3 13.15 3 3a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.46.57 3.58a1 1 0 0 1-.24 1.01l-2.2 2.2z" />
            </svg>
          </button>
          <span
            className="dm-e2e-badge"
            title="End-to-end encrypted"
            aria-label="End-to-end encrypted"
          >
            E2E
          </span>
        </div>
      </header>

      {e2eIdentityMissing ? (
        <div className="e2e-identity-banner" role="alert">
          <div>
            <strong>Encryption keys missing on this device</strong>
            <p className="muted tiny">
              Old messages cannot be read until you restore your key backup.
              New messages you send would also break history for other people.
            </p>
          </div>
          <button
            type="button"
            className="btn primary sm"
            onClick={() => setModal("user-settings")}
          >
            Restore keys
          </button>
        </div>
      ) : null}

      {peerInCall && !selfInCall ? (
        <div className="dm-call-banner">
          <span>
            <strong>{channel.peer.display_name}</strong> started a call
          </span>
          <button
            type="button"
            className="btn primary sm"
            onClick={() => {
              if (activeDmId) requestDmCallJoin(activeDmId);
            }}
          >
            Join
          </button>
        </div>
      ) : null}

      <div className="message-list">
        {messages.map((m, i) => {
          const author = authors[m.author_id];
          const prev = i > 0 ? messages[i - 1] : undefined;
          const isGroupStart = shouldStartGroup(prev, m);
          const mine = user?.id === m.author_id;
          const editing = editingId === m.id;
          const selected = selectedIds.has(m.id);

          return (
            <article
              key={m.id}
              className={`message ${isGroupStart ? "group-start" : "grouped"}${selected ? " selected" : ""}`}
              onClick={(e) => toggleMessageSelect(m, e)}
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
                ) : m.content ? (
                  <>
                    <MessageContent content={m.content}>
                      {m.edited_at && <span className="edited"> (edited)</span>}
                    </MessageContent>
                    <MessageEmbeds content={m.content} />
                  </>
                ) : (
                  m.edited_at && <span className="edited">(edited)</span>
                )}

                {!!m.attachments?.length && (
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
                      className="msg-action danger"
                      onClick={() => requestDelete(m)}
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
        <form className="composer composer-dm" onSubmit={(e) => void onSubmit(e)}>
          <button
            type="button"
            className="icon-btn"
            title="Attach file"
            disabled={!canSend || fileUploading}
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
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={`Message @${channel.peer.username}`}
            rows={1}
          />
          <EmojiPickerButton onPick={insertEmoji} />
          <GifPickerButton onPick={(g) => void onPickGif(g)} />
          <button
            type="submit"
            className="btn primary sm"
            disabled={!canSubmit}
            onMouseDown={(e) => e.preventDefault()}
          >
            Send
          </button>
        </form>
      </div>

      <ConfirmDialog
        open={pendingDelete != null || pendingBulkDelete}
        title={
          pendingBulkDelete
            ? `Delete ${selectedIds.size} message${selectedIds.size === 1 ? "" : "s"}?`
            : "Delete message?"
        }
        description={
          pendingBulkDelete
            ? "Selected messages will be removed from the server for both of you."
            : "This removes the ciphertext from the server for both of you."
        }
        confirmLabel={pendingBulkDelete ? "Delete Messages" : "Delete"}
        busy={deleting}
        danger
        onCancel={() => {
          if (deleting) return;
          setPendingDelete(null);
          setPendingBulkDelete(false);
        }}
        onConfirm={() => void confirmDelete()}
      />
    </main>
  );
}

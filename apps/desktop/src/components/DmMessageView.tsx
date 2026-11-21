import { GroupDmPicker } from "./GroupDmPicker";
import { dmTitle, otherCallers } from "../lib/dmDisplay";
import { memo, useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent } from "react";
import { MessageMoreMenu } from "./MessageMoreMenu";
import logoMark from "../assets/logo-mark.png";
import { insertAtCursor } from "../lib/emojis";
import { mediaUrl } from "../lib/mediaUrl";
import { sameId } from "../lib/serverPerms";
import { useStableHandlers } from "../hooks/useStableHandlers";
import { ConfirmDialog } from "./ConfirmDialog";
import { EmojiPickerButton } from "./EmojiPickerButton";
import { GifPickerButton, type GifHit } from "./GifPickerButton";
import { MessageAttachment } from "./MessageAttachment";
import { MessageContent } from "./MessageContent";
import { MessageEmbeds } from "./MessageEmbeds";
import { TypingIndicator } from "./TypingIndicator";
import { useAppStore } from "../store/appStore";
import type { DmChannel, DmMessage, UserPublic } from "../types";

const EMPTY_DM_MESSAGES: DmMessage[] = [];

const GROUP_WINDOW_MS = 7 * 60 * 1000;

function shouldStartGroup(prev: DmMessage | undefined, current: DmMessage): boolean {
  if (!prev) return true;
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

/** Row callbacks with a fixed identity, so rows can be memoized. */
type DmRowActions = {
  openProfile: (userId: string, e: MouseEvent) => void;
  toggleSelect: (m: DmMessage, e: MouseEvent) => void;
  startEdit: (id: string) => void;
  cancelEdit: () => void;
  saveEdit: (id: string, content: string) => Promise<void>;
  remove: (m: DmMessage) => void;
};

export function DmMessageView() {
  const activeDmId = useAppStore((s) => s.activeDmId);
  const channel = useAppStore((s) =>
    s.activeDmId ? s.dmChannels.find((c) => c.id === s.activeDmId) : undefined,
  );
  const messages = useAppStore((s) => {
    const id = s.activeDmId;
    if (!id) return EMPTY_DM_MESSAGES;
    return s.messagesByDm[id] ?? EMPTY_DM_MESSAGES;
  });
  const authors = useAppStore((s) => s.authors);
  const user = useAppStore((s) => s.user);
  const openMiniProfile = useAppStore((s) => s.openMiniProfile);
  const editDmMessage = useAppStore((s) => s.editDmMessage);
  const deleteDmMessage = useAppStore((s) => s.deleteDmMessage);
  const requestDmCallJoin = useAppStore((s) => s.requestDmCallJoin);
  // Only this DM's call participants, not every DM's.
  const dmCallParticipants = useAppStore((s) =>
    s.activeDmId ? s.dmCallByChannel[s.activeDmId] : undefined,
  );
  const dmCallId = useAppStore((s) => s.dmCallId);
  const e2eIdentityMissing = useAppStore((s) => s.e2eIdentityMissing);
  const setModal = useAppStore((s) => s.setModal);

  const [groupPicker, setGroupPicker] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const renameGroupDm = useAppStore((s) => s.renameGroupDm);
  const removeGroupDmMember = useAppStore((s) => s.removeGroupDmMember);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<DmMessage | null>(null);
  const [pendingBulkDelete, setPendingBulkDelete] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [deleting, setDeleting] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const canSend = Boolean(channel);
  const selfInCall = Boolean(activeDmId && dmCallId && sameId(dmCallId, activeDmId));
  const callers = channel ? otherCallers(channel, dmCallParticipants || [], user?.id) : [];
  const peerInCall = callers.length > 0;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, activeDmId]);

  useEffect(() => {
    setEditingId(null);
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

  const actions = useStableHandlers<DmRowActions>({
    openProfile: (userId, e) =>
      openMiniProfile({ userId, serverId: null, x: e.clientX, y: e.clientY }),
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
      if (!activeDmId) return;
      await editDmMessage(id, activeDmId, content);
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

  if (!channel || !activeDmId) {
    return (
      <main className="message-view empty-state">
        <div className="empty-brand">
          <img className="brand-logo-mark" src={logoMark} alt="" />
          <p className="brand-mark inline">Espalha Brasas</p>
          <h2>Private messages</h2>
          <p className="muted">
            Add a friend and open a chat. Messages are end-to-end encrypted on this device.
          </p>
        </div>
      </main>
    );
  }

  async function confirmDelete() {
    if (!activeDmId) return;
    setDeleting(true);
    try {
      if (pendingBulkDelete) {
        const toDelete = messages.filter(
          (m) => selectedIds.has(m.id) && m.author_id === user?.id,
        );
        await Promise.all(toDelete.map((m) => deleteDmMessage(m.id, activeDmId)));
        if (editingId && selectedIds.has(editingId)) setEditingId(null);
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
        {channel.is_group ? (
          <div className="dm-group-title">
            {renaming !== null ? (
              <input
                className="dm-group-rename"
                value={renaming}
                maxLength={100}
                autoFocus
                placeholder="Group name"
                onChange={(e) => setRenaming(e.target.value)}
                onBlur={() => {
                  const next = renaming;
                  setRenaming(null);
                  if (next.trim() !== (channel.name || "")) void renameGroupDm(channel.id, next);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  if (e.key === "Escape") setRenaming(null);
                }}
              />
            ) : (
              <h2
                className="dm-group-name"
                title="Rename group"
                onClick={() => setRenaming(channel.name || "")}
              >
                {dmTitle(channel, user?.id)}
              </h2>
            )}
            <p className="topic">
              {(channel.members || []).map((m) => m.display_name || m.username).join(", ")}
            </p>
          </div>
        ) : (
          <div>
            <h2>@{channel.peer.username}</h2>
            <p className="topic">{channel.peer.display_name}</p>
          </div>
        )}
        <div className="dm-header-actions">
          <button
            type="button"
            className="icon-btn"
            title={channel.is_group ? "Add friends to the group" : "Create a group with this person"}
            aria-label="Add friends"
            onClick={() => setGroupPicker(true)}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden fill="currentColor">
              <path d="M15 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm-9-2V7H4v3H1v2h3v3h2v-3h3v-2zm9 4c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
            </svg>
          </button>
          {channel.is_group && user && (
            <button
              type="button"
              className="icon-btn"
              title="Leave group"
              aria-label="Leave group"
              onClick={() => void removeGroupDmMember(channel.id, user.id)}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden fill="currentColor">
                <path d="M10.09 15.59 11.5 17l5-5-5-5-1.41 1.41L12.67 11H3v2h9.67zM19 3H5a2 2 0 0 0-2 2v4h2V5h14v14H5v-4H3v4a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z" />
              </svg>
            </button>
          )}
          <button
            type="button"
            className={`icon-btn dm-call-btn${selfInCall ? " active" : ""}`}
            title={selfInCall ? "In call" : "Start call"}
            aria-label={selfInCall ? "In call" : "Start call"}
            onClick={() => requestDmCallJoin(activeDmId)}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden fill="currentColor">
              <path d="M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1.01-.24c1.12.37 2.33.57 3.58.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1C10.85 21 3 13.15 3 3a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.46.57 3.58a1 1 0 0 1-.24 1.01l-2.2 2.2z" />
            </svg>
          </button>
          <span className="dm-e2e-badge" title="End-to-end encrypted" aria-label="End-to-end encrypted">
            E2E
          </span>
        </div>
      </header>

      {e2eIdentityMissing ? (
        <div className="e2e-identity-banner" role="alert">
          <div>
            <strong>Encryption keys missing on this device</strong>
            <p className="muted tiny">
              Old messages cannot be read until you restore your key backup. New messages you
              send would also break history for other people.
            </p>
          </div>
          <button type="button" className="btn primary sm" onClick={() => setModal("user-settings")}>
            Restore keys
          </button>
        </div>
      ) : null}

      {groupPicker && (
        <GroupDmPicker
          group={channel.is_group ? channel : undefined}
          fromDm={channel}
          onClose={() => setGroupPicker(false)}
        />
      )}

      {peerInCall && !selfInCall ? (
        <div className="dm-call-banner">
          <span>
            <strong>{callers[0]?.display_name}</strong>
            {callers.length > 1 ? ` and ${callers.length - 1} more are in a call` : " started a call"}
          </span>
          <button type="button" className="btn primary sm" onClick={() => requestDmCallJoin(activeDmId)}>
            Join
          </button>
        </div>
      ) : null}

      <div className="message-list">
        {messages.map((m, i) => (
          <DmMessageRow
            key={m.id}
            m={m}
            author={authors[m.author_id]}
            isGroupStart={shouldStartGroup(messages[i - 1], m)}
            mine={user?.id === m.author_id}
            canEdit={canSend}
            editing={editingId === m.id}
            selected={selectedIds.has(m.id)}
            actions={actions}
          />
        ))}
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

      {/* Keyed by DM so switching chats starts with an empty draft. */}
      <DmComposer key={activeDmId} channel={channel} />

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

type DmRowProps = {
  m: DmMessage;
  author: UserPublic | undefined;
  isGroupStart: boolean;
  mine: boolean;
  canEdit: boolean;
  editing: boolean;
  selected: boolean;
  actions: DmRowActions;
};

/** One DM. Re-renders only when its own props change. */
const DmMessageRow = memo(function DmMessageRow({
  m,
  author,
  isGroupStart,
  mine,
  canEdit,
  editing,
  selected,
  actions,
}: DmRowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <article
      className={`message ${isGroupStart ? "group-start" : "grouped"}${selected ? " selected" : ""}`}
      onClick={(e) => actions.toggleSelect(m, e)}
    >
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
              {author?.display_name || "Unknown"}
            </button>
            <time dateTime={m.created_at}>{formatTime(m.created_at)}</time>
          </div>
        )}

        {editing ? (
          <DmEditBox
            messageId={m.id}
            initial={m.content}
            onSave={actions.saveEdit}
            onCancel={actions.cancelEdit}
          />
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
              <MessageAttachment key={a.id} attachment={a} allowDownload={!mine} />
            ))}
          </div>
        )}

        {!editing && (mine || m.content) && (
          <div className={`message-actions${menuOpen ? " is-open" : ""}`}>
            <MessageMoreMenu
              onOpenChange={setMenuOpen}
              items={[
                ...(mine && canEdit
                  ? [{ label: "Edit message", onClick: () => actions.startEdit(m.id) }]
                  : []),
                ...(m.content
                  ? [{ label: "Copy text", onClick: () => void navigator.clipboard?.writeText(m.content) }]
                  : []),
                ...(mine && canEdit
                  ? [{ label: "Delete message", danger: true, onClick: () => actions.remove(m) }]
                  : []),
              ]}
            />
          </div>
        )}
      </div>
    </article>
  );
});

/** Inline DM editor with its own draft. */
function DmEditBox({
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

  async function save() {
    const content = draft.trim();
    if (!content) return;
    setBusy(true);
    try {
      await onSave(messageId, content);
    } finally {
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
      </div>
    </div>
  );
}

type PendingFile = { id: string; url: string; name: string; preview: boolean };

/** DM composer. Owns the draft so typing doesn't re-render the message list. */
function DmComposer({ channel }: { channel: DmChannel }) {
  const dmId = channel.id;
  const sendDmMessage = useAppStore((s) => s.sendDmMessage);
  const uploadFile = useAppStore((s) => s.uploadFile);
  const attachRemoteMedia = useAppStore((s) => s.attachRemoteMedia);
  const sendDmTyping = useAppStore((s) => s.sendDmTyping);

  const [draft, setDraft] = useState("");
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [fileUploading, setFileUploading] = useState(false);
  const [composerErr, setComposerErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const typingTimer = useRef<number | null>(null);
  const draftRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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

  const canSubmit =
    !busy && !fileUploading && (draft.trim().length > 0 || pendingFiles.length > 0);

  async function onSubmit(e?: FormEvent) {
    e?.preventDefault();
    if (!canSubmit) return;
    const ids = pendingFiles.map((f) => f.id);
    setBusy(true);
    setComposerErr(null);
    try {
      await sendDmMessage(dmId, draft.trim(), ids);
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
    if (busy) return;
    setBusy(true);
    setComposerErr(null);
    try {
      const att = await attachRemoteMedia({
        url: gif.url,
        filename: `${gif.title || "gif"}.gif`,
        content_type: "image/gif",
      });
      await sendDmMessage(dmId, "", [att.id]);
    } catch (error) {
      setComposerErr(error instanceof Error ? error.message : "Could not send GIF");
    } finally {
      setBusy(false);
    }
  }

  async function onPickFile(file: File | null) {
    if (!file) return;
    setFileUploading(true);
    setComposerErr(null);
    try {
      const uploaded = await uploadFile(file);
      const preview =
        file.type.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(file.name || "");
      setPendingFiles((prev) => [
        ...prev,
        { id: uploaded.id, url: uploaded.url, name: file.name, preview },
      ]);
    } catch (error) {
      setComposerErr(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setFileUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void onSubmit();
    }
    if (!typingTimer.current) {
      void sendDmTyping(dmId);
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

  return (
    <div className="composer-wrap">
      <TypingIndicator channelId={dmId} />
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
                onClick={() => setPendingFiles((prev) => prev.filter((p) => p.id !== f.id))}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      {fileUploading && <p className="muted tiny pending-upload-status">Uploading…</p>}
      {composerErr && <p className="form-error composer-error">{composerErr}</p>}
      <form className="composer composer-dm" onSubmit={(e) => void onSubmit(e)}>
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
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={channel.is_group ? `Message ${dmTitle(channel, useAppStore.getState().user?.id)}` : `Message @${channel.peer.username}`}
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
  );
}

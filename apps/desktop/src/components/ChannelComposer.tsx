import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { insertAtCursor } from "../lib/emojis";
import {
  filterMentionSuggestions,
  mentionInsertText,
  mentionQueryAtCursor,
  type MentionContext,
  type MentionSuggestion,
} from "../lib/mentions";
import { mediaUrl } from "../lib/mediaUrl";
import { MAX_MESSAGE_CHARS, messageLength } from "../lib/messageLimits";
import { useAppStore } from "../store/appStore";
import type { Channel } from "../types";
import { CharCounter } from "./CharCounter";
import { EmojiPickerButton } from "./EmojiPickerButton";
import { GifPickerButton, type GifHit } from "./GifPickerButton";
import { TypingIndicator } from "./TypingIndicator";

type PendingFile = { id: string; url: string; name: string; preview: boolean };

type Props = {
  channel: Channel;
  mentionCtx: MentionContext;
  canMentionEveryone: boolean;
};

/**
 * Channel message composer. Owns the draft so typing re-renders only this
 * component, not the message list above it.
 */
export function ChannelComposer({ channel, mentionCtx, canMentionEveryone }: Props) {
  const channelId = channel.id;
  const sendMessage = useAppStore((s) => s.sendMessage);
  const sendTyping = useAppStore((s) => s.sendTyping);
  const uploadFile = useAppStore((s) => s.uploadFile);
  const attachRemoteMedia = useAppStore((s) => s.attachRemoteMedia);
  const authors = useAppStore((s) => s.authors);
  const pendingComposerInsert = useAppStore((s) => s.pendingComposerInsert);
  const clearPendingComposerInsert = useAppStore((s) => s.clearPendingComposerInsert);

  const [draft, setDraft] = useState("");
  const draftTooLong = messageLength(draft) > MAX_MESSAGE_CHARS;
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [fileUploading, setFileUploading] = useState(false);
  const [composerErr, setComposerErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionQuery, setMentionQuery] = useState<{ start: number; query: string } | null>(
    null,
  );
  const typingTimer = useRef<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const draftRef = useRef<HTMLTextAreaElement>(null);

  const mentionSuggestions = useMemo(() => {
    if (!mentionQuery) return [] as MentionSuggestion[];
    return filterMentionSuggestions(mentionQuery.query, mentionCtx.members, mentionCtx.roles, {
      allowEveryone: canMentionEveryone,
    });
  }, [mentionQuery, mentionCtx.members, mentionCtx.roles, canMentionEveryone]);

  useEffect(() => {
    setMentionIndex(0);
  }, [mentionSuggestions, mentionQuery?.query]);

  useEffect(() => {
    setMentionQuery(null);
  }, [channelId]);

  useEffect(() => {
    if (!pendingComposerInsert || pendingComposerInsert.channelId !== channelId) return;
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
  }, [pendingComposerInsert, channelId, clearPendingComposerInsert]);

  function applyMention(item: MentionSuggestion) {
    const el = draftRef.current;
    if (!el || !mentionQuery) return;
    const cursor = el.selectionStart ?? draft.length;
    const insert = `${mentionInsertText(item)} `;
    const next = draft.slice(0, mentionQuery.start) + insert + draft.slice(cursor);
    setDraft(next);
    setMentionQuery(null);
    requestAnimationFrame(() => {
      const pos = mentionQuery.start + insert.length;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  }

  async function onSubmit(e?: FormEvent) {
    e?.preventDefault();
    if (fileUploading) return;
    if (!draft.trim() && !pendingFiles.length) return;
    if (draftTooLong) return;
    setBusy(true);
    setComposerErr(null);
    try {
      await sendMessage(
        channelId,
        draft.trim(),
        pendingFiles.map((f) => f.id),
      );
      setDraft("");
      setPendingFiles([]);
      setMentionQuery(null);
    } catch (error) {
      setComposerErr(error instanceof Error ? error.message : "Failed to send message");
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
          (i) => (i - 1 + mentionSuggestions.length) % mentionSuggestions.length,
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
    if (!typingTimer.current) {
      void sendTyping(channelId);
      typingTimer.current = window.setTimeout(() => {
        typingTimer.current = null;
      }, 2500);
    }
  }

  async function onPickGif(gif: GifHit) {
    setBusy(true);
    try {
      const att = await attachRemoteMedia({
        url: gif.url,
        filename: `${gif.title || "gif"}.gif`,
        content_type: "image/gif",
      });
      await sendMessage(channelId, "", [att.id]);
    } catch (error) {
      setComposerErr(error instanceof Error ? error.message : "Failed to send GIF");
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
    if (!file) return;
    setFileUploading(true);
    setComposerErr(null);
    try {
      const uploaded = await uploadFile(file);
      const preview =
        file.type.startsWith("image/") ||
        /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(file.name || "");
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

  return (
    <div className="composer-wrap">
      {mentionQuery && mentionSuggestions.length > 0 && (
        <div className="mention-autocomplete" role="listbox">
          {mentionSuggestions.map((item, i) => {
            const active = i === mentionIndex;
            const itemProps = {
              type: "button" as const,
              role: "option",
              "aria-selected": active,
              className: `mention-autocomplete-item${active ? " active" : ""}`,
              onMouseDown: (e: React.MouseEvent) => {
                e.preventDefault();
                applyMention(item);
              },
            };
            if (item.kind === "everyone" || item.kind === "here") {
              return (
                <button key={item.kind} {...itemProps}>
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
                <button key={`role-${item.role.id}`} {...itemProps}>
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
            const avatar = authors[u.id]?.avatar_url;
            return (
              <button key={`user-${u.id}`} {...itemProps}>
                {avatar ? (
                  <img
                    className="mention-autocomplete-avatar"
                    src={mediaUrl(avatar)}
                    alt=""
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <span className="mention-autocomplete-avatar">
                    {(u.display_name || u.username || "?").charAt(0).toUpperCase()}
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
      <TypingIndicator channelId={channelId} />
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
      <CharCounter text={draft} className="composer-char-counter" />
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
        <button
          type="submit"
          className="btn primary sm"
          disabled={busy || fileUploading || draftTooLong}
        >
          Send
        </button>
      </form>
    </div>
  );
}

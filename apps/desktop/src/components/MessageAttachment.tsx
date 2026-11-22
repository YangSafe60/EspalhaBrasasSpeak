import { useEffect, useState, type MouseEvent } from "react";
import { decryptedUrl } from "../lib/attachmentCrypto";
import { downloadRemoteFile } from "../lib/downloadMedia";
import { imageSrc } from "../lib/mediaUrl";
import { isImageAttachment } from "../store/helpers/messageHelpers";
import type { Attachment } from "../types";
import { ContextMenu } from "./ContextMenu";

/** "Casa.blend1" -> "BLEND1" (shown on the file icon). */
function fileExt(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).slice(0, 6).toUpperCase() : "";
}

function formatBytes(n: number): string {
  if (!n || n < 0) return "File";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

function FileIcon({ ext }: { ext: string }) {
  return (
    <span className="file-card-icon" aria-hidden>
      <svg viewBox="0 0 32 40" width="32" height="40">
        <path d="M4 1h17l10 10v26a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2z" fill="currentColor" opacity="0.18" />
        <path d="M21 1v8a2 2 0 0 0 2 2h8" fill="none" stroke="currentColor" strokeWidth="1.6" opacity="0.6" />
        <path d="M4 1h17l10 10v26a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2z" fill="none" stroke="currentColor" strokeWidth="1.6" />
      </svg>
      {ext && <span className={`file-card-ext${ext.length > 4 ? " long" : ""}`}>{ext}</span>}
    </span>
  );
}

type Props = {
  attachment: Attachment;
  /** When false, only the default browser menu is shown (e.g. own uploads). */
  allowDownload?: boolean;
};

export function MessageAttachment({
  attachment,
  allowDownload = true,
}: Props) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [broken, setBroken] = useState(false);
  const encrypted = Boolean(attachment.enc_key);
  /** Encrypted files: a blob: URL once downloaded and decrypted. */
  const [plainUrl, setPlainUrl] = useState<string | null>(null);
  const image = isImageAttachment(attachment);
  const audio = !image && (attachment.content_type || "").toLowerCase().startsWith("audio/");

  useEffect(() => {
    if (!encrypted) return;
    let alive = true;
    setPlainUrl(null);
    setBroken(false);
    // Images and voice messages load right away; other files only when saved.
    if (image || audio) {
      decryptedUrl(attachment)
        .then((u) => alive && setPlainUrl(u))
        .catch(() => alive && setBroken(true));
    }
    return () => {
      alive = false;
    };
  }, [attachment, encrypted, image, audio]);

  const src = encrypted ? plainUrl : imageSrc(attachment.url);

  const [saving, setSaving] = useState(false);

  /** Save to disk (decrypting first when needed). */
  async function save() {
    if (!encrypted) {
      void downloadRemoteFile(attachment.url, attachment.filename);
      return;
    }
    setSaving(true);
    try {
      const blobUrl = await decryptedUrl(attachment);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = attachment.filename || "download";
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch {
      setBroken(true);
    } finally {
      setSaving(false);
    }
  }

  function onAttachmentContextMenu(e: MouseEvent) {
    if (!allowDownload) return;
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY });
  }

  const temporary = attachment.temporary_until
    ? new Date(attachment.temporary_until).getTime() > Date.now()
    : false;

  return (
    <div className={`attachment-item${temporary ? " is-temporary" : ""}`}>
      {temporary && (
        <span
          className="attachment-temporary"
          title="Catbox was down, so this file is on a temporary host. The server moves it to Catbox automatically when Catbox is back (within 72 hours)."
        >
          Temporary · saving permanently
        </span>
      )}
      {image ? (
        encrypted && !src && !broken ? (
          <span className="image-loading" aria-label="Loading image" />
        ) : src && !broken ? (
          <a
            href={src}
            target="_blank"
            rel="noreferrer"
            onContextMenu={onAttachmentContextMenu}
          >
            <img
              src={src}
              alt={attachment.filename}
              loading="lazy"
              decoding="async"
              onError={() => setBroken(true)}
              onContextMenu={onAttachmentContextMenu}
            />
          </a>
        ) : (
          <span className="image-unavailable" onContextMenu={onAttachmentContextMenu}>
            Image unavailable
          </span>
        )
      ) : audio ? (
        <div className="voice-message" onContextMenu={onAttachmentContextMenu}>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden fill="currentColor" className="voice-message-icon">
            <path d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z" />
          </svg>
          {broken ? (
            <span className="muted tiny">Voice message unavailable</span>
          ) : encrypted && !plainUrl ? (
            <span className="muted tiny">Loading voice message…</span>
          ) : (
            <audio controls preload="metadata" src={encrypted ? plainUrl ?? undefined : attachment.url} />
          )}
        </div>
      ) : (
        <div className="file-card" onContextMenu={onAttachmentContextMenu}>
          <FileIcon ext={fileExt(attachment.filename)} />
          <div className="file-card-text">
            <span className="file-card-name" title={attachment.filename}>
              {attachment.filename}
            </span>
            <span className="file-card-meta">
              {broken
                ? "Unavailable"
                : saving
                  ? "Downloading…"
                  : formatBytes(attachment.size)}
            </span>
          </div>
          <button
            type="button"
            className="file-card-download"
            title={`Download ${attachment.filename}`}
            aria-label={`Download ${attachment.filename}`}
            disabled={saving}
            onClick={() => void save()}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden fill="currentColor">
              <path d="M12 3a1 1 0 0 1 1 1v9.59l3.3-3.3a1 1 0 1 1 1.4 1.42l-5 5a1 1 0 0 1-1.4 0l-5-5a1 1 0 1 1 1.4-1.42l3.3 3.3V4a1 1 0 0 1 1-1zM5 19a1 1 0 0 1 1-1h12a1 1 0 1 1 0 2H6a1 1 0 0 1-1-1z" />
            </svg>
          </button>
        </div>
      )}
      {menu ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            {
              label: "Download",
              onClick: () => void save(),
            },
          ]}
        />
      ) : null}
    </div>
  );
}

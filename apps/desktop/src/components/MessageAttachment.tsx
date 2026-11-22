import { useEffect, useState, type MouseEvent } from "react";
import { decryptedUrl } from "../lib/attachmentCrypto";
import { downloadRemoteFile } from "../lib/downloadMedia";
import { imageSrc, mediaUrl } from "../lib/mediaUrl";
import { isImageAttachment } from "../store/helpers/messageHelpers";
import type { Attachment } from "../types";
import { ContextMenu } from "./ContextMenu";

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

  useEffect(() => {
    if (!encrypted) return;
    let alive = true;
    setPlainUrl(null);
    setBroken(false);
    // Images load right away; other files only when opened or downloaded.
    if (image) {
      decryptedUrl(attachment)
        .then((u) => alive && setPlainUrl(u))
        .catch(() => alive && setBroken(true));
    }
    return () => {
      alive = false;
    };
  }, [attachment, encrypted, image]);

  const url = encrypted ? plainUrl : mediaUrl(attachment.url);
  const src = encrypted ? plainUrl : imageSrc(attachment.url);

  /** Save to disk (decrypting first when needed). */
  async function save() {
    if (!encrypted) {
      void downloadRemoteFile(attachment.url, attachment.filename);
      return;
    }
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
    }
  }

  function onAttachmentContextMenu(e: MouseEvent) {
    if (!allowDownload) return;
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY });
  }

  return (
    <>
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
      ) : encrypted ? (
        <button
          type="button"
          className="attachment-file-link"
          title="Download"
          onClick={() => void save()}
          onContextMenu={onAttachmentContextMenu}
        >
          {broken ? `${attachment.filename} (unavailable)` : attachment.filename}
        </button>
      ) : (
        <a
          href={url ?? undefined}
          target="_blank"
          rel="noreferrer"
          onContextMenu={onAttachmentContextMenu}
        >
          {attachment.filename}
        </a>
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
    </>
  );
}

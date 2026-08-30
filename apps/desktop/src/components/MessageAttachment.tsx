import { useState, type MouseEvent } from "react";
import { downloadRemoteFile } from "../lib/downloadMedia";
import { mediaUrl } from "../lib/mediaUrl";
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
  const url = mediaUrl(attachment.url);
  const image = isImageAttachment(attachment);

  function onAttachmentContextMenu(e: MouseEvent) {
    if (!allowDownload) return;
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY });
  }

  return (
    <>
      {image ? (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          onContextMenu={onAttachmentContextMenu}
        >
          <img
            src={url}
            alt={attachment.filename}
            referrerPolicy="no-referrer"
            onContextMenu={onAttachmentContextMenu}
          />
        </a>
      ) : (
        <a
          href={url}
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
              onClick: () =>
                void downloadRemoteFile(attachment.url, attachment.filename),
            },
          ]}
        />
      ) : null}
    </>
  );
}

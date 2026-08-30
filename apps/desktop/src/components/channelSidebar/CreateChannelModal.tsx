import { createPortal } from "react-dom";
import type { FormEvent } from "react";
import { VoiceChannelIcon } from "../VoiceChannelIcon";
import type { CreateDraft } from "./types";

type Props = {
  draft: CreateDraft;
  categoryName: string | null;
  channelType: "text" | "voice";
  name: string;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onChannelType: (t: "text" | "voice") => void;
  onName: (name: string) => void;
  onSubmit: (e: FormEvent) => void;
};

/** Modal to create a new text/voice channel or category. */
export function CreateChannelModal({
  draft,
  categoryName,
  channelType,
  name,
  busy,
  error,
  onClose,
  onChannelType,
  onName,
  onSubmit,
}: Props) {
  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal create-channel-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-header">
          <h3>
            {draft.mode === "category" ? "Create Category" : "Create Channel"}
          </h3>
          <button type="button" className="icon-btn" onClick={onClose}>
            ✕
          </button>
        </header>
        <form className="stack" onSubmit={onSubmit}>
          {draft.mode === "channel" && (
            <>
              <p className="muted tiny">
                {categoryName
                  ? `In category “${categoryName}”`
                  : "No category (top-level channel)"}
              </p>
              <div className="channel-type-picker">
                <button
                  type="button"
                  className={channelType === "text" ? "active" : ""}
                  onClick={() => onChannelType("text")}
                >
                  <span className="ch-icon">#</span>
                  <span>
                    <strong>Text</strong>
                    <em>Chat, links, images</em>
                  </span>
                </button>
                <button
                  type="button"
                  className={channelType === "voice" ? "active" : ""}
                  onClick={() => onChannelType("voice")}
                >
                  <span className="ch-icon">
                    <VoiceChannelIcon size={15} />
                  </span>
                  <span>
                    <strong>Voice</strong>
                    <em>Talk and screen share</em>
                  </span>
                </button>
              </div>
            </>
          )}
          <label>
            {draft.mode === "category" ? "Category name" : "Channel name"}
            <input
              autoFocus
              value={name}
              onChange={(e) => onName(e.target.value)}
              placeholder={
                draft.mode === "category" ? "new-category" : "new-channel"
              }
              required
              maxLength={64}
            />
          </label>
          {error && <p className="form-error">{error}</p>}
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button type="button" className="btn ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn primary"
              disabled={busy || !name.trim()}
            >
              {busy ? "Creating…" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}

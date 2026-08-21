import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import logoFull from "../assets/logo-full.png";

export type ShareConsentMode = "new" | "add" | "replace";

type Props = {
  open: boolean;
  busy?: boolean;
  mode?: ShareConsentMode;
  onContinue: () => void;
  onCancel: () => void;
};

function copyForMode(mode: ShareConsentMode) {
  if (mode === "replace") {
    return {
      title: "Change what you’re sharing",
      body: "Windows will ask which screen or window to share next. Prefer a full screen and turn on system audio if others should hear video or music.",
      cta: "Choose screen",
    };
  }
  if (mode === "add") {
    return {
      title: "Share another screen",
      body: "You’ll pick another display or window in the system dialog. Enable system audio there if you want sound with this share.",
      cta: "Choose screen",
    };
  }
  return {
    title: "Share your screen",
    body: "Next, Windows will ask what to share. Pick a screen (not just a window) and enable Share system audio if viewers should hear what’s playing.",
    cta: "Continue",
  };
}

/** Branded step before the OS getDisplayMedia picker. */
export function ShareConsentModal({
  open,
  busy,
  mode = "new",
  onContinue,
  onCancel,
}: Props) {
  const [visible, setVisible] = useState(false);
  const copy = copyForMode(mode);

  useEffect(() => {
    if (!open) {
      setVisible(false);
      return;
    }
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className={`mic-consent-backdrop${visible ? " show" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-consent-title"
    >
      <div className={`mic-consent-card${visible ? " show" : ""}`}>
        <div className="mic-consent-glow" aria-hidden />
        <img className="mic-consent-logo" src={logoFull} alt="" />
        <p className="mic-consent-eyebrow">Screen share</p>
        <h2 id="share-consent-title">{copy.title}</h2>
        <p className="mic-consent-copy">{copy.body}</p>
        <ul className="share-consent-tips muted tiny">
          <li>Best quality: share an entire screen</li>
          <li>For video sound: enable system audio in the next dialog</li>
          <li>Stop anytime from the voice bar</li>
        </ul>
        <div className="mic-consent-actions">
          <button
            type="button"
            className="btn ghost"
            disabled={busy}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={busy}
            onClick={onContinue}
          >
            {busy ? "Opening…" : copy.cta}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

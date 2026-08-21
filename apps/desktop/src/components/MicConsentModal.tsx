import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import logoFull from "../assets/logo-full.png";

const STORAGE_KEY = "eb_mic_intro_done";

export function micIntroDone(): boolean {
  return localStorage.getItem(STORAGE_KEY) === "1";
}

export function markMicIntroDone() {
  localStorage.setItem(STORAGE_KEY, "1");
}

type Props = {
  open: boolean;
  busy?: boolean;
  onContinue: () => void;
  onCancel: () => void;
};

/** Branded first-run mic gate — replaces the bare OS “localhost wants mic” vibe. */
export function MicConsentModal({ open, busy, onContinue, onCancel }: Props) {
  const [visible, setVisible] = useState(false);

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
      aria-labelledby="mic-consent-title"
    >
      <div className={`mic-consent-card${visible ? " show" : ""}`}>
        <div className="mic-consent-glow" aria-hidden />
        <img className="mic-consent-logo" src={logoFull} alt="" />
        <p className="mic-consent-eyebrow">Voice lobby</p>
        <h2 id="mic-consent-title">Ready when you are</h2>
        <p className="mic-consent-copy">
          Espalha Brasas uses your microphone so others can hear you in this
          channel. You can mute anytime from the voice bar.
        </p>
        <div className="mic-consent-actions">
          <button
            type="button"
            className="btn ghost"
            disabled={busy}
            onClick={onCancel}
          >
            Not now
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={busy}
            onClick={onContinue}
          >
            {busy ? "Connecting…" : "Join with mic"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

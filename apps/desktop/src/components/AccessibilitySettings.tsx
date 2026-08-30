import { useEffect, useState } from "react";
import {
  type AccessibilityPrefs,
  type ChatDisplay,
  type UiDensity,
  CHAT_FONT_SIZES,
  DEFAULT_A11Y,
  MESSAGE_GROUP_GAPS,
  ZOOM_LEVELS,
  loadAccessibility,
  previewTts,
  setAndApplyAccessibility,
  watchReducedMotion,
} from "../lib/accessibility";

type Props = {
  onOpenAppearance?: () => void;
};

function StepSlider({
  label,
  description,
  value,
  values,
  format,
  onChange,
}: {
  label: string;
  description?: string;
  value: number;
  values: readonly number[];
  format?: (n: number) => string;
  onChange: (n: number) => void;
}) {
  const nearestIdx = values.reduce(
    (best, v, i) =>
      Math.abs(v - value) < Math.abs(values[best]! - value) ? i : best,
    0,
  );
  return (
    <div className="a11y-field">
      <div className="a11y-field-head">
        <div>
          <strong>{label}</strong>
          {description ? <p className="muted tiny">{description}</p> : null}
        </div>
        <span className="a11y-value">
          {format ? format(values[nearestIdx]!) : String(values[nearestIdx])}
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={values.length - 1}
        step={1}
        value={nearestIdx}
        onChange={(e) => onChange(values[Number(e.target.value)] ?? value)}
        aria-label={label}
      />
      <div className="a11y-ticks" aria-hidden>
        {values.map((v) => (
          <span key={v}>{format ? format(v) : v}</span>
        ))}
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="a11y-toggle">
      <div>
        <strong>{label}</strong>
        {description ? <p className="muted tiny">{description}</p> : null}
      </div>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}

function RadioRow<T extends string>({
  label,
  description,
  value,
  options,
  onChange,
}: {
  label: string;
  description?: string;
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="a11y-field">
      <strong>{label}</strong>
      {description ? <p className="muted tiny">{description}</p> : null}
      <div className="a11y-radios" role="radiogroup" aria-label={label}>
        {options.map((opt) => (
          <label key={opt.id} className="a11y-radio">
            <input
              type="radio"
              name={label}
              checked={value === opt.id}
              onChange={() => onChange(opt.id)}
            />
            {opt.label}
          </label>
        ))}
      </div>
    </div>
  );
}

export function AccessibilitySettings({ onOpenAppearance }: Props) {
  const [prefs, setPrefs] = useState<AccessibilityPrefs>(() =>
    loadAccessibility(),
  );

  function commit(next: AccessibilityPrefs) {
    setPrefs(next);
    setAndApplyAccessibility(next);
  }

  function patch(partial: Partial<AccessibilityPrefs>) {
    commit({ ...prefs, ...partial });
  }

  useEffect(() => {
    return watchReducedMotion(() => {
      const p = loadAccessibility();
      if (p.syncReducedMotion) applyFromStore();
    });
    function applyFromStore() {
      setAndApplyAccessibility(loadAccessibility());
      setPrefs(loadAccessibility());
    }
  }, []);

  return (
    <div className="a11y-settings stack">
      <section className="a11y-section">
        <h4>Preview</h4>
        <div
          className="a11y-preview"
          style={{ fontSize: `var(--chat-font-size, ${prefs.chatFontSize}px)` }}
        >
          <article className="a11y-preview-msg">
            <span className="a11y-preview-avatar" aria-hidden>
              A
            </span>
            <div>
              <div className="a11y-preview-meta">
                <strong>Alex</strong>
                <time>Today at 2:41 PM</time>
              </div>
              <p>
                Accessibility settings change how chat looks and feels.{" "}
                <a href="https://example.com" onClick={(e) => e.preventDefault()}>
                  Example link
                </a>
              </p>
              <div className="a11y-preview-reactions">
                <span>👍 2</span>
                <span>🔥 1</span>
              </div>
            </div>
          </article>
          <article
            className="a11y-preview-msg"
            style={{ marginTop: `var(--message-group-gap, ${prefs.messageGroupGap}px)` }}
          >
            <span className="a11y-preview-avatar" aria-hidden>
              S
            </span>
            <div>
              <div className="a11y-preview-meta">
                <strong>Sam</strong>
                <time>Today at 2:42 PM</time>
              </div>
              <p>Try the text size and spacing controls below.</p>
            </div>
          </article>
        </div>
      </section>

      <section className="a11y-section">
        <h4>Text Readability</h4>
        <StepSlider
          label="Text size in chat"
          description="Adjust the size of the chat font."
          value={prefs.chatFontSize}
          values={CHAT_FONT_SIZES}
          format={(n) => `${n}px`}
          onChange={(chatFontSize) => patch({ chatFontSize })}
        />
        <ToggleRow
          label="Always underline links"
          description="Make links stand out more."
          checked={prefs.underlineLinks}
          onChange={(underlineLinks) => patch({ underlineLinks })}
        />
      </section>

      <section className="a11y-section">
        <h4>Visual Density</h4>
        <RadioRow<UiDensity>
          label="UI Density"
          description="Adjust the space between server, channel, and member lists."
          value={prefs.uiDensity}
          options={[
            { id: "compact", label: "Compact" },
            { id: "default", label: "Default" },
            { id: "spacious", label: "Spacious" },
          ]}
          onChange={(uiDensity) => patch({ uiDensity })}
        />
        <RadioRow<ChatDisplay>
          label="Chat Message Display"
          description="Change the appearance of chat messages."
          value={prefs.chatDisplay}
          options={[
            { id: "default", label: "Default" },
            { id: "compact", label: "Compact" },
          ]}
          onChange={(chatDisplay) => patch({ chatDisplay })}
        />
        <StepSlider
          label="Space Between Message Groups"
          description="Adjust the spacing between message groups."
          value={prefs.messageGroupGap}
          values={MESSAGE_GROUP_GAPS}
          format={(n) => `${n}px`}
          onChange={(messageGroupGap) => patch({ messageGroupGap })}
        />
        <StepSlider
          label="Zoom level"
          description="Adjust the size of the interface."
          value={prefs.zoom}
          values={ZOOM_LEVELS}
          format={(n) => `${n}%`}
          onChange={(zoom) => patch({ zoom })}
        />
      </section>

      <section className="a11y-section">
        <h4>Color & Contrast</h4>
        <StepSlider
          label="Saturation"
          description="Reduce the saturation of colors within the app. This does not affect images, videos, or role colors."
          value={prefs.saturation}
          values={[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]}
          format={(n) => `${n}%`}
          onChange={(saturation) => patch({ saturation })}
        />
        <ToggleRow
          label="Enable High Contrast Mode"
          description="Increase contrast of borders and text."
          checked={prefs.highContrast}
          onChange={(highContrast) => patch({ highContrast })}
        />
      </section>

      <section className="a11y-section">
        <h4>Reduced Motion</h4>
        <ToggleRow
          label="Enable Reduced Motion"
          description="Reduce animations, hover effects, and other moving effects."
          checked={prefs.reducedMotion}
          onChange={(reducedMotion) =>
            patch({ reducedMotion, syncReducedMotion: false })
          }
        />
        <ToggleRow
          label="Sync with computer setting"
          description="Use your system reduced-motion preference."
          checked={prefs.syncReducedMotion}
          onChange={(syncReducedMotion) => patch({ syncReducedMotion })}
        />
        <ToggleRow
          label="Play animated emoji"
          description="Animate custom emoji when available."
          checked={prefs.playAnimatedEmoji}
          onChange={(playAnimatedEmoji) => patch({ playAnimatedEmoji })}
        />
      </section>

      <section className="a11y-section">
        <h4>Audio & Screen Reader</h4>
        <StepSlider
          label="Text-to-Speech rate"
          description="Control the speed for Speak Message and other text-to-speech features."
          value={Math.round(prefs.ttsRate * 10) / 10}
          values={[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]}
          format={(n) => `x${n.toFixed(1)}`}
          onChange={(ttsRate) => patch({ ttsRate })}
        />
        <button
          type="button"
          className="btn primary sm"
          onClick={() => previewTts(prefs.ttsRate)}
        >
          Preview
        </button>
        <ToggleRow
          label="Show image descriptions"
          description="Show image filenames and alt text more clearly in chat."
          checked={prefs.showImageDescriptions}
          onChange={(showImageDescriptions) =>
            patch({ showImageDescriptions })
          }
        />
      </section>

      {onOpenAppearance && (
        <button
          type="button"
          className="a11y-related"
          onClick={onOpenAppearance}
        >
          <span>
            <strong>Appearance</strong>
            <em className="muted tiny">Themes, colors, and notification sounds</em>
          </span>
          <span aria-hidden>›</span>
        </button>
      )}

      <button
        type="button"
        className="btn ghost sm"
        onClick={() => commit({ ...DEFAULT_A11Y })}
      >
        Reset accessibility defaults
      </button>
    </div>
  );
}

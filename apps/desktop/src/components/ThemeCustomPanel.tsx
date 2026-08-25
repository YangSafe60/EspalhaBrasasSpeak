import { useCallback, useEffect, useRef, useState } from "react";
import {
  type CustomTheme,
  hexToHsv,
  hsvToHex,
  normalizeHex,
  randomCustomTheme,
} from "../lib/theme";

type Props = {
  custom: CustomTheme;
  onChange: (next: CustomTheme) => void;
  onBack: () => void;
  onReset: () => void;
};

export function ThemeCustomPanel({
  custom,
  onChange,
  onBack,
  onReset,
}: Props) {
  const padRef = useRef<HTMLDivElement>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const color = custom.colors[activeIdx] || custom.colors[0] || "#5865f2";
  const hsv = hexToHsv(color) || { h: 235, s: 0.66, v: 0.95 };
  const [hexDraft, setHexDraft] = useState(color);

  useEffect(() => {
    setHexDraft(color);
  }, [color]);

  const patchColor = useCallback(
    (hex: string) => {
      const next = [...custom.colors];
      while (next.length <= activeIdx) next.push("#5865f2");
      next[activeIdx] = hex;
      onChange({ ...custom, colors: next.slice(0, 2) });
    },
    [activeIdx, custom, onChange],
  );

  const setFromPad = useCallback(
    (clientX: number, clientY: number) => {
      const el = padRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const s = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      const v = Math.min(
        1,
        Math.max(0, 1 - (clientY - rect.top) / rect.height),
      );
      patchColor(hsvToHex(hsv.h, s, v));
    },
    [hsv.h, patchColor],
  );

  useEffect(() => {
    const el = padRef.current;
    if (!el) return;
    let dragging = false;
    const onDown = (e: PointerEvent) => {
      dragging = true;
      el.setPointerCapture(e.pointerId);
      setFromPad(e.clientX, e.clientY);
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      setFromPad(e.clientX, e.clientY);
    };
    const onUp = () => {
      dragging = false;
    };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
    };
  }, [setFromPad]);

  const hueColor = hsvToHex(hsv.h, 1, 1);

  return (
    <div className="theme-custom-panel">
      <header>
        <h3>Customize your theme</h3>
        <button
          type="button"
          className="icon-btn"
          aria-label="Close"
          onClick={onBack}
        >
          ×
        </button>
      </header>

      <div className="theme-section">
        <h4>Appearance</h4>
        <div className="theme-mode-toggle" role="group" aria-label="Mode">
          <button
            type="button"
            className={custom.mode === "dark" ? "on" : ""}
            onClick={() => onChange({ ...custom, mode: "dark" })}
          >
            Dark
          </button>
          <button
            type="button"
            className={custom.mode === "light" ? "on" : ""}
            onClick={() => onChange({ ...custom, mode: "light" })}
          >
            Light
          </button>
        </div>
      </div>

      <div className="theme-section">
        <h4>Colors</h4>
        <div
          ref={padRef}
          className="theme-sv-pad"
          style={{
            background: `
              linear-gradient(to top, #000, transparent),
              linear-gradient(to right, #fff, ${hueColor})
            `,
          }}
          role="presentation"
        >
          <span
            className="theme-sv-cursor"
            style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }}
          />
        </div>
        <input
          className="theme-hue-range"
          type="range"
          min={0}
          max={360}
          value={Math.round(hsv.h)}
          onChange={(e) =>
            patchColor(hsvToHex(Number(e.target.value), hsv.s, hsv.v))
          }
          aria-label="Hue"
        />
        <div className="theme-hex-row">
          <span className="swatch" style={{ background: color }} />
          <input
            type="text"
            value={hexDraft}
            maxLength={7}
            spellCheck={false}
            aria-label="Hex color"
            onChange={(e) => {
              setHexDraft(e.target.value);
              const n = normalizeHex(e.target.value);
              if (n) patchColor(n);
            }}
            onBlur={() => setHexDraft(color)}
          />
          <input
            type="color"
            value={normalizeHex(color) || "#5865f2"}
            aria-label="Pick color"
            onChange={(e) => patchColor(e.target.value)}
          />
        </div>
        <div className="theme-color-chips">
          {custom.colors.map((c, i) => (
            <button
              key={`${c}-${i}`}
              type="button"
              className={`theme-color-chip${i === activeIdx ? " on" : ""}`}
              style={{ background: c }}
              title={`Color ${i + 1}`}
              onClick={() => setActiveIdx(i)}
            />
          ))}
          {custom.colors.length < 2 && (
            <button
              type="button"
              className="btn ghost sm"
              onClick={() => {
                const next = [...custom.colors, hsvToHex((hsv.h + 50) % 360, 0.7, 0.9)];
                onChange({ ...custom, colors: next });
                setActiveIdx(next.length - 1);
              }}
            >
              + Add Color
            </button>
          )}
          {custom.colors.length > 1 && (
            <button
              type="button"
              className="theme-color-chip remove"
              title="Remove color"
              onClick={() => {
                const next = custom.colors.filter((_, i) => i !== activeIdx);
                onChange({ ...custom, colors: next.length ? next : ["#5865f2"] });
                setActiveIdx(0);
              }}
            >
              −
            </button>
          )}
        </div>
      </div>

      <div className="theme-section">
        <h4>Controls</h4>
        <div className="theme-intensity-row">
          <span>Color Intensity</span>
          <span>{Math.round(custom.intensity)}%</span>
        </div>
        <input
          className="theme-hue-range"
          type="range"
          min={0}
          max={100}
          value={custom.intensity}
          onChange={(e) =>
            onChange({ ...custom, intensity: Number(e.target.value) })
          }
          aria-label="Color intensity"
        />
      </div>

      <div className="theme-custom-actions">
        <button
          type="button"
          className="btn ghost"
          onClick={() => onChange(randomCustomTheme(custom.mode))}
        >
          Surprise Me!
        </button>
        <button type="button" className="btn ghost" onClick={onReset}>
          Reset
        </button>
      </div>

      <button type="button" className="btn primary" onClick={onBack}>
        Back to Settings
      </button>
    </div>
  );
}

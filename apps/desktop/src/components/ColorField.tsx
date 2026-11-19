import { useCallback, useEffect, useRef, useState } from "react";
import { hexToHsv, hsvToHex, normalizeHex } from "../lib/theme";

type Props = {
  value: string;
  onChange: (hex: string) => void;
  label?: string;
};

/** Same saturation/value pad + hue + hex row used by the custom theme editor. */
export function ColorField({ value, onChange, label }: Props) {
  const padRef = useRef<HTMLDivElement>(null);
  const hsv = hexToHsv(value) || { h: 40, s: 0.7, v: 0.9 };
  const [hexDraft, setHexDraft] = useState(value);

  useEffect(() => {
    setHexDraft(value);
  }, [value]);

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
      onChange(hsvToHex(hsv.h, s, v));
    },
    [hsv.h, onChange],
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
  const safe = normalizeHex(value) || "#d4a017";

  return (
    <div className="color-field">
      {label ? <span className="color-field-label">{label}</span> : null}
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
          onChange(hsvToHex(Number(e.target.value), hsv.s, hsv.v))
        }
        aria-label={label ? `${label} hue` : "Hue"}
      />
      <div className="theme-hex-row">
        <span className="swatch" style={{ background: safe }} />
        <input
          type="text"
          value={hexDraft}
          maxLength={7}
          spellCheck={false}
          aria-label={label ? `${label} hex` : "Hex color"}
          onChange={(e) => {
            setHexDraft(e.target.value);
            const next = normalizeHex(e.target.value);
            if (next) onChange(next);
          }}
          onBlur={() => setHexDraft(safe)}
        />
        <input
          type="color"
          value={safe}
          aria-label={label ? `${label} picker` : "Pick color"}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </div>
  );
}

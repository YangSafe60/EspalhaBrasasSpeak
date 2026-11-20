import { useEffect, useState } from "react";
import logoMark from "../assets/logo-mark.png";
import { getElectronAPI } from "../lib/desktop";

/** Main window opened with the native title bar hidden (see main.mjs). */
export function hasCustomTitleBar(): boolean {
  if (typeof window === "undefined" || !getElectronAPI()) return false;
  return new URLSearchParams(window.location.search).get("titlebar") === "1";
}

/** Reads the theme's colours so the native window buttons match the bar. */
function readBarColors(): { color: string; symbolColor: string } {
  const css = getComputedStyle(document.documentElement);
  const color = css.getPropertyValue("--bg-0").trim() || "#050505";
  const symbolColor = css.getPropertyValue("--text").trim() || "#f4f4f4";
  return { color, symbolColor };
}

/**
 * Discord-style title strip: the app draws the top bar itself and the OS
 * minimise / maximise / close buttons sit inside it (Electron
 * titleBarOverlay), instead of a separate native title bar.
 */
export function TitleBar() {
  const enabled = hasCustomTitleBar();
  const [title, setTitle] = useState("Espalha Brasas");

  useEffect(() => {
    if (!enabled) return;
    document.documentElement.classList.add("has-titlebar");
    return () => document.documentElement.classList.remove("has-titlebar");
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    return getElectronAPI()?.onWindowTitle?.((next) => setTitle(next || "Espalha Brasas"));
  }, [enabled]);

  // Keep the native buttons' background/icon colours in step with the theme.
  useEffect(() => {
    if (!enabled) return;
    let last = "";
    let timer: number | null = null;
    const sync = () => {
      const colors = readBarColors();
      const key = `${colors.color}|${colors.symbolColor}`;
      if (key === last) return;
      last = key;
      void getElectronAPI()?.setTitleBarColors?.(colors);
    };
    sync();
    const observer = new MutationObserver(() => {
      if (timer != null) window.clearTimeout(timer);
      timer = window.setTimeout(sync, 50);
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style", "class", "data-theme"],
    });
    return () => {
      observer.disconnect();
      if (timer != null) window.clearTimeout(timer);
    };
  }, [enabled]);

  if (!enabled) return null;
  return (
    <header className="app-titlebar">
      <img className="app-titlebar-logo" src={logoMark} alt="" draggable={false} />
      <span className="app-titlebar-title">{title}</span>
    </header>
  );
}

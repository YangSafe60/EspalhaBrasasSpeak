import { useEffect } from "react";
import { getElectronAPI } from "../lib/desktop";
import { mediaUrl } from "../lib/mediaUrl";
import { sameId } from "../lib/serverPerms";
import { useAppStore } from "../store/appStore";

/** Main window opened with the native title bar hidden (see main.mjs). */
export function hasCustomTitleBar(): boolean {
  if (typeof window === "undefined" || !getElectronAPI()) return false;
  return new URLSearchParams(window.location.search).get("titlebar") === "1";
}

/** The bar's colour (theme-aware) so the native window buttons match it. */
function readBarColors(): { color: string; symbolColor: string } {
  const css = getComputedStyle(document.documentElement);
  const color = css.getPropertyValue("--titlebar-bg").trim() || "#081014";
  const symbolColor = css.getPropertyValue("--text").trim() || "#f4f4f4";
  return { color, symbolColor };
}

/**
 * Discord-style top bar: same colour as the server rail so it reads as part
 * of the app, the current server (or Direct Messages) centred, and the OS
 * minimise / maximise / close buttons inside it (Electron titleBarOverlay).
 */
export function TitleBar() {
  const enabled = hasCustomTitleBar();
  const user = useAppStore((s) => s.user);
  const friendsHome = useAppStore((s) => s.friendsHome);
  const server = useAppStore((s) =>
    s.activeServerId ? s.servers.find((sv) => sameId(sv.id, s.activeServerId)) : undefined,
  );

  useEffect(() => {
    if (!enabled) return;
    document.documentElement.classList.add("has-titlebar");
    return () => document.documentElement.classList.remove("has-titlebar");
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

  let label = "Espalha Brasas";
  let icon: string | null = null;
  let initial = "";
  if (user && friendsHome) {
    label = "Direct Messages";
  } else if (user && server) {
    label = server.name;
    icon = server.icon_url ? mediaUrl(server.icon_url) : null;
    initial = (server.name.trim().charAt(0) || "?").toUpperCase();
  }

  return (
    <header className="app-titlebar">
      <div className="app-titlebar-center" title={label}>
        {icon ? (
          <img className="app-titlebar-icon" src={icon} alt="" draggable={false} referrerPolicy="no-referrer" />
        ) : initial ? (
          <span className="app-titlebar-icon placeholder">{initial}</span>
        ) : null}
        <span className="app-titlebar-title">{label}</span>
      </div>
    </header>
  );
}

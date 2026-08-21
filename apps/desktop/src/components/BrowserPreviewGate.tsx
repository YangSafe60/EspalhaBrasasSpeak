import type { ReactNode } from "react";
import { isDesktopApp } from "../lib/desktop";
import logoFull from "../assets/logo-full.png";

/**
 * Vite serves the UI at localhost for Electron to load — opening that URL in
 * Chrome/Edge has no native APIs (desktopCapturer, pop-outs, etc.).
 */
export function BrowserPreviewGate({ children }: { children: ReactNode }) {
  if (isDesktopApp()) return <>{children}</>;

  return (
    <div className="browser-gate">
      <img className="brand-logo-full boot-logo" src={logoFull} alt="Espalha Brasas" />
      <h1>Desktop app only</h1>
      <p>
        This localhost tab is just the Vite preview. Screen share and other native
        features only work inside the <strong>Espalha Brasas</strong> window.
      </p>
      <ol>
        <li>Close this browser tab.</li>
        <li>
          From <code>apps/desktop</code> run:
          <pre>npm run desktop</pre>
        </li>
        <li>
          Use the native window titled <strong>Espalha Brasas</strong> (not
          localhost in Chrome).
        </li>
      </ol>
      <p className="muted tiny">
        Vite still runs in the background to feed that window — you can ignore any
        localhost URL it prints.
      </p>
    </div>
  );
}

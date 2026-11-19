import { useEffect } from "react";

let watchers = 0;

/** JPEG preview runs only while a lobby (or a screen popout) is on screen. */
export function useLobbyPreview(): void {
  useEffect(() => {
    watchers += 1;
    window.electronAPI?.setScreenPreviewActive?.(true);
    return () => {
      watchers = Math.max(0, watchers - 1);
      if (watchers === 0) {
        window.electronAPI?.setScreenPreviewActive?.(false);
      }
    };
  }, []);
}

import { invoke } from "@tauri-apps/api/core";

export type PopoutParams = {
  trackSid: string;
  title?: string;
};

function buildPopoutUrl(trackSid: string): string {
  const u = new URL(window.location.href);
  u.search = "";
  u.searchParams.set("popout", "1");
  u.searchParams.set("track", trackSid);
  return u.toString();
}

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Open a dedicated window for a remote screen-share track. */
export async function openScreenPopout(params: PopoutParams): Promise<void> {
  const url = buildPopoutUrl(params.trackSid);
  const title = params.title || `Screen · ${params.trackSid.slice(0, 8)}`;
  const label = `screen-${params.trackSid}`;

  if (isTauri()) {
    try {
      await invoke("open_screen_popout", {
        title,
        trackSid: params.trackSid,
        url,
      });
      return;
    } catch {
      try {
        const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
        const existing = await WebviewWindow.getByLabel(label);
        if (existing) {
          await existing.setFocus();
          return;
        }
        new WebviewWindow(label, {
          url,
          title,
          width: 960,
          height: 540,
          focus: false,
        });
        return;
      } catch {
        /* fall through to browser popup */
      }
    }
  }

  window.open(url, label, "popup=yes,width=960,height=540");
}

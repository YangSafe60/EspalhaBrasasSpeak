import { getElectronAPI, isDesktopApp } from "./desktop";

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

/** Open a dedicated window for a remote screen-share track. */
export async function openScreenPopout(params: PopoutParams): Promise<void> {
  const url = buildPopoutUrl(params.trackSid);
  const title = params.title || `Screen · ${params.trackSid.slice(0, 8)}`;
  const label = `screen-${params.trackSid}`;

  const electron = getElectronAPI();
  if (electron) {
    await electron.openPopout({
      title,
      trackSid: params.trackSid,
      url,
    });
    return;
  }

  if (!isDesktopApp()) {
    window.open(url, label, "popup=yes,width=960,height=540");
  }
}

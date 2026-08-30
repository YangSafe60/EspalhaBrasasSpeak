import { useEffect } from "react";
import { getElectronAPI } from "../lib/desktop";
import { useAppStore } from "../store/appStore";

const DEFAULT_TITLE = "Espalha Brasas";

/** While connected to voice, rename the desktop process/window to "channel | server". */
export function useVoiceWindowTitle(enabled: boolean) {
  const voiceChannelId = useAppStore((s) => s.voiceChannelId);
  const channelsByServer = useAppStore((s) => s.channelsByServer);
  const servers = useAppStore((s) => s.servers);

  useEffect(() => {
    if (!enabled) return;
    const desktop = getElectronAPI();
    if (!desktop?.setWindowTitle) return;

    if (!voiceChannelId) {
      void desktop.setWindowTitle(DEFAULT_TITLE);
      return;
    }

    const channel = Object.values(channelsByServer)
      .flat()
      .find((c) => c.id === voiceChannelId);
    const server = channel
      ? servers.find((s) => s.id === channel.server_id)
      : undefined;

    const title =
      channel && server
        ? `${channel.name} | ${server.name}`
        : channel?.name || DEFAULT_TITLE;

    void desktop.setWindowTitle(title);
  }, [enabled, voiceChannelId, channelsByServer, servers]);
}

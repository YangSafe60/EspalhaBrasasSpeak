import { useEffect } from "react";
import { AuthScreen } from "./components/AuthScreen";
import { BrowserPreviewGate } from "./components/BrowserPreviewGate";
import { ChannelSidebar } from "./components/ChannelSidebar";
import { ChannelSettingsModal } from "./components/ChannelSettingsModal";
import { CreateServerModal } from "./components/CreateServerModal";
import { JoinInviteModal } from "./components/JoinInviteModal";
import { MessageView } from "./components/MessageView";
import { ScreenPopoutApp } from "./components/ScreenPopoutApp";
import { ServerRail } from "./components/ServerRail";
import { ServerSettingsModal } from "./components/ServerSettingsModal";
import { UserSettingsModal } from "./components/UserSettingsModal";
import { VoiceLobbyView } from "./components/VoiceLobbyView";
import { VoicePanel } from "./components/VoicePanel";
import { useVoice } from "./hooks/useVoice";
import { useWebSocket } from "./hooks/useWebSocket";
import { useAppStore } from "./store/appStore";
import logoFull from "./assets/logo-full.png";

function isPopout(): boolean {
  const q = new URLSearchParams(window.location.search);
  return q.get("popout") === "1";
}

function MainColumn({ voice }: { voice: ReturnType<typeof useVoice> }) {
  const activeChannelId = useAppStore((s) => s.activeChannelId);
  const channelsByServer = useAppStore((s) => s.channelsByServer);
  const channel = Object.values(channelsByServer)
    .flat()
    .find((c) => c.id === activeChannelId);

  return (
    <div className="main-column">
      {channel?.channel_type === "voice" ? (
        <VoiceLobbyView voice={voice} />
      ) : (
        <MessageView />
      )}
    </div>
  );
}

function MainApp() {
  const user = useAppStore((s) => s.user);
  const bootstrapped = useAppStore((s) => s.bootstrapped);
  const bootstrap = useAppStore((s) => s.bootstrap);
  const selectChannel = useAppStore((s) => s.selectChannel);
  const voiceChannelId = useAppStore((s) => s.voiceChannelId);
  const voice = useVoice();

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useWebSocket(!!user);

  if (!bootstrapped) {
    return (
      <div className="boot-screen">
        <img className="brand-logo-full boot-logo" src={logoFull} alt="Espalha Brasas" />
        <p className="muted">Warming up…</p>
      </div>
    );
  }

  if (!user) return <AuthScreen />;

  return (
    <div className="app-shell">
      <ServerRail />
      <div className="sidebar-column">
        <ChannelSidebar
          speakingIds={voice.speakingIds}
          onJoinVoice={(id) => {
            if (voiceChannelId === id) {
              void selectChannel(id);
              return;
            }
            void voice.join(id).then(() => {
              void selectChannel(id);
            });
          }}
        />
        <VoicePanel voice={voice} />
      </div>
      <MainColumn voice={voice} />
      <CreateServerModal />
      <JoinInviteModal />
      <ServerSettingsModal />
      <ChannelSettingsModal />
      <UserSettingsModal />
    </div>
  );
}

export default function App() {
  if (isPopout()) return <ScreenPopoutApp />;
  return (
    <BrowserPreviewGate>
      <MainApp />
    </BrowserPreviewGate>
  );
}

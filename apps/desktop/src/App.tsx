import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { BrowserPreviewGate } from "./components/BrowserPreviewGate";
import { ChannelSidebar } from "./components/ChannelSidebar";
import { DmMessageView } from "./components/DmMessageView";
import { FriendsSidebar } from "./components/FriendsSidebar";
import { MemberList } from "./components/MemberList";
import { MessageView } from "./components/MessageView";
import {
  MicConsentModal,
  markMicIntroDone,
  micIntroDone,
} from "./components/MicConsentModal";
import { ServerRail } from "./components/ServerRail";
import { UpdateOverlay } from "./components/UpdateOverlay";
import { VoiceLobbyView } from "./components/VoiceLobbyView";
import { VoicePanel } from "./components/VoicePanel";
import { useVoice } from "./hooks/useVoice";
import { useWebSocket } from "./hooks/useWebSocket";
import { useAppStore } from "./store/appStore";
import logoFull from "./assets/logo-full.png";

const AuthScreen = lazy(() =>
  import("./components/AuthScreen").then((m) => ({ default: m.AuthScreen })),
);
const ScreenPopoutApp = lazy(() =>
  import("./components/ScreenPopoutApp").then((m) => ({
    default: m.ScreenPopoutApp,
  })),
);
const CreateServerModal = lazy(() =>
  import("./components/CreateServerModal").then((m) => ({
    default: m.CreateServerModal,
  })),
);
const JoinInviteModal = lazy(() =>
  import("./components/JoinInviteModal").then((m) => ({
    default: m.JoinInviteModal,
  })),
);
const ServerSettingsModal = lazy(() =>
  import("./components/ServerSettingsModal").then((m) => ({
    default: m.ServerSettingsModal,
  })),
);
const ChannelSettingsModal = lazy(() =>
  import("./components/ChannelSettingsModal").then((m) => ({
    default: m.ChannelSettingsModal,
  })),
);
const UserSettingsModal = lazy(() =>
  import("./components/UserSettingsModal").then((m) => ({
    default: m.UserSettingsModal,
  })),
);

function BootFallback({ label = "Warming up…" }: { label?: string }) {
  return (
    <div className="boot-screen">
      <img className="brand-logo-full boot-logo" src={logoFull} alt="Espalha Brasas" />
      <p className="muted">{label}</p>
    </div>
  );
}

function SoftSuspense({ children }: { children: ReactNode }) {
  return <Suspense fallback={null}>{children}</Suspense>;
}

function isPopout(): boolean {
  const q = new URLSearchParams(window.location.search);
  return q.get("popout") === "1";
}

function MainColumn({ voice }: { voice: ReturnType<typeof useVoice> }) {
  const friendsHome = useAppStore((s) => s.friendsHome);
  const activeChannelId = useAppStore((s) => s.activeChannelId);
  const channelsByServer = useAppStore((s) => s.channelsByServer);
  const channel = Object.values(channelsByServer)
    .flat()
    .find((c) => c.id === activeChannelId);

  if (friendsHome) {
    return (
      <div className="main-column">
        <DmMessageView />
      </div>
    );
  }

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
  const friendsHome = useAppStore((s) => s.friendsHome);
  const bootstrap = useAppStore((s) => s.bootstrap);
  const selectChannel = useAppStore((s) => s.selectChannel);
  const voiceChannelId = useAppStore((s) => s.voiceChannelId);
  const voice = useVoice();
  const [pendingVoiceId, setPendingVoiceId] = useState<string | null>(null);
  const [micBusy, setMicBusy] = useState(false);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useWebSocket(!!user);

  async function joinVoice(channelId: string) {
    setMicBusy(true);
    try {
      await voice.join(channelId);
      markMicIntroDone();
      void selectChannel(channelId);
    } finally {
      setMicBusy(false);
      setPendingVoiceId(null);
    }
  }

  function onJoinVoice(id: string) {
    if (voiceChannelId === id) {
      void selectChannel(id);
      return;
    }
    if (!micIntroDone()) {
      setPendingVoiceId(id);
      return;
    }
    void joinVoice(id);
  }

  if (!bootstrapped) {
    return <BootFallback />;
  }

  if (!user) {
    return (
      <Suspense fallback={<BootFallback label="Loading…" />}>
        <AuthScreen />
      </Suspense>
    );
  }

  return (
    <div className="app-root">
      <div className={`app-shell${friendsHome ? " friends-layout" : ""}`}>
        <ServerRail />
        <div className="sidebar-column">
          {friendsHome ? (
            <FriendsSidebar />
          ) : (
            <ChannelSidebar
              speakingIds={voice.speakingIds}
              onJoinVoice={onJoinVoice}
              voiceHandlers={{
                applyUserMic: voice.applyUserMic,
                applyUserVideoHide: voice.applyUserVideoHide,
              }}
            />
          )}
          <VoicePanel voice={voice} />
        </div>
        <MainColumn voice={voice} />
        {!friendsHome && (
          <MemberList
            voice={{
              applyUserMic: voice.applyUserMic,
              applyUserVideoHide: voice.applyUserVideoHide,
            }}
          />
        )}
      </div>
      <div className="app-overlays">
        <SoftSuspense>
          <CreateServerModal />
          <JoinInviteModal />
          <ServerSettingsModal />
          <ChannelSettingsModal />
          <UserSettingsModal />
        </SoftSuspense>
        <MicConsentModal
          open={pendingVoiceId != null}
          busy={micBusy}
          onCancel={() => setPendingVoiceId(null)}
          onContinue={() => {
            if (pendingVoiceId) void joinVoice(pendingVoiceId);
          }}
        />
      </div>
    </div>
  );
}

export default function App() {
  if (isPopout()) {
    return (
      <Suspense fallback={<BootFallback label="Opening stream…" />}>
        <ScreenPopoutApp />
      </Suspense>
    );
  }
  return (
    <BrowserPreviewGate>
      <MainApp />
      <UpdateOverlay />
    </BrowserPreviewGate>
  );
}

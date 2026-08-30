import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { BrowserPreviewGate } from "./components/BrowserPreviewGate";
import { ChannelSidebar } from "./components/ChannelSidebar";
import { DmMessageView } from "./components/DmMessageView";
import { FriendsHomeView, type FriendsTab } from "./components/FriendsHomeView";
import { FriendsSidebar } from "./components/FriendsSidebar";
import { MemberList } from "./components/MemberList";
import { MessageView } from "./components/MessageView";
import { MessageToastStack } from "./components/MessageToastStack";
import { MiniProfileCard } from "./components/MiniProfileCard";
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
import { useVoiceWindowTitle } from "./hooks/useVoiceWindowTitle";
import { useAutoIdlePresence } from "./hooks/useAutoIdlePresence";
import { useWebSocket } from "./hooks/useWebSocket";
import { applyTheme, loadTheme } from "./lib/theme";
import { sameId } from "./lib/serverPerms";
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
const InvitePeopleModal = lazy(() =>
  import("./components/InvitePeopleModal").then((m) => ({
    default: m.InvitePeopleModal,
  })),
);
const ServerInviteReceivedModal = lazy(() =>
  import("./components/ServerInviteReceivedModal").then((m) => ({
    default: m.ServerInviteReceivedModal,
  })),
);
const ChannelInviteReceivedModal = lazy(() =>
  import("./components/ChannelInviteReceivedModal").then((m) => ({
    default: m.ChannelInviteReceivedModal,
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

function MainColumn({
  voice,
  friendsTab,
  onFriendsTabChange,
}: {
  voice: ReturnType<typeof useVoice>;
  friendsTab: FriendsTab;
  onFriendsTabChange: (tab: FriendsTab) => void;
}) {
  const friendsHome = useAppStore((s) => s.friendsHome);
  const activeDmId = useAppStore((s) => s.activeDmId);
  const activeChannelId = useAppStore((s) => s.activeChannelId);
  const channelsByServer = useAppStore((s) => s.channelsByServer);
  const channel = Object.values(channelsByServer)
    .flat()
    .find((c) => c.id === activeChannelId);

  if (friendsHome) {
    return (
      <div className="main-column">
        {activeDmId ? (
          <DmMessageView />
        ) : (
          <FriendsHomeView tab={friendsTab} onTabChange={onFriendsTabChange} />
        )}
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
  const activeServerId = useAppStore((s) => s.activeServerId);
  const servers = useAppStore((s) => s.servers);
  const bootstrap = useAppStore((s) => s.bootstrap);
  const selectChannel = useAppStore((s) => s.selectChannel);
  const voiceChannelId = useAppStore((s) => s.voiceChannelId);
  const pendingVoiceJoinChannelId = useAppStore(
    (s) => s.pendingVoiceJoinChannelId,
  );
  const pendingDmCallJoinId = useAppStore((s) => s.pendingDmCallJoinId);
  const clearPendingVoiceJoin = useAppStore((s) => s.clearPendingVoiceJoin);
  const clearPendingDmCallJoin = useAppStore((s) => s.clearPendingDmCallJoin);
  const dmCallId = useAppStore((s) => s.dmCallId);
  const voice = useVoice();
  useVoiceWindowTitle(!!user);
  const [pendingVoiceId, setPendingVoiceId] = useState<string | null>(null);
  const [pendingDmCallId, setPendingDmCallId] = useState<string | null>(null);
  const [micBusy, setMicBusy] = useState(false);
  const [friendsTab, setFriendsTab] = useState<FriendsTab>("online");
  const activeDmId = useAppStore((s) => s.activeDmId);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    const server = servers.find((s) => sameId(s.id, activeServerId));
    applyTheme(loadTheme(), {
      serverAccent: server?.accent_color ?? null,
      friendsHome,
    });
  }, [activeServerId, friendsHome, servers]);

  useWebSocket(!!user);
  useAutoIdlePresence(!!user);

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

  async function joinDmCall(id: string) {
    setMicBusy(true);
    try {
      await voice.joinDm(id);
      markMicIntroDone();
    } finally {
      setMicBusy(false);
      setPendingDmCallId(null);
    }
  }

  function onJoinDmCall(id: string) {
    if (sameId(dmCallId, id)) return;
    if (!micIntroDone()) {
      setPendingDmCallId(id);
      return;
    }
    void joinDmCall(id);
  }

  useEffect(() => {
    if (!pendingVoiceJoinChannelId) return;
    const channelId = pendingVoiceJoinChannelId;
    clearPendingVoiceJoin();
    onJoinVoice(channelId);
  }, [pendingVoiceJoinChannelId, clearPendingVoiceJoin, voiceChannelId]);

  useEffect(() => {
    if (!pendingDmCallJoinId) return;
    const dmId = pendingDmCallJoinId;
    clearPendingDmCallJoin();
    onJoinDmCall(dmId);
  }, [pendingDmCallJoinId, clearPendingDmCallJoin, dmCallId]);

  function onOpenFriends(tab: FriendsTab = "online") {
    setFriendsTab(tab);
    useAppStore.setState({ activeDmId: null, friendsHome: true });
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
            <FriendsSidebar
              friendsViewActive={!activeDmId}
              onOpenFriends={onOpenFriends}
            />
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
        <MainColumn
          voice={voice}
          friendsTab={friendsTab}
          onFriendsTabChange={setFriendsTab}
        />
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
          <InvitePeopleModal />
          <ServerInviteReceivedModal />
          <ChannelInviteReceivedModal />
          <ServerSettingsModal />
          <ChannelSettingsModal />
          <UserSettingsModal />
        </SoftSuspense>
        <MiniProfileCard />
        <MicConsentModal
          open={pendingVoiceId != null || pendingDmCallId != null}
          busy={micBusy}
          onCancel={() => {
            setPendingVoiceId(null);
            setPendingDmCallId(null);
          }}
          onContinue={() => {
            if (pendingVoiceId) void joinVoice(pendingVoiceId);
            else if (pendingDmCallId) void joinDmCall(pendingDmCallId);
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
    <>
      <BrowserPreviewGate>
        <MainApp />
      </BrowserPreviewGate>
      <MessageToastStack />
      <UpdateOverlay />
    </>
  );
}

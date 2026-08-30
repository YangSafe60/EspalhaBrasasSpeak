import { loadChannelMutes } from "../lib/channelMutePrefs";

export function createInitialState() {
  return {
    user: null,
    servers: [],
    channelsByServer: {},
    membersByServer: {},
    rolesByServer: {},
    rulesByServer: {},
    overwritesByChannel: {},
    messagesByChannel: {},
    authors: {},
    customEmojis: [],
    customEmojisById: {},
    voiceStates: [],
    typing: {},
    presenceByUser: {},
    myStatus: "online" as const,
    myStatusRevision: 0,

    friendsHome: false,
    friends: [],
    pendingInbound: [],
    pendingOutbound: [],
    dmChannels: [],
    messagesByDm: {},
    activeDmId: null,
    identityPublicKey: null,
    e2eIdentityMissing: false,
    peerPublicKeys: {},
    dmFingerprints: {},

    activeServerId: null,
    activeChannelId: null,
    voiceChannelId: null,
    dmCallId: null as string | null,
    dmCallByChannel: {} as Record<string, import("../types").DmCallParticipant[]>,
    muted: false,
    deafened: false,
    streaming: false,

    modal: null,
    settingsChannelId: null,
    inviteChannelId: null,
    miniProfile: null,
    pendingComposerInsert: null as {
      channelId: string;
      text: string;
    } | null,
    pendingVoiceJoinChannelId: null as string | null,
    pendingDmCallJoinId: null as string | null,
    pendingServerInvite: null,
    pendingChannelInvite: null,
    channelMutes: loadChannelMutes(),
    unreadByChannel: {},
    messageToasts: [],
    bootstrapped: false,
    connecting: false,
    error: null,
  };
}

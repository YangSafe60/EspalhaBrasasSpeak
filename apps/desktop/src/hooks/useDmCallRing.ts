import { useEffect } from "react";
import { sameId } from "../lib/serverPerms";
import {
  startDmCallIncomingRing,
  startDmCallOutgoingRing,
  stopDmCallRing,
} from "../lib/voiceSounds";
import { useAppStore } from "../store/appStore";
import type { useVoice } from "./useVoice";

/** Play ringing while a private call is waiting to be answered. */
export function useDmCallRing(voice: ReturnType<typeof useVoice>) {
  const user = useAppStore((s) => s.user);
  const dmCallId = useAppStore((s) => s.dmCallId);
  const dmCallByChannel = useAppStore((s) => s.dmCallByChannel);
  const dmChannels = useAppStore((s) => s.dmChannels);

  useEffect(() => {
    if (!user) {
      stopDmCallRing();
      return;
    }

    const inOurDmCall =
      dmCallId &&
      voice.dmCallId &&
      sameId(voice.dmCallId, dmCallId) &&
      (voice.connected || voice.joining);

    if (inOurDmCall) {
      const participants = dmCallByChannel[dmCallId] || [];
      const peerJoined = participants.some(
        (p) => !sameId(p.user_id, user.id),
      );
      if (!peerJoined) {
        startDmCallOutgoingRing();
        return () => stopDmCallRing();
      }
      stopDmCallRing();
      return;
    }

    const incomingCall = dmChannels.find((dm) => {
      if (dmCallId && sameId(dm.id, dmCallId)) return false;
      const participants = dmCallByChannel[dm.id] || [];
      return participants.some((p) => sameId(p.user_id, dm.peer.id));
    });

    if (incomingCall) {
      startDmCallIncomingRing();
      return () => stopDmCallRing();
    }

    stopDmCallRing();
  }, [
    dmCallByChannel,
    dmCallId,
    dmChannels,
    user,
    voice.connected,
    voice.dmCallId,
    voice.joining,
  ]);
}

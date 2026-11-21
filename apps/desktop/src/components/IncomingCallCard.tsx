import { useEffect, useRef } from "react";
import { findIncomingDmCall } from "../hooks/useDmCallRing";
import { showDesktopNotification } from "../lib/desktopNotify";
import { mediaCssUrl } from "../lib/mediaUrl";
import { useAppStore } from "../store/appStore";

/**
 * Discord-style incoming call popup: who is calling, with Join and Decline.
 * Shown while the other person is in a DM call we're not in. When the app is
 * in the background it also raises a desktop notification. The ringing sound
 * is handled by useDmCallRing; declining stops it until that call ends.
 */
export function IncomingCallCard() {
  const dmChannels = useAppStore((s) => s.dmChannels);
  const dmCallByChannel = useAppStore((s) => s.dmCallByChannel);
  const dmCallId = useAppStore((s) => s.dmCallId);
  const declinedDmCalls = useAppStore((s) => s.declinedDmCalls);
  const selectDm = useAppStore((s) => s.selectDm);
  const requestDmCallJoin = useAppStore((s) => s.requestDmCallJoin);
  const declineDmCall = useAppStore((s) => s.declineDmCall);

  const call = findIncomingDmCall(dmChannels, dmCallByChannel, dmCallId, declinedDmCalls);
  const notifiedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!call) {
      notifiedFor.current = null;
      return;
    }
    if (notifiedFor.current === call.id) return;
    notifiedFor.current = call.id;
    const name = call.peer.display_name || call.peer.username;
    showDesktopNotification({
      toast: {
        kind: "dm",
        authorName: name,
        authorAvatar: call.peer.avatar_url,
        preview: "is calling you",
      },
      context: "Incoming call",
      tag: `dm-call-${call.id}`,
      onClick: () => void selectDm(call.id),
    });
  }, [call, selectDm]);

  if (!call) return null;
  const name = call.peer.display_name || call.peer.username;
  const avatar = call.peer.avatar_url;

  return (
    <div className="incoming-call-card" role="alertdialog" aria-label={`Incoming call from ${name}`}>
      <div
        className="incoming-call-avatar"
        style={avatar ? { backgroundImage: mediaCssUrl(avatar) } : undefined}
      >
        {!avatar && (name.charAt(0) || "?").toUpperCase()}
      </div>
      <div className="incoming-call-text">
        <strong>{name}</strong>
        <span>Incoming call…</span>
      </div>
      <div className="incoming-call-actions">
        <button
          type="button"
          className="incoming-call-btn decline"
          title="Decline"
          aria-label="Decline"
          onClick={() => declineDmCall(call.id)}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden fill="currentColor">
            <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.996.996 0 0 1 0-1.41C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.74-1.69-1.36-2.67-1.85a.996.996 0 0 1-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z" />
          </svg>
        </button>
        <button
          type="button"
          className="incoming-call-btn accept"
          title="Join call"
          aria-label="Join call"
          onClick={() => {
            void selectDm(call.id);
            requestDmCallJoin(call.id);
          }}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden fill="currentColor">
            <path d="M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1.01-.24c1.12.37 2.33.57 3.58.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1C10.85 21 3 13.15 3 3a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.46.57 3.58a1 1 0 0 1-.24 1.01l-2.2 2.2z" />
          </svg>
        </button>
      </div>
    </div>
  );
}

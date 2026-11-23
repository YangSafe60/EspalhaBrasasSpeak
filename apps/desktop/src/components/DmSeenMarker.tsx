import { useEffect, useState } from "react";
import { dmReads, readReceiptsOn } from "../lib/dmReads";
import { useMini } from "../lib/miniStore";
import type { DmMessage } from "../types";

/**
 * "Seen · 19:04" under my last message in a 1:1 DM, once the other person
 * has read it. Hidden when I turned read receipts off (it works both ways).
 */
export function DmSeenMarker({
  dmId,
  peerId,
  messages,
  myId,
}: {
  dmId: string;
  peerId: string;
  messages: DmMessage[];
  myId: string | undefined;
}) {
  const read = useMini(dmReads, (all) => all[dmId]?.[peerId]);
  const [on, setOn] = useState(readReceiptsOn);

  useEffect(() => {
    const sync = () => setOn(readReceiptsOn());
    window.addEventListener("read-receipts-changed", sync);
    return () => window.removeEventListener("read-receipts-changed", sync);
  }, []);

  const last = messages[messages.length - 1];
  if (!on || !read || !last || !myId || last.author_id !== myId) return null;
  // They read this one, or something after it was sent.
  const readMsg = messages.find((m) => m.id === read.message_id);
  const t = (iso: string) => new Date(iso).getTime();
  const seen = readMsg ? t(readMsg.created_at) >= t(last.created_at) : t(read.read_at) >= t(last.created_at);
  if (!seen) return null;
  const at = new Date(read.read_at);
  return (
    <div className="dm-seen" title={`Seen ${at.toLocaleString()}`}>
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M2 12.5l4.5 4.5L15 8.5M10.5 15.5l1.5 1.5L22 7" />
      </svg>
      Seen {at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
    </div>
  );
}

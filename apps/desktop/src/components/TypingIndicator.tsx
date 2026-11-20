import { useEffect, useState } from "react";
import { useAppStore } from "../store/appStore";

/**
 * "X is typing…" for one channel or DM. Subscribes only to that channel's
 * typing list, so typing events elsewhere don't re-render anything, and it
 * re-renders itself when an entry expires.
 */
export function TypingIndicator({ channelId }: { channelId: string }) {
  const entries = useAppStore((s) => s.typing[channelId]);
  const myUsername = useAppStore((s) => s.user?.username);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const now = Date.now();
    const upcoming = (entries || []).map((t) => t.expires).filter((e) => e > now);
    if (upcoming.length === 0) return;
    const wait = Math.min(...upcoming) - now + 50;
    const timer = window.setTimeout(() => setTick((t) => t + 1), wait);
    return () => window.clearTimeout(timer);
  }, [entries, tick]);

  const now = Date.now();
  const typers = (entries || [])
    .filter((t) => t.expires > now && t.username !== myUsername)
    .map((t) => t.username);
  if (typers.length === 0) return null;
  return (
    <p className="typing-indicator">
      {typers.join(", ")} {typers.length === 1 ? "is" : "are"} typing…
    </p>
  );
}

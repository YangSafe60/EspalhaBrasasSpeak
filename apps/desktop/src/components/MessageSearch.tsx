import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "../api/client";
import { useAppStore } from "../store/appStore";
import type { Message } from "../types";

function highlight(text: string, query: string) {
  const words = query
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean)
    .map((w) => w.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase());
  if (!words.length) return text;
  // Match on an accent-free copy, render the original characters.
  const plain = text.normalize("NFD").replace(/\p{M}/gu, "");
  if (plain.length !== text.length) return text;
  const lower = plain.toLowerCase();
  const marks: [number, number][] = [];
  for (const w of words) {
    let from = 0;
    while (from < lower.length) {
      const i = lower.indexOf(w, from);
      if (i < 0) break;
      marks.push([i, i + w.length]);
      from = i + w.length;
    }
  }
  if (!marks.length) return text;
  marks.sort((a, b) => a[0] - b[0]);
  const out: ReactNode[] = [];
  let at = 0;
  marks.forEach(([s, e], k) => {
    if (s < at) return;
    out.push(text.slice(at, s));
    out.push(<mark key={k}>{text.slice(s, e)}</mark>);
    at = e;
  });
  out.push(text.slice(at));
  return out;
}

/** Search box in the channel header: messages across the server's channels. */
export function MessageSearch({
  serverId,
  onJump,
}: {
  serverId: string;
  onJump: (messageId: string) => void;
}) {
  const authors = useAppStore((s) => s.authors);
  const members = useAppStore((s) => s.membersByServer[serverId]);
  const channels = useAppStore((s) => s.channelsByServer[serverId]);
  const selectChannel = useAppStore((s) => s.selectChannel);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Message[] | null>(null);
  const [searched, setSearched] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const open = results !== null || busy || error !== null;

  useEffect(() => {
    setResults(null);
    setError(null);
  }, [serverId]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setResults(null);
        setError(null);
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  async function run() {
    const q = query.trim();
    if (!q) {
      setResults(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ messages: Message[] }>(`/api/servers/${serverId}/search`, {
        query: { q },
      });
      setResults(res.messages);
      setSearched(q);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
      setResults(null);
    } finally {
      setBusy(false);
    }
  }

  const nameOf = (userId: string) =>
    members?.find((m) => m.user.id === userId)?.user.display_name ||
    authors[userId]?.display_name ||
    "Unknown";
  const channelName = (id: string) => channels?.find((c) => c.id === id)?.name || "channel";

  return (
    <div className="message-search" ref={rootRef}>
      <input
        type="search"
        placeholder="Search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void run();
          if (e.key === "Escape") {
            setQuery("");
            setResults(null);
            setError(null);
          }
        }}
        aria-label="Search messages in this server"
        maxLength={200}
      />
      {open && (
        <div className="search-panel" role="dialog" aria-label="Search results">
          {busy && <p className="muted tiny">Searching…</p>}
          {error && <p className="form-error tiny">{error}</p>}
          {results && !busy && (
            <>
              <p className="muted tiny search-count">
                {results.length === 0
                  ? `No results for “${searched}”`
                  : `${results.length}${results.length >= 25 ? "+" : ""} result${results.length === 1 ? "" : "s"}`}
              </p>
              <ul className="pins-list">
                {results.map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      className="pins-item"
                      onClick={() => {
                        setResults(null);
                        void selectChannel(m.channel_id).then(() =>
                          // give the channel a moment to render, then jump
                          window.setTimeout(() => onJump(m.id), 300),
                        );
                      }}
                    >
                      <span className="search-meta">
                        <strong>{nameOf(m.author_id)}</strong>
                        <span className="muted tiny">
                          #{channelName(m.channel_id)} · {new Date(m.created_at).toLocaleDateString()}
                        </span>
                      </span>
                      <span className="pins-text">{highlight(m.content, searched)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}

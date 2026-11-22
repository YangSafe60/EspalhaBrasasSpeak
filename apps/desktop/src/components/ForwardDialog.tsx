import { useMemo, useState } from "react";
import { dmTitle } from "../lib/dmDisplay";
import { useAppStore } from "../store/appStore";
import type { Attachment } from "../types";

type Target = { kind: "channel" | "dm"; id: string; label: string; sub: string };

/** Pick where to send a copy of a message: a text channel or a DM. */
export function ForwardDialog({
  source,
  onClose,
}: {
  source: { content: string; attachments: Attachment[] };
  onClose: () => void;
}) {
  const servers = useAppStore((s) => s.servers);
  const channelsByServer = useAppStore((s) => s.channelsByServer);
  const dmChannels = useAppStore((s) => s.dmChannels);
  const me = useAppStore((s) => s.user);
  const forwardMessage = useAppStore((s) => s.forwardMessage);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [sent, setSent] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);

  const targets = useMemo(() => {
    const out: Target[] = [];
    for (const dm of dmChannels) out.push({ kind: "dm", id: dm.id, label: dmTitle(dm, me?.id), sub: dm.is_group ? "Group DM" : "Direct message" });
    for (const server of servers) {
      for (const c of channelsByServer[server.id] || []) {
        if (c.channel_type !== "text" || c.parent_channel_id) continue;
        out.push({ kind: "channel", id: c.id, label: `#${c.name}`, sub: server.name });
      }
    }
    const q = query.trim().toLowerCase();
    return q ? out.filter((t) => t.label.toLowerCase().includes(q) || t.sub.toLowerCase().includes(q)) : out;
  }, [dmChannels, servers, channelsByServer, me?.id, query]);

  async function send(t: Target) {
    setBusy(t.id);
    setError(null);
    try {
      await forwardMessage(source, { kind: t.kind, id: t.id });
      setSent((prev) => new Set(prev).add(t.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't forward");
    } finally {
      setBusy(null);
    }
  }

  const preview = source.content.trim() || (source.attachments.length ? `${source.attachments.length} file(s)` : "");

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal group-dm-picker" role="dialog" aria-label="Forward message" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h3>Forward to</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        {preview && <p className="forward-preview">{preview.length > 160 ? `${preview.slice(0, 160)}…` : preview}</p>}
        <input type="search" placeholder="Search channels and DMs" value={query} autoFocus onChange={(e) => setQuery(e.target.value)} />
        <ul className="group-dm-list">
          {targets.length === 0 && <li className="muted tiny group-dm-empty">Nothing matches.</li>}
          {targets.map((t) => (
            <li key={`${t.kind}:${t.id}`}>
              <div className="group-dm-row">
                <span className="group-dm-who">
                  <strong>{t.label}</strong>
                  <span className="muted">{t.sub}</span>
                </span>
                <button
                  type="button"
                  className="btn sm"
                  disabled={busy !== null || sent.has(t.id)}
                  onClick={() => void send(t)}
                >
                  {sent.has(t.id) ? "Sent" : busy === t.id ? "Sending…" : "Send"}
                </button>
              </div>
            </li>
          ))}
        </ul>
        {error && <p className="form-error tiny">{error}</p>}
      </div>
    </div>
  );
}

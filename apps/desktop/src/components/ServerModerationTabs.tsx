import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useAppStore } from "../store/appStore";
import type { AuditEntry } from "../types";

/** Server settings > Word filter: messages with these words are refused. */
export function WordFilterTab({ serverId }: { serverId: string }) {
  const [text, setText] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api<{ words: string[] }>(`/api/servers/${serverId}/automod`)
      .then((r) => alive && setText(r.words.join("\n")))
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Couldn't load"));
    return () => {
      alive = false;
    };
  }, [serverId]);

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const words = text.split(/[\n,]/).map((w) => w.trim()).filter(Boolean);
      const r = await api<{ words: string[] }>(`/api/servers/${serverId}/automod`, {
        method: "PUT",
        body: { words },
      });
      setText(r.words.join("\n"));
      setSaved(r.words.length ? `${r.words.length} word${r.words.length === 1 ? "" : "s"} blocked.` : "Word filter is off.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack word-filter">
      <p className="muted">
        Messages with any of these words or phrases are refused (whole words, any case). Moderators
        aren't affected. One per line, up to 200.
      </p>
      <textarea
        className="word-filter-input"
        rows={10}
        value={text}
        placeholder={"word\nanother phrase"}
        onChange={(e) => setText(e.target.value)}
      />
      {error && <p className="form-error">{error}</p>}
      {saved && <p className="form-hint">{saved}</p>}
      <div>
        <button type="button" className="btn primary" disabled={busy} onClick={() => void save()}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

const ACTION_TEXT: Record<string, string> = {
  server_update: "updated the server settings",
  ownership_transfer: "transferred ownership",
  member_kick: "kicked",
  member_voice: "changed voice mute/deafen of",
  member_timeout: "changed the timeout of",
  member_roles: "changed the roles of",
  member_ban: "banned",
  member_unban: "unbanned",
  invite_delete: "deleted an invite",
  role_create: "created a role",
  role_update: "updated a role",
  role_delete: "deleted a role",
  rules_update: "updated the rules",
  automod_update: "updated the word filter",
  channel_create: "created a channel",
  channel_update: "updated a channel",
  channel_delete: "deleted a channel",
  channel_duplicate: "duplicated a channel",
  channel_permissions: "changed channel permissions",
  message_delete: "deleted a message by",
  message_pin: "pinned a message by",
  message_unpin: "unpinned a message by",
};

function detailText(e: AuditEntry): string {
  const d = (e.details || {}) as Record<string, unknown>;
  const name = typeof d.name === "string" ? d.name : null;
  const channel = typeof d.channel === "string" ? d.channel : null;
  if (e.action.startsWith("channel_") && name) return `#${name}`;
  if (e.action.startsWith("role_") && name) return name;
  if (e.action.startsWith("message_") && channel) return `in #${channel}`;
  if (e.action === "member_ban" && typeof d.reason === "string" && d.reason) return `Reason: ${d.reason}`;
  return "";
}

/** Server settings > Audit log: newest moderation actions first. */
export function AuditLogTab({ serverId }: { serverId: string }) {
  const members = useAppStore((s) => s.membersByServer[serverId]);
  const authors = useAppStore((s) => s.authors);
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(before?: string) {
    setLoading(true);
    setError(null);
    try {
      const page = await api<AuditEntry[]>(`/api/servers/${serverId}/audit-log`, {
        query: { limit: 50, before },
      });
      setEntries((prev) => (before ? [...prev, ...page] : page));
      setMore(page.length === 50);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load the audit log");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId]);

  const nameOf = (id: string | null) => {
    if (!id) return "";
    const m = members?.find((x) => x.user.id === id);
    return m?.nickname || m?.user.display_name || authors[id]?.display_name || "a former member";
  };
  const isUserTarget = (a: string) => a.startsWith("member_") || a.startsWith("message_") || a === "ownership_transfer";

  return (
    <div className="audit-log">
      {error && <p className="form-error">{error}</p>}
      {!loading && entries.length === 0 && !error && <p className="muted">Nothing here yet. Moderation actions show up here.</p>}
      <ul className="audit-list">
        {entries.map((e) => (
          <li key={e.id} className="audit-row">
            <span className="audit-who">{e.actor?.display_name || "Someone"}</span>{" "}
            <span className="audit-what">{ACTION_TEXT[e.action] || e.action}</span>
            {isUserTarget(e.action) && e.target_id && <strong> {nameOf(e.target_id)}</strong>}
            {detailText(e) && <span className="muted"> · {detailText(e)}</span>}
            <time className="audit-time muted tiny" dateTime={e.created_at}>
              {new Date(e.created_at).toLocaleString()}
            </time>
          </li>
        ))}
      </ul>
      {more && (
        <button
          type="button"
          className="btn ghost sm"
          disabled={loading}
          onClick={() => void load(entries[entries.length - 1]?.created_at)}
        >
          {loading ? "Loading…" : "Load older"}
        </button>
      )}
    </div>
  );
}

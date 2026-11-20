import { useCallback, useEffect, useState } from "react";
import { api, getApiBase } from "../api/client";
import { copyText } from "../lib/clipboard";
import type { ChannelType, ChannelWebhook, ChannelWebhookCreated } from "../types";

type Props = {
  channelId: string;
  channelType: ChannelType;
  canManageChannel: boolean;
};

type CreatedSecret = {
  label: string;
  value: string;
  hint?: string;
};

export function ChannelIntegrationsPanel({
  channelId,
  channelType,
  canManageChannel,
}: Props) {
  const [webhooks, setWebhooks] = useState<ChannelWebhook[]>([]);
  const [webhookName, setWebhookName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [createdSecret, setCreatedSecret] = useState<CreatedSecret | null>(
    null,
  );

  const isTextChannel = channelType === "text";

  const loadWebhooks = useCallback(async () => {
    if (!canManageChannel || !isTextChannel) return;
    const list = await api<ChannelWebhook[]>(
      `/api/channels/${channelId}/webhooks`,
    );
    setWebhooks(list);
  }, [canManageChannel, channelId, isTextChannel]);

  useEffect(() => {
    setErr(null);
    setMsg(null);
    setCreatedSecret(null);
    void loadWebhooks().catch((e) =>
      setErr(e instanceof Error ? e.message : "Failed to load webhooks"),
    );
  }, [loadWebhooks]);

  async function onCreateWebhook() {
    const name = webhookName.trim();
    if (!name) {
      setErr("Webhook name is required.");
      return;
    }
    setBusy(true);
    setErr(null);
    setMsg(null);
    setCreatedSecret(null);
    try {
      const created = await api<ChannelWebhookCreated>(
        `/api/channels/${channelId}/webhooks`,
        { method: "POST", body: { name } },
      );
      const url = `${getApiBase()}/api/webhooks/${created.id}/${created.token}`;
      setWebhookName("");
      setWebhooks((prev) => [...prev, created]);
      setCreatedSecret({
        label: "Webhook URL (shown once)",
        value: url,
        hint: "POST JSON: { \"content\": \"Hello\", \"username\": \"optional override\" }",
      });
      setMsg(`Created webhook “${created.name}”.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Create webhook failed");
    } finally {
      setBusy(false);
    }
  }

  async function onDeleteWebhook(id: string) {
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/webhooks/${id}`, { method: "DELETE" });
      setWebhooks((prev) => prev.filter((w) => w.id !== id));
      setMsg("Webhook deleted.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Delete webhook failed");
    } finally {
      setBusy(false);
    }
  }

  function copySecret(value: string) {
    void copyText(value).then(
      () => setMsg("Copied to clipboard."),
      () => setErr("Could not copy to clipboard."),
    );
  }

  return (
    <div className="stack settings-form">
      <div className="settings-section">
        <h4>Webhooks</h4>
        <p className="muted">
          Webhooks post messages to this channel over HTTP. The URL includes a
          secret token — treat it like a password.
        </p>

        {!isTextChannel ? (
          <p className="muted">Webhooks are only available for text channels.</p>
        ) : !canManageChannel ? (
          <p className="muted">
            You need Manage Channel permission to create or delete webhooks.
          </p>
        ) : (
          <>
            {webhooks.length > 0 && (
              <ul className="integration-list">
                {webhooks.map((w) => (
                  <li key={w.id} className="integration-row">
                    <div>
                      <strong>{w.name}</strong>
                      <p className="muted integration-meta">
                        Created {new Date(w.created_at).toLocaleString()}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="btn ghost danger-text"
                      disabled={busy}
                      onClick={() => void onDeleteWebhook(w.id)}
                    >
                      Delete
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="integration-create">
              <input
                type="text"
                placeholder="Webhook name"
                value={webhookName}
                onChange={(e) => setWebhookName(e.target.value)}
                disabled={busy}
              />
              <button
                type="button"
                className="btn primary"
                disabled={busy}
                onClick={() => void onCreateWebhook()}
              >
                Create Webhook
              </button>
            </div>
          </>
        )}
      </div>

      {createdSecret && (
        <div className="settings-section integration-secret">
          <h4>{createdSecret.label}</h4>
          {createdSecret.hint && <p className="muted">{createdSecret.hint}</p>}
          <code className="integration-secret-value">{createdSecret.value}</code>
          <div className="row">
            <button
              type="button"
              className="btn ghost"
              onClick={() => copySecret(createdSecret.value)}
            >
              Copy
            </button>
          </div>
        </div>
      )}

      {msg && <p className="form-ok">{msg}</p>}
      {err && <p className="form-error">{err}</p>}
    </div>
  );
}

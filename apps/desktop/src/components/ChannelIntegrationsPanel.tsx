import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import { getApiBase } from "../api/client";
import { copyText } from "../lib/clipboard";
import {
  buildDefaultBotConfig,
  downloadJson,
} from "../lib/defaultBotConfig";
import type {
  ChannelType,
  ChannelWebhook,
  ChannelWebhookCreated,
  ServerBot,
  ServerBotCreated,
} from "../types";

type Props = {
  channelId: string;
  channelType: ChannelType;
  serverId: string;
  canManageChannel: boolean;
  canManageServer: boolean;
};

type CreatedSecret = {
  kind: "webhook" | "bot";
  label: string;
  value: string;
  hint?: string;
};

export function ChannelIntegrationsPanel({
  channelId,
  channelType,
  serverId,
  canManageChannel,
  canManageServer,
}: Props) {
  const [webhooks, setWebhooks] = useState<ChannelWebhook[]>([]);
  const [bots, setBots] = useState<ServerBot[]>([]);
  const [webhookName, setWebhookName] = useState("");
  const [botName, setBotName] = useState("");
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

  const loadBots = useCallback(async () => {
    if (!canManageServer) return;
    const list = await api<ServerBot[]>(`/api/servers/${serverId}/bots`);
    setBots(list);
  }, [canManageServer, serverId]);

  useEffect(() => {
    setErr(null);
    setMsg(null);
    setCreatedSecret(null);
    void loadWebhooks().catch((e) =>
      setErr(e instanceof Error ? e.message : "Failed to load webhooks"),
    );
    void loadBots().catch((e) =>
      setErr(e instanceof Error ? e.message : "Failed to load bots"),
    );
  }, [loadWebhooks, loadBots]);

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
        kind: "webhook",
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

  async function onCreateBot() {
    const name = botName.trim();
    if (!name) {
      setErr("Bot name is required.");
      return;
    }
    setBusy(true);
    setErr(null);
    setMsg(null);
    setCreatedSecret(null);
    try {
      const created = await api<ServerBotCreated>(
        `/api/servers/${serverId}/bots`,
        { method: "POST", body: { name } },
      );
      setBotName("");
      setBots((prev) => [...prev, created]);
      setCreatedSecret({
        kind: "bot",
        label: "Bot token (shown once)",
        value: created.token,
        hint: "Use Authorization: Bot {token} for API requests.",
      });
      setMsg(`Created bot “${created.name}”. Download the config below while the token is visible.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Create bot failed");
    } finally {
      setBusy(false);
    }
  }

  async function onDeleteBot(id: string) {
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/bots/${id}`, { method: "DELETE" });
      setBots((prev) => prev.filter((b) => b.id !== id));
      setMsg("Bot deleted.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Delete bot failed");
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

  function downloadBotConfig(bot?: ServerBot, token?: string) {
    const config = buildDefaultBotConfig({
      serverId,
      channelId,
      botId: bot?.id,
      botName: bot?.name ?? "My Bot",
      botToken: token,
    });
    const slug = (bot?.name ?? "speakapp-bot")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    downloadJson(`${slug || "speakapp-bot"}.json`, config);
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

      <div className="settings-section">
        <h4>Bots</h4>
        <p className="muted">
          Bots use the same REST API as the app with{" "}
          <code>Authorization: Bot {"{token}"}</code>. They can manage channels,
          messages, members, roles, invites, emojis, voice, and more — limited
          to this server and whatever permissions the bot creator has.
        </p>

        {!canManageServer ? (
          <p className="muted">
            You need Manage Server permission to create or delete bots.
          </p>
        ) : (
          <>
            <div className="row integration-actions">
              <button
                type="button"
                className="btn ghost"
                disabled={busy}
                onClick={() => downloadBotConfig()}
              >
                Download default config
              </button>
            </div>

            {bots.length > 0 && (
              <ul className="integration-list">
                {bots.map((b) => (
                  <li key={b.id} className="integration-row">
                    <div>
                      <strong>{b.name}</strong>
                      <p className="muted integration-meta">
                        Created {new Date(b.created_at).toLocaleString()}
                      </p>
                    </div>
                    <div className="row">
                      <button
                        type="button"
                        className="btn ghost"
                        disabled={busy}
                        onClick={() => downloadBotConfig(b)}
                      >
                        Config
                      </button>
                      <button
                        type="button"
                        className="btn ghost danger-text"
                        disabled={busy}
                        onClick={() => void onDeleteBot(b.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <div className="integration-create">
              <input
                type="text"
                placeholder="Bot name"
                value={botName}
                onChange={(e) => setBotName(e.target.value)}
                disabled={busy}
              />
              <button
                type="button"
                className="btn primary"
                disabled={busy}
                onClick={() => void onCreateBot()}
              >
                Create Bot
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
            {createdSecret.kind === "bot" && (
              <button
                type="button"
                className="btn primary"
                onClick={() => {
                  const bot = bots[bots.length - 1];
                  downloadBotConfig(bot, createdSecret.value);
                }}
              >
                Download config with token
              </button>
            )}
          </div>
        </div>
      )}

      {msg && <p className="form-ok">{msg}</p>}
      {err && <p className="form-error">{err}</p>}
    </div>
  );
}

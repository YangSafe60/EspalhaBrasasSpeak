import { getApiBase } from "../api/client";

export type SpeakAppBotConfig = {
  speakapp_version: 2;
  api_base: string;
  server_id: string;
  bot_id: string;
  bot_name: string;
  bot_token: string;
  auth_header: string;
  notes: string[];
  endpoints: Record<string, string>;
  examples: Record<
    string,
    {
      method: string;
      url: string;
      headers?: Record<string, string>;
      body?: unknown;
    }
  >;
};

const BOT_API_NOTES = [
  "Use Authorization: Bot {token} on the same REST routes as the desktop app.",
  "Bots are scoped to one server and inherit the creator's permissions.",
  "Personal routes (friends, DMs, account settings) reject bot tokens.",
];

export function buildDefaultBotConfig(opts: {
  serverId: string;
  botId?: string;
  botName?: string;
  botToken?: string;
  channelId?: string;
}): SpeakAppBotConfig {
  const apiBase = getApiBase();
  const botToken = opts.botToken ?? "PASTE_YOUR_BOT_TOKEN_HERE";
  const channelId = opts.channelId ?? "CHANNEL_ID";
  const serverId = opts.serverId;
  const auth = { Authorization: `Bot ${botToken}`, "Content-Type": "application/json" };

  const endpoints: Record<string, string> = {
    me: `${apiBase}/api/bots/me`,
    server: `${apiBase}/api/servers/${serverId}`,
    channels: `${apiBase}/api/servers/${serverId}/channels`,
    members: `${apiBase}/api/servers/${serverId}/members`,
    roles: `${apiBase}/api/servers/${serverId}/roles`,
    invites: `${apiBase}/api/servers/${serverId}/invites`,
    emojis: `${apiBase}/api/servers/${serverId}/emojis`,
    bans: `${apiBase}/api/servers/${serverId}/bans`,
    rules: `${apiBase}/api/servers/${serverId}/rules`,
    channel: `${apiBase}/api/channels/${channelId}`,
    messages: `${apiBase}/api/channels/${channelId}/messages`,
    message: `${apiBase}/api/messages/{message_id}`,
    reactions: `${apiBase}/api/messages/{message_id}/reactions/{emoji}`,
    overwrites: `${apiBase}/api/channels/${channelId}/overwrites`,
    voice_token: `${apiBase}/api/channels/${channelId}/voice/token`,
    voice_states: `${apiBase}/api/voice/state?server_id=${serverId}`,
    upload: `${apiBase}/api/media/upload`,
    gifs: `${apiBase}/api/gifs/search`,
  };

  return {
    speakapp_version: 2,
    api_base: apiBase,
    server_id: serverId,
    bot_id: opts.botId ?? "",
    bot_name: opts.botName ?? "My Bot",
    bot_token: botToken,
    auth_header: `Bot ${botToken}`,
    notes: BOT_API_NOTES,
    endpoints,
    examples: {
      send_message: {
        method: "POST",
        url: endpoints.messages,
        headers: auth,
        body: { content: "Hello from my bot!" },
      },
      edit_message: {
        method: "PATCH",
        url: endpoints.message,
        headers: auth,
        body: { content: "Updated text" },
      },
      delete_message: {
        method: "DELETE",
        url: endpoints.message,
        headers: { Authorization: `Bot ${botToken}` },
      },
      add_reaction: {
        method: "PUT",
        url: endpoints.reactions,
        headers: { Authorization: `Bot ${botToken}` },
      },
      create_channel: {
        method: "POST",
        url: endpoints.channels,
        headers: auth,
        body: { name: "bot-log", channel_type: "text" },
      },
      kick_member: {
        method: "DELETE",
        url: `${apiBase}/api/servers/${serverId}/members/{user_id}`,
        headers: { Authorization: `Bot ${botToken}` },
      },
      create_invite: {
        method: "POST",
        url: endpoints.invites,
        headers: auth,
        body: { max_age: 86400 },
      },
    },
  };
}

export function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

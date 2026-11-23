import { invitePreview } from "./inviteMessage";

/** Short plain-text preview for toast notifications. */
export function messagePreview(content: string, maxLen = 140): string {
  const invite = invitePreview(content);
  if (invite) return invite;
  const text = content
    .replace(/```[\s\S]*?```/g, "[code block]")
    // Spoilers stay hidden in notifications too.
    .replace(/\|\|[\s\S]+?\|\|/g, "[spoiler]")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/<@!?[\w-]+>/g, "@someone")
    .replace(/<#[\w-]+>/g, "#channel")
    .replace(/<a?:\w+:\d+>/g, ":emoji:")
    .replace(/:\w+(?:~\d+)?:/g, ":emoji:")
    .replace(/[*_~>|]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return "Sent a message";
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 1)}…`;
}

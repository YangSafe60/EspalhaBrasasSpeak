import { createElement, type ReactNode } from "react";
import { mediaUrl } from "./mediaUrl";
import {
  renderTextWithMentions,
  type MentionContext,
} from "./mentions";
import type { ServerEmoji } from "../types";

/** Discord-style custom emoji token: <:name:uuid> or <a:name:uuid> */
export const CUSTOM_EMOJI_TOKEN_RE =
  /<(a)?:([a-z0-9_]{2,32}):([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})>/g;

const CUSTOM_EMOJI_TOKEN_ONE =
  /^<(a)?:([a-z0-9_]{2,32}):([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})>$/;

export function customEmojiToken(emoji: ServerEmoji): string {
  return emoji.animated
    ? `<a:${emoji.name}:${emoji.id}>`
    : `<:${emoji.name}:${emoji.id}>`;
}

export function matchCustomEmojiToken(
  token: string,
): { animated: boolean; name: string; id: string } | null {
  const m = token.match(CUSTOM_EMOJI_TOKEN_ONE);
  if (!m) return null;
  return { animated: m[1] === "a", name: m[2], id: m[3] };
}

export function extractCustomEmojiIds(content: string): string[] {
  const ids: string[] = [];
  const re = new RegExp(CUSTOM_EMOJI_TOKEN_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    ids.push(m[3]);
  }
  return ids;
}

export function renderMessageContent(
  content: string,
  emojiById: Record<string, ServerEmoji>,
  mentionCtx?: MentionContext,
): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = new RegExp(CUSTOM_EMOJI_TOKEN_RE.source, "g");
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(content))) {
    if (m.index > last) {
      nodes.push(
        ...renderTextWithMentions(
          content.slice(last, m.index),
          mentionCtx,
          `t${key}`,
        ),
      );
    }
    const animated = m[1] === "a";
    const name = m[2];
    const id = m[3];
    const emoji = emojiById[id];
    if (emoji) {
      nodes.push(
        createElement("img", {
          key: `e-${key++}`,
          className: `custom-emoji${animated || emoji.animated ? " is-animated" : ""}`,
          src: mediaUrl(emoji.image_url),
          alt: `:${emoji.name}:`,
          title: `:${emoji.name}:`,
          referrerPolicy: "no-referrer",
          draggable: false,
        }),
      );
    } else {
      nodes.push(
        createElement(
          "span",
          {
            key: `e-${key++}`,
            className: "custom-emoji-fallback",
            title: `:${name}:`,
          },
          `:${name}:`,
        ),
      );
    }
    last = m.index + m[0].length;
  }
  if (last < content.length) {
    nodes.push(
      ...renderTextWithMentions(content.slice(last), mentionCtx, `t${key}`),
    );
  }
  if (nodes.length === 0) {
    nodes.push(...renderTextWithMentions(content, mentionCtx, "t0"));
  }
  return nodes;
}

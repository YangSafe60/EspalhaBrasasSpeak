import type { Channel } from "../../types";

export type ChannelSidebarProps = {
  onJoinVoice: (channelId: string) => void;
  speakingIds?: string[];
  voiceHandlers?: import("../MemberUserMenu").MemberVoiceHandlers;
};

export type ChannelMenuState = {
  x: number;
  y: number;
  channel: Channel;
} | null;

export type EmptySpaceMenuState = {
  x: number;
  y: number;
} | null;

export type CreateDraft = {
  mode: "channel" | "category";
  categoryId: string | null;
};

export type DragPayload = {
  kind: "category" | "channel";
  id: string;
};

export type DropHint =
  | { zone: "category-before"; categoryId: string }
  | { zone: "category-end" }
  | { zone: "category-into"; categoryId: string }
  | { zone: "channel-before"; channelId: string; categoryId: string | null }
  | { zone: "uncategorized-into" };

/** MIME type used for channel/category drag-and-drop payloads. */
export const DND_MIME = "application/x-speakapp-channel";

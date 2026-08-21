/** Curated emoji sets for composer + reactions (no external pack). */
export const REACTION_EMOJIS = ["👍", "🔥", "😂", "❤️", "👀", "🎉", "✅", "😢"];

export type EmojiCategory = {
  id: string;
  label: string;
  emojis: string[];
};

export const EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    id: "smileys",
    label: "Smileys",
    emojis: [
      "😀", "😁", "😂", "🤣", "😊", "😍", "😘", "😎", "🤔", "😴",
      "😭", "😡", "🤯", "🥳", "😇", "🙃", "😏", "🤢", "🤡", "👻",
    ],
  },
  {
    id: "gestures",
    label: "Gestures",
    emojis: [
      "👍", "👎", "👏", "🙌", "🤝", "🙏", "✌️", "🤞", "👋", "💪",
      "🫡", "🫶", "👌", "🤙", "👊", "✊", "🤘", "👀", "🧠", "🫀",
    ],
  },
  {
    id: "hearts",
    label: "Hearts",
    emojis: [
      "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "💔", "💕",
      "💖", "💗", "💘", "💝", "✨", "⭐", "🌟", "💫", "🔥", "💯",
    ],
  },
  {
    id: "objects",
    label: "Objects",
    emojis: [
      "🎉", "🎊", "🎁", "🎈", "🏆", "🎮", "🎧", "🎤", "📷", "💻",
      "📱", "💡", "📌", "📎", "📝", "📚", "☕", "🍕", "🍔", "🍺",
    ],
  },
  {
    id: "symbols",
    label: "Symbols",
    emojis: [
      "✅", "❌", "⚠️", "❓", "❗", "💬", "🗨️", "🔔", "🔇", "🔒",
      "🔓", "🟢", "🔴", "🟡", "🔵", "⚪", "⚫", "➡️", "⬅️", "⬆️",
    ],
  },
];

export function insertAtCursor(
  value: string,
  insert: string,
  start: number,
  end: number,
): { next: string; caret: number } {
  const next = value.slice(0, start) + insert + value.slice(end);
  return { next, caret: start + insert.length };
}

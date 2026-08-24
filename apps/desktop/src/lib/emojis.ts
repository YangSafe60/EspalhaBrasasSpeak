/** Curated emoji sets for composer + reactions (used offline / as fallback). */
export const REACTION_EMOJIS = ["👍", "🔥", "😂", "❤️", "👀", "🎉", "✅", "😢"];

export type EmojiCategory = {
  id: string;
  label: string;
  /** Tab icon (usually the first emoji of the group). */
  icon: string;
  emojis: string[];
};

export const EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    id: "smileys-emotion",
    label: "Smileys",
    icon: "😀",
    emojis: [
      "😀", "😁", "😂", "🤣", "😊", "😍", "😘", "😎", "🤔", "😴",
      "😭", "😡", "🤯", "🥳", "😇", "🙃", "😏", "🤢", "🤡", "👻",
      "💀", "👽", "🤖", "💩", "🙈", "🙉", "🙊", "😺", "😹", "😻",
    ],
  },
  {
    id: "people-body",
    label: "People",
    icon: "👋",
    emojis: [
      "👍", "👎", "👏", "🙌", "🤝", "🙏", "✌️", "🤞", "👋", "💪",
      "🫡", "🫶", "👌", "🤙", "👊", "✊", "🤘", "👀", "🧠", "🫀",
      "👶", "🧒", "👦", "👧", "🧑", "👨", "👩", "🧓", "👮", "🧑‍💻",
    ],
  },
  {
    id: "animals-nature",
    label: "Animals",
    icon: "🐶",
    emojis: [
      "🐶", "🐱", "🐭", "🐹", "🐰", "🦊", "🐻", "🐼", "🐨", "🐯",
      "🦁", "🐮", "🐷", "🐸", "🐵", "🐔", "🐧", "🐦", "🐤", "🦆",
      "🦅", "🦉", "🦇", "🐺", "🐗", "🐴", "🦄", "🐝", "🐛", "🦋",
      "🌸", "🌹", "🌻", "🌲", "🌳", "🍀", "🍁", "🌙", "⭐", "☀️",
    ],
  },
  {
    id: "food-drink",
    label: "Food",
    icon: "🍕",
    emojis: [
      "🍏", "🍎", "🍐", "🍊", "🍋", "🍌", "🍉", "🍇", "🍓", "🫐",
      "🍒", "🍑", "🥭", "🍍", "🥥", "🥝", "🍅", "🥑", "🍔", "🍟",
      "🍕", "🌭", "🥪", "🌮", "🌯", "🥗", "🍝", "🍜", "🍣", "🍤",
      "🍦", "🍩", "🍪", "🎂", "🍰", "☕", "🍵", "🍺", "🍻", "🍷",
    ],
  },
  {
    id: "travel-places",
    label: "Travel",
    icon: "✈️",
    emojis: [
      "🚗", "🚕", "🚌", "🚎", "🏎️", "🚓", "🚑", "🚒", "🚐", "🛻",
      "🚚", "🚛", "🚜", "🛵", "🚲", "🛴", "✈️", "🚀", "🚁", "🛶",
      "⛵", "🚢", "🏠", "🏡", "🏢", "🏣", "🏥", "🏦", "🏨", "🏰",
      "🗼", "🗽", "🗻", "🌋", "🏖️", "🏜️", "🏝️", "🗺️", "🧭", "⛺",
    ],
  },
  {
    id: "activities",
    label: "Activities",
    icon: "⚽",
    emojis: [
      "⚽", "🏀", "🏈", "⚾", "🎾", "🏐", "🏉", "🥏", "🎱", "🏓",
      "🏸", "🥅", "🏒", "🏑", "🥍", "🏏", "⛳", "🏹", "🎣", "🤿",
      "🥊", "🥋", "🎽", "🛹", "🛼", "🛷", "⛸️", "🎿", "⛷️", "🏂",
      "🏆", "🥇", "🥈", "🥉", "🎖️", "🎗️", "🎫", "🎟️", "🎪", "🎭",
    ],
  },
  {
    id: "objects",
    label: "Objects",
    icon: "💡",
    emojis: [
      "⌚", "📱", "💻", "⌨️", "🖥️", "🖨️", "🖱️", "🕹️", "🗜️", "💽",
      "💾", "💿", "📀", "📷", "📸", "📹", "🎥", "📞", "☎️", "📺",
      "📻", "🎙️", "🎚️", "🎛️", "🧭", "⏱️", "⏲️", "⏰", "🕰️", "⌛",
      "📡", "🔋", "🔌", "💡", "🔦", "🕯️", "🧯", "🛢️", "💸", "💵",
    ],
  },
  {
    id: "symbols",
    label: "Symbols",
    icon: "💜",
    emojis: [
      "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "💔", "💕",
      "💖", "💗", "💘", "💝", "✨", "⭐", "🌟", "💫", "🔥", "💯",
      "✅", "❌", "⚠️", "❓", "❗", "💬", "🗨️", "🔔", "🔇", "🔒",
      "🔓", "🟢", "🔴", "🟡", "🔵", "⚪", "⚫", "➡️", "⬅️", "⬆️",
    ],
  },
  {
    id: "flags",
    label: "Flags",
    icon: "🏳️",
    emojis: [
      "🏳️", "🏴", "🏁", "🚩", "🏳️‍🌈", "🏳️‍⚧️", "🇺🇳", "🇵🇹", "🇧🇷", "🇪🇸",
      "🇫🇷", "🇩🇪", "🇮🇹", "🇬🇧", "🇺🇸", "🇨🇦", "🇲🇽", "🇦🇷", "🇯🇵", "🇰🇷",
      "🇨🇳", "🇮🇳", "🇦🇺", "🇳🇿", "🇿🇦", "🇪🇬", "🇹🇷", "🇷🇺", "🇺🇦", "🇵🇱",
    ],
  },
];

/** Short labels + icons for unicode-emoji-json group slugs. */
export const GROUP_META: Record<string, { label: string; icon: string }> = {
  "smileys-emotion": { label: "Smileys", icon: "😀" },
  "people-body": { label: "People", icon: "👋" },
  "component": { label: "Components", icon: "🦰" },
  "animals-nature": { label: "Animals & Nature", icon: "🐶" },
  "food-drink": { label: "Food & Drink", icon: "🍕" },
  "travel-places": { label: "Travel & Places", icon: "✈️" },
  "activities": { label: "Activities", icon: "⚽" },
  "objects": { label: "Objects", icon: "💡" },
  "symbols": { label: "Symbols", icon: "💜" },
  "flags": { label: "Flags", icon: "🏳️" },
};

export function insertAtCursor(
  value: string,
  insert: string,
  start: number,
  end: number,
): { next: string; caret: number } {
  const next = value.slice(0, start) + insert + value.slice(end);
  return { next, caret: start + insert.length };
}

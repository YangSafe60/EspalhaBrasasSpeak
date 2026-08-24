import { EMOJI_CATEGORIES, type EmojiCategory } from "./emojis";

const EMOJI_JSON =
  "https://cdn.jsdelivr.net/npm/unicode-emoji-json@0.8.0/data-by-group.json";

type RemoteEmoji = { emoji?: string; name?: string };
type RemoteGroup = { name?: string; slug?: string; emojis?: RemoteEmoji[] };

let cache: EmojiCategory[] | null = null;
let names = new Map<string, string>();
let pending: Promise<EmojiCategory[]> | null = null;

function fallbackCategories(): EmojiCategory[] {
  return EMOJI_CATEGORIES;
}

export async function loadEmojiCatalog(): Promise<EmojiCategory[]> {
  if (cache) return cache;
  if (pending) return pending;
  pending = (async () => {
    try {
      const res = await fetch(EMOJI_JSON);
      if (!res.ok) throw new Error(String(res.status));
      const groups = (await res.json()) as RemoteGroup[];
      const next: EmojiCategory[] = [];
      const nextNames = new Map<string, string>();
      for (const g of groups) {
        const emojis: string[] = [];
        for (const item of g.emojis || []) {
          if (!item.emoji) continue;
          emojis.push(item.emoji);
          if (item.name) nextNames.set(item.emoji, item.name.toLowerCase());
        }
        if (!emojis.length) continue;
        next.push({
          id: g.slug || g.name || `g${next.length}`,
          label: g.name || "Emoji",
          emojis,
        });
      }
      cache = next.length ? next : fallbackCategories();
      names = nextNames;
    } catch {
      cache = fallbackCategories();
    }
    return cache;
  })();
  return pending;
}

export function searchEmojis(categories: EmojiCategory[], q: string): string[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of categories) {
    const labelHit = c.label.toLowerCase().includes(needle);
    for (const emoji of c.emojis) {
      if (seen.has(emoji)) continue;
      const name = names.get(emoji) || "";
      if (labelHit || name.includes(needle)) {
        seen.add(emoji);
        out.push(emoji);
      }
    }
  }
  return out;
}

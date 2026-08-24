import {
  EMOJI_CATEGORIES,
  GROUP_META,
  type EmojiCategory,
} from "./emojis";

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

function normalizeGroup(g: RemoteGroup, index: number): EmojiCategory | null {
  const emojis: string[] = [];
  for (const item of g.emojis || []) {
    if (!item.emoji) continue;
    emojis.push(item.emoji);
    if (item.name) names.set(item.emoji, item.name.toLowerCase());
  }
  if (!emojis.length) return null;

  const slug = (g.slug || g.name || `group-${index}`)
    .toLowerCase()
    .replace(/\s+/g, "-");
  const meta = GROUP_META[slug];
  const label =
    meta?.label ||
    g.name ||
    slug
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");

  return {
    id: slug,
    label,
    icon: meta?.icon || emojis[0]!,
    emojis,
  };
}

export async function loadEmojiCatalog(): Promise<EmojiCategory[]> {
  if (cache) return cache;
  if (pending) return pending;
  pending = (async () => {
    try {
      const res = await fetch(EMOJI_JSON);
      if (!res.ok) throw new Error(String(res.status));
      const groups = (await res.json()) as RemoteGroup[];
      names = new Map();
      const next: EmojiCategory[] = [];
      for (let i = 0; i < groups.length; i++) {
        const cat = normalizeGroup(groups[i]!, i);
        // Skip skin-tone component group — not useful in the picker.
        if (!cat || cat.id === "component") continue;
        next.push(cat);
      }
      cache = next.length ? next : fallbackCategories();
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

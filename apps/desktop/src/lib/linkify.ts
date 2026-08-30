import { createElement, type ReactNode } from "react";

/** http(s) URLs in message text (stops before common trailing punctuation). */
export const URL_IN_TEXT_RE =
  /https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]}]/gi;

export type UrlHit = { start: number; end: number; url: string };

export function collectUrlHits(text: string): UrlHit[] {
  const hits: UrlHit[] = [];
  const re = new RegExp(URL_IN_TEXT_RE.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    hits.push({
      start: m.index,
      end: m.index + m[0].length,
      url: m[0],
    });
  }
  return hits;
}

/** Parse a YouTube watch / youtu.be / shorts / embed URL into a video id. */
export function parseYouTubeVideoId(raw: string): string | null {
  try {
    const u = new URL(raw);
    const host = u.hostname.replace(/^www\./i, "").toLowerCase();
    if (host === "youtu.be") {
      const id = u.pathname.replace(/^\//, "").split(/[/?#]/)[0];
      return id || null;
    }
    if (
      host === "youtube.com" ||
      host === "m.youtube.com" ||
      host === "music.youtube.com"
    ) {
      if (u.pathname === "/watch") {
        return u.searchParams.get("v");
      }
      const parts = u.pathname.split("/").filter(Boolean);
      if (parts[0] === "embed" || parts[0] === "shorts" || parts[0] === "live") {
        return parts[1] || null;
      }
    }
  } catch {
    /* invalid URL */
  }
  return null;
}

/** Unique YouTube page URLs found in a message (for embed cards). */
export function extractYouTubeUrls(content: string, max = 3): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const re = new RegExp(URL_IN_TEXT_RE.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    const url = m[0];
    const id = parseYouTubeVideoId(url);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(normalizeYouTubeUrl(id));
    if (out.length >= max) break;
  }
  return out;
}

export function normalizeYouTubeUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

export function youtubeThumbnail(videoId: string): string {
  return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
}

type MergeHit =
  | { kind: "text"; start: number; end: number }
  | { kind: "link"; start: number; end: number; url: string };

/** Merge URL hits with opaque ranges (e.g. mentions). Mention ranges win on overlap. */
export function mergeUrlHitsWithBlocked(
  text: string,
  urlHits: UrlHit[],
  blocked: { start: number; end: number }[],
): MergeHit[] {
  const sortedBlocked = [...blocked].sort((a, b) => a.start - b.start);
  const allowedUrls = urlHits.filter(
    (u) => !sortedBlocked.some((b) => !(u.end <= b.start || u.start >= b.end)),
  );

  const hits: MergeHit[] = [
    ...allowedUrls.map((u) => ({
      kind: "link" as const,
      start: u.start,
      end: u.end,
      url: u.url,
    })),
  ];

  hits.sort((a, b) => a.start - b.start);
  const merged: MergeHit[] = [];
  let cursor = 0;
  for (const h of hits) {
    if (h.start < cursor) continue;
    if (h.start > cursor) {
      merged.push({ kind: "text", start: cursor, end: h.start });
    }
    merged.push(h);
    cursor = h.end;
  }
  if (cursor < text.length) {
    merged.push({ kind: "text", start: cursor, end: text.length });
  }
  return merged;
}

/** Turn plain text into nodes with clickable links (no mentions). */
export function renderTextWithLinks(
  text: string,
  keyPrefix: string,
): ReactNode[] {
  if (!text) return [];
  const urlHits = collectUrlHits(text);
  if (urlHits.length === 0) return [text];

  const segments = mergeUrlHitsWithBlocked(text, urlHits, []);
  const nodes: ReactNode[] = [];
  let key = 0;
  for (const seg of segments) {
    if (seg.kind === "text") {
      nodes.push(text.slice(seg.start, seg.end));
      continue;
    }
    nodes.push(
      createElement(
        "a",
        {
          key: `${keyPrefix}-l-${key++}`,
          className: "message-link",
          href: seg.url,
          target: "_blank",
          rel: "noreferrer noopener",
        },
        seg.url,
      ),
    );
  }
  return nodes;
}

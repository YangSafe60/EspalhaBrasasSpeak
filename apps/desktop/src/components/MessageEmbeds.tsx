import { useEffect, useMemo, useState } from "react";
import {
  extractYouTubeUrls,
  parseYouTubeVideoId,
  youtubeThumbnail,
} from "../lib/linkify";

type YouTubeMeta = {
  title: string;
  author: string;
  thumbnail: string;
};

const oembedCache = new Map<string, YouTubeMeta | null>();

async function loadYouTubeMeta(url: string): Promise<YouTubeMeta | null> {
  if (oembedCache.has(url)) {
    return oembedCache.get(url) ?? null;
  }
  const videoId = parseYouTubeVideoId(url);
  if (!videoId) {
    oembedCache.set(url, null);
    return null;
  }
  const fallback: YouTubeMeta = {
    title: "Watch on YouTube",
    author: "YouTube",
    thumbnail: youtubeThumbnail(videoId),
  };
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
    );
    if (!res.ok) {
      oembedCache.set(url, fallback);
      return fallback;
    }
    const data = (await res.json()) as {
      title?: string;
      author_name?: string;
      thumbnail_url?: string;
    };
    const meta: YouTubeMeta = {
      title: data.title || fallback.title,
      author: data.author_name || fallback.author,
      thumbnail: data.thumbnail_url || fallback.thumbnail,
    };
    oembedCache.set(url, meta);
    return meta;
  } catch {
    oembedCache.set(url, fallback);
    return fallback;
  }
}

function YouTubeEmbedCard({ url }: { url: string }) {
  const [meta, setMeta] = useState<YouTubeMeta | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadYouTubeMeta(url).then((m) => {
      if (!cancelled) setMeta(m);
    });
    return () => {
      cancelled = true;
    };
  }, [url]);

  const videoId = parseYouTubeVideoId(url);
  const thumb = meta?.thumbnail ?? (videoId ? youtubeThumbnail(videoId) : "");

  return (
    <a
      className="message-embed message-embed-youtube"
      href={url}
      target="_blank"
      rel="noreferrer noopener"
    >
      <div className="message-embed-body">
        <span className="message-embed-provider">YouTube</span>
        {meta && (
          <span className="message-embed-author">{meta.author}</span>
        )}
        <span className="message-embed-title">
          {meta?.title ?? "Loading preview…"}
        </span>
        {thumb && (
          <div className="message-embed-media">
            <img src={thumb} alt="" loading="lazy" referrerPolicy="no-referrer" />
            <span className="message-embed-play" aria-hidden />
          </div>
        )}
      </div>
    </a>
  );
}

/** Rich link previews for supported URLs in a message body. */
export function MessageEmbeds({ content }: { content: string }) {
  const urls = useMemo(() => extractYouTubeUrls(content), [content]);
  if (!urls.length) return null;

  return (
    <div className="message-embeds">
      {urls.map((url) => (
        <YouTubeEmbedCard key={url} url={url} />
      ))}
    </div>
  );
}

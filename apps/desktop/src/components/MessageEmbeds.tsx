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

/** Only one chat video plays at a time: starting one stops the others. */
const PLAY_EVENT = "chat-youtube-play";

function YouTubeEmbedCard({ url }: { url: string }) {
  const [meta, setMeta] = useState<YouTubeMeta | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadYouTubeMeta(url).then((m) => {
      if (!cancelled) setMeta(m);
    });
    return () => {
      cancelled = true;
    };
  }, [url]);

  useEffect(() => {
    if (!playing) return;
    const onOther = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== url) setPlaying(false);
    };
    window.addEventListener(PLAY_EVENT, onOther);
    return () => window.removeEventListener(PLAY_EVENT, onOther);
  }, [playing, url]);

  const videoId = parseYouTubeVideoId(url);
  const thumb = meta?.thumbnail ?? (videoId ? youtubeThumbnail(videoId) : "");

  function play() {
    window.dispatchEvent(new CustomEvent(PLAY_EVENT, { detail: url }));
    setPlaying(true);
  }

  return (
    <div className="message-embed message-embed-youtube">
      <div className="message-embed-body">
        <span className="message-embed-provider">YouTube</span>
        {meta && <span className="message-embed-author">{meta.author}</span>}
        <a className="message-embed-title" href={url} target="_blank" rel="noreferrer noopener">
          {meta?.title ?? "Loading preview…"}
        </a>
        {videoId && playing ? (
          <div className="message-embed-media is-playing">
            <iframe
              src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&playsinline=1&rel=0`}
              title={meta?.title ?? "YouTube video"}
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
            />
          </div>
        ) : (
          thumb && (
            <div className="message-embed-media">
              <img src={thumb} alt="" loading="lazy" referrerPolicy="no-referrer" />
              {/* Like Discord: play here, or open it on YouTube. */}
              <div className="message-embed-actions">
                <button type="button" title="Play" aria-label="Play video" onClick={play}>
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden>
                    <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.2-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" />
                  </svg>
                </button>
                <a href={url} target="_blank" rel="noreferrer noopener" title="Open on YouTube" aria-label="Open on YouTube">
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
                  </svg>
                </a>
              </div>
            </div>
          )
        )}
      </div>
    </div>
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

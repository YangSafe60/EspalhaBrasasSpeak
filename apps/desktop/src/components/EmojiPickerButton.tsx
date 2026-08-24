import { useEffect, useMemo, useRef, useState } from "react";
import { customEmojiToken } from "../lib/customEmoji";
import { loadEmojiCatalog, searchEmojis } from "../lib/emojiCatalog";
import { EMOJI_CATEGORIES, type EmojiCategory } from "../lib/emojis";
import { mediaUrl } from "../lib/mediaUrl";
import { useAppStore } from "../store/appStore";
import type { ServerEmoji } from "../types";

type Props = {
  onPick: (emoji: string) => void;
  placement?: "up" | "down";
  className?: string;
  title?: string;
  /** Overrides the default 🙂 trigger label. */
  children?: React.ReactNode;
};

type CustomGroup = {
  serverId: string;
  serverName: string;
  emojis: ServerEmoji[];
};

export function EmojiPickerButton({
  onPick,
  placement = "up",
  className,
  title = "Emoji",
  children,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [categories, setCategories] = useState<EmojiCategory[]>(EMOJI_CATEGORIES);
  const [categoryId, setCategoryId] = useState(
    EMOJI_CATEGORIES[0]?.id ?? "smileys-emotion",
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  const customEmojis = useAppStore((s) => s.customEmojis);
  const servers = useAppStore((s) => s.servers);
  const loadMyEmojis = useAppStore((s) => s.loadMyEmojis);

  useEffect(() => {
    void loadEmojiCatalog().then((list) => {
      setCategories(list);
      setCategoryId((id) =>
        list.some((c) => c.id === id) ? id : list[0]?.id ?? id,
      );
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    void loadMyEmojis();
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, loadMyEmojis]);

  const customGroups = useMemo((): CustomGroup[] => {
    const byServer = new Map<string, ServerEmoji[]>();
    for (const e of customEmojis) {
      const list = byServer.get(e.server_id) || [];
      list.push(e);
      byServer.set(e.server_id, list);
    }
    return [...byServer.entries()]
      .map(([serverId, emojis]) => ({
        serverId,
        serverName:
          servers.find((s) => s.id === serverId)?.name || "Server",
        emojis: emojis.slice().sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => a.serverName.localeCompare(b.serverName));
  }, [customEmojis, servers]);

  const searching = query.trim().length > 0;
  const searchHits = useMemo(
    () => (searching ? searchEmojis(categories, query) : []),
    [categories, query, searching],
  );
  const customSearchHits = useMemo(() => {
    if (!searching) return [];
    const q = query.trim().toLowerCase();
    return customEmojis.filter(
      (e) =>
        e.name.includes(q) ||
        (servers.find((s) => s.id === e.server_id)?.name || "")
          .toLowerCase()
          .includes(q),
    );
  }, [searching, query, customEmojis, servers]);

  function jumpToGroup(id: string) {
    setCategoryId(id);
    setQuery("");
    requestAnimationFrame(() => {
      sectionRefs.current[id]?.scrollIntoView({
        block: "start",
        behavior: "smooth",
      });
    });
  }

  function pick(emoji: string) {
    onPick(emoji);
    setOpen(false);
    setQuery("");
  }

  function pickCustom(emoji: ServerEmoji) {
    pick(customEmojiToken(emoji));
  }

  return (
    <div className={`emoji-picker-root${className ? ` ${className}` : ""}`} ref={rootRef}>
      <button
        type="button"
        className="icon-btn emoji-picker-toggle"
        title={title}
        aria-label={title}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
      >
        {children ?? "🙂"}
      </button>
      {open && (
        <div
          className={`emoji-picker-panel ${placement === "up" ? "up" : "down"}`}
          role="dialog"
          aria-label="Emoji picker"
        >
          <input
            className="emoji-picker-search"
            type="search"
            placeholder="Search emoji"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          {!searching && (
            <div
              className="emoji-picker-tabs"
              role="tablist"
              aria-label="Emoji groups"
            >
              {customGroups.length > 0 && (
                <button
                  type="button"
                  role="tab"
                  aria-selected={categoryId === "custom"}
                  className={categoryId === "custom" ? "active" : undefined}
                  title="Custom"
                  onClick={() => jumpToGroup("custom")}
                >
                  ★
                </button>
              )}
              {categories.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  role="tab"
                  aria-selected={c.id === categoryId}
                  className={c.id === categoryId ? "active" : undefined}
                  title={c.label}
                  onClick={() => jumpToGroup(c.id)}
                >
                  {c.icon || c.emojis[0]}
                </button>
              ))}
            </div>
          )}
          <div className="emoji-picker-body" ref={bodyRef}>
            {searching ? (
              <>
                {customSearchHits.length > 0 && (
                  <>
                    <p className="emoji-group-title">Custom</p>
                    <div className="emoji-picker-grid">
                      {customSearchHits.map((e) => (
                        <button
                          key={e.id}
                          type="button"
                          className="emoji-picker-cell custom"
                          title={`:${e.name}:`}
                          onClick={() => pickCustom(e)}
                        >
                          <img
                            src={mediaUrl(e.image_url)}
                            alt={`:${e.name}:`}
                            referrerPolicy="no-referrer"
                          />
                        </button>
                      ))}
                    </div>
                  </>
                )}
                <p className="emoji-group-title">Unicode</p>
                {searchHits.length === 0 && customSearchHits.length === 0 ? (
                  <p className="muted tiny emoji-empty">
                    No emojis match “{query.trim()}”.
                  </p>
                ) : searchHits.length === 0 ? null : (
                  <div className="emoji-picker-grid">
                    {searchHits.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        className="emoji-picker-cell"
                        onClick={() => pick(emoji)}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <>
                {customGroups.length > 0 && (
                  <section
                    className="emoji-group"
                    ref={(el) => {
                      sectionRefs.current.custom = el;
                    }}
                  >
                    {customGroups.map((g) => (
                      <div key={g.serverId} className="emoji-custom-server">
                        <h4 className="emoji-group-title">
                          <span aria-hidden>★</span>
                          {g.serverName}
                        </h4>
                        <div className="emoji-picker-grid">
                          {g.emojis.map((e) => (
                            <button
                              key={e.id}
                              type="button"
                              className="emoji-picker-cell custom"
                              title={`:${e.name}:`}
                              onClick={() => pickCustom(e)}
                            >
                              <img
                                src={mediaUrl(e.image_url)}
                                alt={`:${e.name}:`}
                                referrerPolicy="no-referrer"
                              />
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </section>
                )}
                {categories.map((c) => (
                  <section
                    key={c.id}
                    className="emoji-group"
                    ref={(el) => {
                      sectionRefs.current[c.id] = el;
                    }}
                  >
                    <h4 className="emoji-group-title">
                      <span aria-hidden>{c.icon || c.emojis[0]}</span>
                      {c.label}
                    </h4>
                    <div className="emoji-picker-grid">
                      {c.emojis.map((emoji) => (
                        <button
                          key={`${c.id}-${emoji}`}
                          type="button"
                          className="emoji-picker-cell"
                          onClick={() => pick(emoji)}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </section>
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

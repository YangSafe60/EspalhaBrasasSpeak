import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { customEmojiToken } from "../lib/customEmoji";
import { loadEmojiCatalog, searchEmojis } from "../lib/emojiCatalog";
import { EMOJI_CATEGORIES, type EmojiCategory } from "../lib/emojis";
import { mediaCssUrl, mediaUrl } from "../lib/mediaUrl";
import { useAppStore } from "../store/appStore";
import type { ServerEmoji } from "../types";

type Placement = "up" | "down";
type PlacementProp = Placement | "auto";

type Props = {
  onPick: (emoji: string) => void;
  placement?: PlacementProp;
  className?: string;
  title?: string;
  /** Default 🙂 for composer; reaction uses a Discord-style smile icon. */
  variant?: "default" | "reaction";
  /** Overrides the trigger label/icon. */
  children?: React.ReactNode;
};

const PANEL_EST_HEIGHT = 420;
const PANEL_GAP = 8;

function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  let node = el?.parentElement ?? null;
  while (node) {
    const style = getComputedStyle(node);
    const oy = style.overflowY;
    if (oy === "auto" || oy === "scroll" || oy === "overlay") return node;
    node = node.parentElement;
  }
  return null;
}

function resolveAutoPlacement(
  toggleEl: HTMLElement,
  panelHeight: number,
): Placement {
  const rect = toggleEl.getBoundingClientRect();
  const scrollParent = findScrollParent(toggleEl);
  const bounds = scrollParent?.getBoundingClientRect() ?? {
    top: 0,
    bottom: window.innerHeight,
  };
  const spaceAbove = rect.top - bounds.top;
  const spaceBelow = bounds.bottom - rect.bottom;
  const need = panelHeight + PANEL_GAP;
  if (spaceAbove >= need) return "up";
  if (spaceBelow >= need) return "down";
  return spaceBelow >= spaceAbove ? "down" : "up";
}

export function ReactionSmileIcon() {
  return (
    <svg
      className="react-face-icon"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      aria-hidden
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <circle cx="9" cy="10" r="1.2" fill="currentColor" />
      <circle cx="15" cy="10" r="1.2" fill="currentColor" />
      <path
        d="M8.5 14.2c1.1 1.4 2.6 2.1 3.5 2.1s2.4-.7 3.5-2.1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

type CustomGroup = {
  serverId: string;
  serverName: string;
  iconUrl: string | null;
  emojis: ServerEmoji[];
};

function serverSectionId(serverId: string) {
  return `server-${serverId}`;
}

export function EmojiPickerButton({
  onPick,
  placement = "up",
  className,
  title = "Emoji",
  variant = "default",
  children,
}: Props) {
  const [open, setOpen] = useState(false);
  const [resolvedPlacement, setResolvedPlacement] = useState<Placement>(
    placement === "auto" ? "up" : placement,
  );
  const [query, setQuery] = useState("");
  const [categories, setCategories] = useState<EmojiCategory[]>(EMOJI_CATEGORIES);
  const [categoryId, setCategoryId] = useState(
    EMOJI_CATEGORIES[0]?.id ?? "smileys-emotion",
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
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
    const serverOrder = new Map(servers.map((s, i) => [s.id, i]));
    return [...byServer.entries()]
      .map(([serverId, emojis]) => {
        const server = servers.find((s) => s.id === serverId);
        return {
          serverId,
          serverName: server?.name || "Server",
          iconUrl: server?.icon_url || null,
          emojis: emojis.slice().sort((a, b) => a.name.localeCompare(b.name)),
        };
      })
      .sort((a, b) => {
        const ai = serverOrder.get(a.serverId);
        const bi = serverOrder.get(b.serverId);
        if (ai != null && bi != null) return ai - bi;
        if (ai != null) return -1;
        if (bi != null) return 1;
        return a.serverName.localeCompare(b.serverName);
      });
  }, [customEmojis, servers]);

  const searching = query.trim().length > 0;

  useLayoutEffect(() => {
    if (!open || !rootRef.current) return;
    const toggle = rootRef.current.querySelector(
      ".emoji-picker-toggle",
    ) as HTMLElement | null;
    if (!toggle) return;

    const updatePlacement = () => {
      const panelHeight = panelRef.current?.offsetHeight ?? PANEL_EST_HEIGHT;
      if (placement === "auto") {
        setResolvedPlacement(resolveAutoPlacement(toggle, panelHeight));
      } else {
        setResolvedPlacement(placement);
      }
    };

    updatePlacement();
    requestAnimationFrame(updatePlacement);
  }, [open, placement, query, searching, customGroups.length]);

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
        {children ?? (variant === "reaction" ? <ReactionSmileIcon /> : "🙂")}
      </button>
      {open && (
        <div
          ref={panelRef}
          className={`emoji-picker-panel ${resolvedPlacement === "up" ? "up" : "down"}`}
          role="dialog"
          aria-label="Emoji picker"
        >
          <div className="emoji-picker-layout">
            {!searching && (
              <aside
                className="emoji-picker-rail"
                aria-label="Emoji categories"
              >
                {customGroups.length > 0 && (
                  <>
                    {customGroups.map((g) => {
                      const sid = serverSectionId(g.serverId);
                      const initial = (g.serverName.charAt(0) || "?").toUpperCase();
                      return (
                        <button
                          key={g.serverId}
                          type="button"
                          className={`emoji-rail-btn emoji-rail-server${
                            categoryId === sid ? " active" : ""
                          }`}
                          title={g.serverName}
                          aria-label={g.serverName}
                          aria-current={categoryId === sid ? "true" : undefined}
                          onClick={() => jumpToGroup(sid)}
                        >
                          <span
                            className="emoji-rail-server-icon"
                            style={
                              g.iconUrl
                                ? { backgroundImage: mediaCssUrl(g.iconUrl) }
                                : undefined
                            }
                          >
                            {!g.iconUrl && initial}
                          </span>
                        </button>
                      );
                    })}
                    <div className="emoji-rail-sep" aria-hidden />
                  </>
                )}
                {categories.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={`emoji-rail-btn${
                      categoryId === c.id ? " active" : ""
                    }`}
                    title={c.label}
                    aria-label={c.label}
                    aria-current={categoryId === c.id ? "true" : undefined}
                    onClick={() => jumpToGroup(c.id)}
                  >
                    {c.icon || c.emojis[0]}
                  </button>
                ))}
              </aside>
            )}

            <div className="emoji-picker-main">
              <input
                className="emoji-picker-search"
                type="search"
                placeholder="Search emoji"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoFocus
              />
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
                    {customGroups.map((g) => {
                      const sid = serverSectionId(g.serverId);
                      return (
                        <section
                          key={g.serverId}
                          className="emoji-group"
                          ref={(el) => {
                            sectionRefs.current[sid] = el;
                          }}
                        >
                          <h4 className="emoji-group-title">{g.serverName}</h4>
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
                        </section>
                      );
                    })}
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
          </div>
        </div>
      )}
    </div>
  );
}

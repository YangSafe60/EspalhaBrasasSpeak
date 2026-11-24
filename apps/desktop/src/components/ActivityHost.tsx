import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { activityHeight, activitySlot } from "../lib/activitySlot";
import { useMini } from "../lib/miniStore";
import { openActivity, setOpenActivity } from "../lib/voiceActivity";
import { useAppStore } from "../store/appStore";
import { WatchTogether } from "./WatchTogether";

const POS_KEY = "activityMiniPos";
const EDGE = 8;

type Pos = { x: number; y: number };

function loadPos(): Pos | null {
  try {
    const v = JSON.parse(localStorage.getItem(POS_KEY) || "null");
    return v && typeof v.x === "number" && typeof v.y === "number" ? v : null;
  } catch {
    return null;
  }
}

/** Keep the mini player inside the window. */
function clampPos(p: Pos, el: HTMLElement | null): Pos {
  const w = el?.offsetWidth ?? 340;
  const h = el?.offsetHeight ?? 160;
  return {
    x: Math.min(Math.max(EDGE, p.x), Math.max(EDGE, window.innerWidth - w - EDGE)),
    y: Math.min(Math.max(EDGE, p.y), Math.max(EDGE, window.innerHeight - h - EDGE)),
  };
}

/** The scrolling area the slot is in (to clip the player to it). */
function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let p = el?.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if (o === "auto" || o === "scroll") return p;
  }
  return null;
}

/**
 * The open Watch/Listen Together player, mounted once for the whole app so
 * it keeps playing when you go to a text channel. In the voice lobby it sits
 * exactly over the lobby's slot; anywhere else it's a mini player.
 */
export function ActivityHost() {
  const open = useMini(openActivity, (a) => a);
  const slot = useMini(activitySlot, (s) => s);
  const host = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<{ left: number; top: number; width: number; clip: string } | null>(null);
  // Mini player: where it was dragged to (null = the default corner).
  const [pos, setPos] = useState<Pos | null>(loadPos);
  const drag = useRef<{ id: number; dx: number; dy: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  // Still inside the window after it's resized.
  useEffect(() => {
    const onResize = () => setPos((p) => (p ? clampPos(p, host.current) : p));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Docked: follow the slot (layout, resizes, scrolling). No per-frame loop.
  useLayoutEffect(() => {
    if (!slot) {
      setRect(null);
      return;
    }
    const scroller = scrollParent(slot.el);
    const update = () => {
      const r = slot.el.getBoundingClientRect();
      const box = scroller?.getBoundingClientRect();
      // Hide what's scrolled out of the lobby (under its header).
      const clipTop = box ? Math.max(0, box.top - r.top) : 0;
      const clipBottom = box ? Math.max(0, r.bottom - box.bottom) : 0;
      setRect({ left: r.left, top: r.top, width: r.width, clip: `inset(${clipTop}px 0 ${clipBottom}px 0)` });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(slot.el);
    ro.observe(document.body);
    if (scroller) ro.observe(scroller);
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [slot]);

  // Tell the lobby how tall the player is, so it leaves that much room.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const ro = new ResizeObserver(() => activityHeight.set(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [open]);

  if (!open) return null;

  const docked = Boolean(slot && rect);
  const style: CSSProperties | undefined = docked
    ? { left: rect!.left, top: rect!.top, width: rect!.width, clipPath: rect!.clip }
    : pos
      ? { left: pos.x, top: pos.y, right: "auto", bottom: "auto" }
      : undefined;

  // Drag the mini player by its header (not by its buttons).
  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (docked || e.button !== 0) return;
    const t = e.target as HTMLElement;
    if (!t.closest(".watch-header") || t.closest("button")) return;
    const r = e.currentTarget.getBoundingClientRect();
    drag.current = { id: e.pointerId, dx: e.clientX - r.left, dy: e.clientY - r.top };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* pointer already gone */
    }
    setDragging(true);
    e.preventDefault();
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    setPos(clampPos({ x: e.clientX - d.dx, y: e.clientY - d.dy }, host.current));
  }

  function onPointerUp(e: PointerEvent<HTMLDivElement>) {
    if (!drag.current || drag.current.id !== e.pointerId) return;
    drag.current = null;
    setDragging(false);
    try {
      if (pos) localStorage.setItem(POS_KEY, JSON.stringify(pos));
    } catch {
      /* ignore */
    }
  }

  async function goToChannel() {
    const { channelsByServer, activeServerId, selectServer, selectChannel } = useAppStore.getState();
    const ch = Object.values(channelsByServer)
      .flat()
      .find((c) => c.id === open!.channelId);
    if (!ch) return;
    if (ch.server_id !== activeServerId) await selectServer(ch.server_id);
    await selectChannel(ch.id);
  }

  return (
    <div
      ref={host}
      className={`activity-host${docked ? " is-docked" : " is-mini"}${dragging ? " is-dragging" : ""}`}
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={(e) => {
        // Double-click the header: back to the default corner.
        const t = e.target as HTMLElement;
        if (docked || !t.closest(".watch-header") || t.closest("button")) return;
        setPos(null);
        try {
          localStorage.removeItem(POS_KEY);
        } catch {
          /* ignore */
        }
      }}
    >
      <WatchTogether
        key={`${open.channelId}:${open.id}`}
        kind={open.id}
        channelId={open.channelId}
        compact={docked ? slot!.compact : true}
        onExpand={docked ? slot!.expand : () => void goToChannel()}
        onClose={() => setOpenActivity(open.channelId, null)}
      />
    </div>
  );
}

/** The lobby's placeholder: reserves room and tells the host where to draw. */
export function ActivitySlotBox({ compact, onExpand, className }: { compact: boolean; onExpand: () => void; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const height = useMini(activityHeight, (h) => h);
  const expandRef = useRef(onExpand);
  expandRef.current = onExpand;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    activitySlot.set({ el, compact, expand: () => expandRef.current() });
    return () => {
      if (activitySlot.get()?.el === el) activitySlot.set(null);
    };
  }, [compact]);

  return <div ref={ref} className={className} style={{ height }} aria-hidden />;
}

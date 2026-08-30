import type { DragEvent } from "react";
import type { Channel } from "../../types";
import { DND_MIME, type DragPayload, type DropHint } from "./types";

/** Parse drag payload from dataTransfer (custom MIME or text fallback). */
export function readDragPayload(e: DragEvent): DragPayload | null {
  try {
    const raw =
      e.dataTransfer.getData(DND_MIME) ||
      e.dataTransfer.getData("text/plain");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DragPayload;
    if (parsed?.kind !== "category" && parsed?.kind !== "channel") return null;
    if (typeof parsed.id !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Reorder categories by moving one category before another (or to end). */
export function moveCategory(
  all: Channel[],
  draggedId: string,
  beforeCategoryId: string | null,
): Channel[] {
  const cats = all
    .filter((c) => c.channel_type === "category")
    .slice()
    .sort((a, b) => a.position - b.position);
  const moving = cats.find((c) => c.id === draggedId);
  if (!moving) return all;
  const without = cats.filter((c) => c.id !== draggedId);
  let idx = beforeCategoryId
    ? without.findIndex((c) => c.id === beforeCategoryId)
    : without.length;
  if (idx < 0) idx = without.length;
  without.splice(idx, 0, moving);
  const byId = new Map(
    without.map((c, i) => [c.id, { ...c, position: i }] as const),
  );
  return all.map((c) => byId.get(c.id) || c);
}

/** Move a channel into a category and/or before a sibling channel. */
export function moveChannel(
  all: Channel[],
  draggedId: string,
  categoryId: string | null,
  beforeChannelId: string | null,
): Channel[] {
  const moving = all.find(
    (c) => c.id === draggedId && c.channel_type !== "category",
  );
  if (!moving) return all;
  const siblings = all
    .filter(
      (c) =>
        c.channel_type !== "category" &&
        c.category_id === categoryId &&
        c.id !== draggedId,
    )
    .slice()
    .sort((a, b) => a.position - b.position);
  let idx = beforeChannelId
    ? siblings.findIndex((c) => c.id === beforeChannelId)
    : siblings.length;
  if (idx < 0) idx = siblings.length;
  const nextSiblings = [...siblings];
  nextSiblings.splice(idx, 0, { ...moving, category_id: categoryId });
  const byId = new Map(
    nextSiblings.map(
      (c, i) =>
        [c.id, { ...c, category_id: categoryId, position: i }] as const,
    ),
  );
  return all.map((c) => byId.get(c.id) || c);
}

/** Whether a drop hint is valid for the current drag payload. */
export function isDropAllowed(
  payload: DragPayload,
  hint: DropHint,
): boolean {
  if (payload.kind === "category") {
    if (hint.zone !== "category-before" && hint.zone !== "category-end") {
      return false;
    }
    if (hint.zone === "category-before" && hint.categoryId === payload.id) {
      return false;
    }
    return true;
  }
  if (hint.zone === "category-before" || hint.zone === "category-end") {
    return false;
  }
  if (hint.zone === "channel-before" && hint.channelId === payload.id) {
    return false;
  }
  return true;
}

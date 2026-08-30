import { useCallback, useRef, useState, type DragEvent } from "react";
import { isDropAllowed, moveCategory, moveChannel, readDragPayload } from "./dnd";
import type { DragPayload, DropHint } from "./types";
import { DND_MIME } from "./types";

type UseChannelDnDOptions = {
  canManageChannels: boolean;
  activeServerId: string | null;
  channels: import("../../types").Channel[];
  applyChannelOrder: (serverId: string, next: import("../../types").Channel[]) => Promise<void>;
  setCollapsed: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
};

/** Drag-and-drop reorder state and handlers for the channel list. */
export function useChannelDnD({
  canManageChannels,
  activeServerId,
  channels,
  applyChannelOrder,
  setCollapsed,
}: UseChannelDnDOptions) {
  const [dragging, setDragging] = useState<DragPayload | null>(null);
  const [dropHint, setDropHint] = useState<DropHint | null>(null);
  const dragPayloadRef = useRef<DragPayload | null>(null);
  const suppressClickRef = useRef(false);
  const reorderBusyRef = useRef(false);

  const onDragStart = useCallback(
    (kind: DragPayload["kind"], id: string, e: DragEvent) => {
      if (!canManageChannels) {
        e.preventDefault();
        return;
      }
      const target = e.target as HTMLElement;
      if (target.closest("button.category-add, button.channel-gear")) {
        e.preventDefault();
        return;
      }
      const payload: DragPayload = { kind, id };
      dragPayloadRef.current = payload;
      setDragging(payload);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData(DND_MIME, JSON.stringify(payload));
      e.dataTransfer.setData("text/plain", JSON.stringify(payload));
    },
    [canManageChannels],
  );

  const onDragEnd = useCallback(() => {
    if (dragPayloadRef.current) suppressClickRef.current = true;
    dragPayloadRef.current = null;
    setDragging(null);
    setDropHint(null);
  }, []);

  const clearDropHint = useCallback(() => {
    setDropHint(null);
  }, []);

  const resetDnD = useCallback(() => {
    dragPayloadRef.current = null;
    setDragging(null);
    setDropHint(null);
  }, []);

  const currentPayload = useCallback(
    (e: DragEvent): DragPayload | null =>
      dragPayloadRef.current || readDragPayload(e),
    [],
  );

  const allowDrop = useCallback(
    (e: DragEvent, hint: DropHint) => {
      const payload = currentPayload(e);
      if (!payload || !isDropAllowed(payload, hint)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setDropHint(hint);
    },
    [currentPayload],
  );

  const commitDrop = useCallback(
    async (e: DragEvent, hint: DropHint) => {
      e.preventDefault();
      e.stopPropagation();
      const payload = currentPayload(e);
      setDropHint(null);
      setDragging(null);
      dragPayloadRef.current = null;
      if (!canManageChannels || !payload || !activeServerId || reorderBusyRef.current) {
        return;
      }

      let next = channels;
      if (payload.kind === "category") {
        if (hint.zone === "category-before") {
          next = moveCategory(channels, payload.id, hint.categoryId);
        } else if (hint.zone === "category-end") {
          next = moveCategory(channels, payload.id, null);
        } else {
          return;
        }
      } else if (payload.kind === "channel") {
        if (hint.zone === "category-into") {
          next = moveChannel(channels, payload.id, hint.categoryId, null);
          setCollapsed((prev) => ({ ...prev, [hint.categoryId]: false }));
        } else if (hint.zone === "channel-before") {
          next = moveChannel(
            channels,
            payload.id,
            hint.categoryId,
            hint.channelId,
          );
        } else if (hint.zone === "uncategorized-into") {
          next = moveChannel(channels, payload.id, null, null);
          setCollapsed((prev) => ({ ...prev, uncategorized: false }));
        } else {
          return;
        }
      } else {
        return;
      }

      const changed = next.some((c) => {
        const o = channels.find((x) => x.id === c.id);
        return (
          !o ||
          o.position !== c.position ||
          o.category_id !== c.category_id
        );
      });
      if (!changed) return;

      reorderBusyRef.current = true;
      try {
        await applyChannelOrder(activeServerId, next);
      } catch {
        /* store rolls back */
      } finally {
        reorderBusyRef.current = false;
      }
    },
    [
      activeServerId,
      applyChannelOrder,
      canManageChannels,
      channels,
      currentPayload,
      setCollapsed,
    ],
  );

  const guardClick = useCallback((): boolean => {
    if (!suppressClickRef.current) return false;
    suppressClickRef.current = false;
    return true;
  }, []);

  return {
    dragging,
    dropHint,
    onDragStart,
    onDragEnd,
    clearDropHint,
    resetDnD,
    currentPayload,
    allowDrop,
    commitDrop,
    guardClick,
  };
}

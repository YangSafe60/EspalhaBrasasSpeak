import type { DragEvent, MouseEvent } from "react";
import type { DragPayload, DropHint } from "./types";

export type CategoryHeaderProps = {
  collapseKey: string;
  label: string;
  categoryId: string | null;
  isCollapsed: boolean;
  canManageChannels: boolean;
  showCreateCategory?: boolean;
  busy: boolean;
  dropHint: DropHint | null;
  dragging: DragPayload | null;
  onToggleCollapse: (key: string) => void;
  onCreateCategory: () => void;
  onCreateChannel: (categoryId: string | null) => void;
  onOpenSettings: (e: MouseEvent, channelId: string) => void;
  onPromoteUncategorized: (e: MouseEvent) => void;
  onDragStart: (kind: DragPayload["kind"], id: string, e: DragEvent) => void;
  onDragEnd: () => void;
  currentPayload: (e: DragEvent) => DragPayload | null;
  allowDrop: (e: DragEvent, hint: DropHint) => void;
  commitDrop: (e: DragEvent, hint: DropHint) => void;
  guardClick: () => boolean;
};

/** Collapsible category header with create/edit actions and drop targets. */
export function CategoryHeader(props: CategoryHeaderProps) {
  const {
    collapseKey,
    label,
    categoryId,
    isCollapsed,
    canManageChannels,
    showCreateCategory,
    busy,
    dropHint,
    dragging,
    onToggleCollapse,
    onCreateCategory,
    onCreateChannel,
    onOpenSettings,
    onPromoteUncategorized,
    onDragStart,
    onDragEnd,
    currentPayload,
    allowDrop,
    commitDrop,
    guardClick,
  } = props;

  const isReal = !!categoryId;
  const beforeHint =
    isReal &&
    dropHint?.zone === "category-before" &&
    dropHint.categoryId === categoryId;
  const intoHint =
    (isReal &&
      dropHint?.zone === "category-into" &&
      dropHint.categoryId === categoryId) ||
    (!isReal && dropHint?.zone === "category-end");
  const uncatHint = !isReal && dropHint?.zone === "uncategorized-into";
  const isDraggingSelf =
    isReal && dragging?.kind === "category" && dragging.id === categoryId;

  return (
    <div
      className={`category-header ${beforeHint ? "drop-before" : ""} ${intoHint || uncatHint ? "drop-into" : ""} ${isDraggingSelf ? "is-dragging" : ""}`}
      draggable={isReal && canManageChannels}
      onDragStart={
        isReal && canManageChannels
          ? (e) => onDragStart("category", categoryId, e)
          : undefined
      }
      onDragEnd={isReal && canManageChannels ? onDragEnd : undefined}
      onDragOver={(e) => {
        if (isReal) {
          const payload = currentPayload(e);
          if (payload?.kind === "category") {
            allowDrop(e, { zone: "category-before", categoryId });
          } else if (payload?.kind === "channel") {
            allowDrop(e, { zone: "category-into", categoryId });
          }
        } else {
          const payload = currentPayload(e);
          if (payload?.kind === "channel") {
            allowDrop(e, { zone: "uncategorized-into" });
          } else if (payload?.kind === "category") {
            allowDrop(e, { zone: "category-end" });
          }
        }
      }}
      onDrop={(e) => {
        if (isReal) {
          const payload = currentPayload(e);
          if (payload?.kind === "category") {
            void commitDrop(e, { zone: "category-before", categoryId });
          } else if (payload?.kind === "channel") {
            void commitDrop(e, { zone: "category-into", categoryId });
          }
        } else {
          const payload = currentPayload(e);
          if (payload?.kind === "channel") {
            void commitDrop(e, { zone: "uncategorized-into" });
          } else if (payload?.kind === "category") {
            void commitDrop(e, { zone: "category-end" });
          }
        }
      }}
    >
      <button
        type="button"
        className="category-toggle"
        onClick={() => {
          if (guardClick()) return;
          onToggleCollapse(collapseKey);
        }}
        title={isCollapsed ? "Expand" : "Collapse"}
      >
        <span className={`category-chevron${isCollapsed ? " closed" : ""}`}>▾</span>
        <span className="category-label-text">{label}</span>
      </button>
      {canManageChannels && (
        <div className="category-actions">
          {showCreateCategory && (
            <button
              type="button"
              className="category-add"
              title="Create category"
              onClick={(e) => {
                e.stopPropagation();
                onCreateCategory();
              }}
            >
              ▤
            </button>
          )}
          <button
            type="button"
            className="category-add"
            title="Create channel"
            onClick={(e) => {
              e.stopPropagation();
              onCreateChannel(categoryId);
            }}
          >
            +
          </button>
          {categoryId ? (
            <button
              type="button"
              className="category-add"
              title="Edit category"
              onClick={(e) => onOpenSettings(e, categoryId)}
            >
              ⚙
            </button>
          ) : (
            <button
              type="button"
              className="category-add"
              title="Edit category"
              disabled={busy}
              onClick={(e) => onPromoteUncategorized(e)}
            >
              ⚙
            </button>
          )}
        </div>
      )}
    </div>
  );
}

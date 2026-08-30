import type { AppState } from "../store/appStoreTypes";
import type { DmChannel, MessageToast } from "../types";
import { isAppFocused } from "./appFocus";
import { showDesktopNotification } from "./desktopNotify";
import { playFriendRequestNotify, playMessageNotify } from "./messageNotify";

export function isDmNotificationsMuted(
  state: AppState,
  dm: DmChannel | undefined,
): boolean {
  if (!dm?.friendship_id) return false;
  const lists = [
    ...state.friends,
    ...state.pendingInbound,
    ...state.pendingOutbound,
  ];
  const friendship = lists.find((f) => f.id === dm.friendship_id);
  return Boolean(friendship?.muted);
}

/** Whether to play a sound / show the in-app toast for this conversation. */
export function shouldAlertConversation(
  state: AppState,
  conversationActive: boolean,
): boolean {
  if (!conversationActive) return true;
  if (!isAppFocused()) return true;
  if (state.friendsHome) return true;
  return false;
}

export function deliverMessageAlert(opts: {
  toast: MessageToast;
  pushToast: (toast: MessageToast) => void;
  onOpen: () => void | Promise<void>;
  playSound?: boolean;
}): void {
  if (opts.playSound !== false) playMessageNotify();
  opts.pushToast(opts.toast);
  showDesktopNotification({
    title: opts.toast.authorName,
    body: opts.toast.preview,
    tag: opts.toast.id,
    onClick: () => void opts.onOpen(),
  });
}

export function deliverFriendRequestAlert(opts: {
  toast: MessageToast;
  pushToast: (toast: MessageToast) => void;
  onOpen: () => void | Promise<void>;
}): void {
  playFriendRequestNotify();
  opts.pushToast(opts.toast);
  showDesktopNotification({
    title: opts.toast.authorName,
    body: opts.toast.preview,
    tag: opts.toast.id,
    onClick: () => void opts.onOpen(),
  });
}

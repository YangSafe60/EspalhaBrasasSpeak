import { miniStore } from "./miniStore";

/**
 * Where the voice lobby wants the activity player drawn. The player itself
 * lives in <ActivityHost> (App level) so it never unmounts (an iframe that's
 * moved or remounted reloads and the music stops); it just sits over this
 * spot while the lobby is on screen, and becomes a mini player otherwise.
 */
export type ActivitySlot = {
  el: HTMLElement;
  /** Small beside a live stream. */
  compact: boolean;
  expand: () => void;
};

export const activitySlot = miniStore<ActivitySlot | null>(null);

/** The player's height, so the lobby reserves that much room for it. */
export const activityHeight = miniStore<number>(0);

import { create } from "zustand";
import type { AppState } from "./appStoreTypes";
import { createInitialState } from "./initialState";
import { createAuthSlice } from "./slices/authSlice";
import { createMediaSlice } from "./slices/mediaSlice";
import { createMessagingSlice } from "./slices/messagingSlice";
import { createServerSlice } from "./slices/serverSlice";
import { createSocialSlice } from "./slices/socialSlice";
import { createUiSlice } from "./slices/uiSlice";
import { createWsSlice } from "./slices/wsSlice";

export type { ModalKind, MiniProfileState } from "./appStoreTypes";

export const useAppStore = create<AppState>()((...args) =>
  ({
    ...createInitialState(),
    ...createUiSlice(...args),
    ...createAuthSlice(...args),
    ...createServerSlice(...args),
    ...createMessagingSlice(...args),
    ...createSocialSlice(...args),
    ...createMediaSlice(...args),
    ...createWsSlice(...args),
  }) as AppState,
);

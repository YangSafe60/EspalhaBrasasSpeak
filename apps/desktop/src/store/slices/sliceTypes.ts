import type { StateCreator } from "zustand";
import type { AppState } from "../appStoreTypes";

export type AppStoreSlice = StateCreator<AppState, [], [], Partial<AppState>>;

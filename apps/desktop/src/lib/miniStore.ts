import { useSyncExternalStore } from "react";

/** A tiny observable value for state that lives outside the main store. */
export function miniStore<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next: T | ((prev: T) => T)) {
      value = typeof next === "function" ? (next as (p: T) => T)(value) : next;
      for (const l of listeners) l();
    },
    subscribe(cb: () => void) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };
}

export type MiniStore<T> = ReturnType<typeof miniStore<T>>;

/** Read a slice of a mini store in a component. */
export function useMini<T, R>(store: MiniStore<T>, pick: (v: T) => R): R {
  return useSyncExternalStore(store.subscribe, () => pick(store.get()));
}

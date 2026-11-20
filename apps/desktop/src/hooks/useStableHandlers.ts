import { useLayoutEffect, useMemo, useRef } from "react";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;

/**
 * Returns an object with the same functions whose identity never changes but
 * which always call the latest version. Lets a parent pass callbacks to
 * memoized children without breaking their memoization.
 */
export function useStableHandlers<T extends Record<string, AnyFn>>(handlers: T): T {
  const latest = useRef(handlers);
  useLayoutEffect(() => {
    latest.current = handlers;
  });
  return useMemo(() => {
    const out: Record<string, AnyFn> = {};
    for (const key of Object.keys(latest.current)) {
      out[key] = (...args: unknown[]) => latest.current[key](...args);
    }
    return out as T;
  }, []);
}

"use client";

import { useEffect } from "react";

/**
 * Runs a callback once on mount and then at a fixed interval.
 * Caller should memoize the callback with useCallback and guard state updates
 * with a mounted ref when the callback is async.
 */
export function usePolling(
  fn: () => void | Promise<void>,
  intervalMs: number
): void {
  useEffect(() => {
    fn();
    const id = setInterval(fn, intervalMs);
    return () => clearInterval(id);
  }, [fn, intervalMs]);
}

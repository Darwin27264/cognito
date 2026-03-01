/**
 * Fetch with timeout and optional Next.js revalidate.
 * Used by API route handlers to avoid hanging on slow upstreams.
 */

const DEFAULT_TIMEOUT_MS = 12_000;

export interface FetchWithTimeoutOptions extends RequestInit {
  timeoutMs?: number;
  revalidate?: number;
}

/**
 * Performs fetch with an abort signal tied to a timeout.
 * Throws if the request is aborted (timeout or explicit abort).
 */
export async function fetchWithTimeout(
  url: string,
  options: FetchWithTimeoutOptions = {}
): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, revalidate, ...init } = options;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      ...(revalidate != null && { next: { revalidate } }),
    });
    return res;
  } finally {
    clearTimeout(timeoutId);
  }
}

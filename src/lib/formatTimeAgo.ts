/**
 * Format an ISO timestamp as human-readable "time ago" and exact time.
 * Used for "data last refreshed" in map popups and panels.
 */

export function formatTimeAgo(isoTimestamp: string | null | undefined): string {
  if (!isoTimestamp) return "—";
  const then = new Date(isoTimestamp).getTime();
  if (!Number.isFinite(then)) return "—";
  const diffMs = Date.now() - then;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffMs / 60_000);
  const diffH = Math.floor(diffMs / 3_600_000);
  const diffD = Math.floor(diffMs / 86_400_000);

  if (diffSec < 10) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffH < 24) return `${diffH}h ${diffMin % 60}m ago`;
  if (diffD < 7) return `${diffD}d ago`;
  return new Date(then).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: diffD >= 365 ? "numeric" : undefined,
  });
}

export function formatExactTime(isoTimestamp: string | null | undefined): string {
  if (!isoTimestamp) return "—";
  const d = new Date(isoTimestamp);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

/**
 * Centralized API fetch intervals and cache settings.
 * Intervals are chosen to respect free-tier rate limits while keeping data reasonably fresh.
 */

/** OpenSky Network: anonymous limit ~1 req/10s (6/min). Poll at 60s for headroom. */
export const FLIGHTS_POLL_MS = 60 * 1000;

/** GDELT: rate-limited; server caches 1h with background refresh. Client poll 10 min. */
export const GDELT_POLL_MS = 10 * 60 * 1000;

/** USGS: feed cached 60s. Poll every 2 min to avoid redundant requests. */
export const SEISMIC_POLL_MS = 2 * 60 * 1000;

/** NASA FIRMS: 5000 tx/10 min. Server revalidate 1h; client poll 15 min. */
export const FIRES_POLL_MS = 15 * 60 * 1000;

/** Finnhub 60/min, Twelve Data 8/min. Single batch per poll; 5 min keeps well under limits. */
export const MARKETS_POLL_MS = 5 * 60 * 1000;

/** NewsAPI free tier: 100 req/day. 30 min ≈ 48 req/day. */
export const INTEL_POLL_MS = 30 * 60 * 1000;

/** IODA: no documented limit; server cache 15 min. Client poll 1 min for status. */
export const CYBER_POLL_MS = 60 * 1000;

/** Commodities endpoint returns static/empty; 4 min reduces unnecessary calls. */
export const COMMODITIES_POLL_MS = 4 * 60 * 1000;

/** Threat level from GDELT; same as GDELT to avoid extra GDELT hits. */
export const THREAT_LEVEL_POLL_MS = GDELT_POLL_MS;

/** Satellite TLE: CelesTrak no key; revalidate 12h. Position updates are client-side only. */
export const SATELLITES_REVALIDATE_SEC = 43200;

/** Client-side orbital position propagation interval (no API call). */
export const SATELLITE_POSITION_UPDATE_MS = 1000;

/** Max wait before dismissing initial map load overlay (fallback if a feed never resolves). */
export const INITIAL_LOAD_TIMEOUT_MS = 25_000;

/** AIS maritime: server caches 60s per bbox; client poll at most this often to respect API limits. */
export const AIS_POLL_MS = 30 * 1000;

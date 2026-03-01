import { NextRequest, NextResponse } from "next/server";

export const revalidate = 60;

type OpenSkyState = (string | number | boolean | null)[];

interface OpenSkyResponse {
  time: number;
  states: OpenSkyState[] | null;
}

/** adsb.fi opendata API v2 lat/lon/dist response (array of aircraft). */
interface AdsbFiAircraft {
  hex?: string;
  lat?: number;
  lon?: number;
  alt_baro?: number | null;
  alt_geom?: number | null;
  gs?: number | null;
  flight?: string | null;
  track?: number | null;
}

export interface UnifiedFlight {
  id: string;
  callsign: string;
  lat: number;
  lon: number;
  altitude: number | null;
  velocity: number | null;
  heading: number | null;
  source: "opensky" | "adsbfi" | "adsblol" | "theairtraffic";
  origin?: string;
}

/** Allow OpenSky to be disabled entirely from env when rate-limited or unavailable. */
const OPENSKY_ENABLED =
  process.env.OPEN_SKY_ENABLED === undefined ||
  !["0", "false", "off"].includes(process.env.OPEN_SKY_ENABLED.toLowerCase());

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function cacheKey(lamin: number, lomin: number, lamax: number, lomax: number): string {
  return `${lamin},${lomin},${lamax},${lomax}`;
}

/** Bbox to center (lat, lon) and approximate radius in NM for adsb.fi (max 250 NM). */
function bboxToCenterAndDistNm(
  lamin: number,
  lomin: number,
  lamax: number,
  lomax: number
): { lat: number; lon: number; distNm: number } {
  const lat = (lamin + lamax) / 2;
  const lon = (lomin + lomax) / 2;
  const latSpan = Math.abs(lamax - lamin);
  const lngSpan = Math.abs(lomax - lomin);
  const degToNmLat = 60;
  const degToNmLng = 60 * Math.cos((lat * Math.PI) / 180);
  const halfDiagNm = 0.5 * Math.sqrt(
    Math.pow(latSpan * degToNmLat, 2) + Math.pow(lngSpan * degToNmLng, 2)
  );
  const distNm = Math.min(250, Math.max(1, Math.ceil(halfDiagNm)));
  return { lat, lon, distNm };
}

const FETCH_OPTS = { next: { revalidate: 60 } as const };

interface OpenSkyRateLimitInfo {
  remaining: number | null;
  retryAfterSeconds: number | null;
}

let lastGoodFlights: UnifiedFlight[] | null = null;
let lastGoodTimestamp: string | null = null;
let lastGoodBbox: { lamin: number; lomin: number; lamax: number; lomax: number } | null =
  null;

async function fetchOpenSky(
  lamin: number,
  lomin: number,
  lamax: number,
  lomax: number
): Promise<{ flights: UnifiedFlight[]; status: number | null; rateLimit: OpenSkyRateLimitInfo }> {
  if (!OPENSKY_ENABLED) {
    return {
      flights: [],
      status: null,
      rateLimit: { remaining: null, retryAfterSeconds: null },
    };
  }

  const url =
    `https://opensky-network.org/api/states/all` +
    `?lamin=${lamin}&lomin=${lomin}&lamax=${lamax}&lomax=${lomax}`;
  const res = await fetch(url, FETCH_OPTS);
  const remainingHeader = res.headers.get("x-rate-limit-remaining");
  const retryHeader = res.headers.get("x-rate-limit-retry-after-seconds");
  const rateLimit: OpenSkyRateLimitInfo = {
    remaining: remainingHeader != null && !Number.isNaN(Number(remainingHeader))
      ? Number(remainingHeader)
      : null,
    retryAfterSeconds: retryHeader != null && !Number.isNaN(Number(retryHeader))
      ? Number(retryHeader)
      : null,
  };
  if (!res.ok) {
    return { flights: [], status: res.status, rateLimit };
  }
  const json: OpenSkyResponse = await res.json();
  const states = json.states ?? [];
  const flights = states
    .filter((s: OpenSkyState) => s[5] != null && s[6] != null && !s[8])
    .map((s: OpenSkyState) => {
      const icao24 = String(s[0] ?? "").trim().toLowerCase();
      return {
        id: icao24,
        callsign: ((s[1] as string) ?? "").trim(),
        lat: s[6] as number,
        lon: s[5] as number,
        altitude: (s[7] as number) ?? null,
        velocity: (s[9] as number) ?? null,
        heading: (s[10] as number) ?? null,
        source: "opensky" as const,
        origin: (s[2] as string) ?? undefined,
      };
    });
  return { flights, status: res.status, rateLimit };
}

async function fetchAdsbFi(
  lat: number,
  lon: number,
  distNm: number
): Promise<{ flights: UnifiedFlight[]; status: number | null }> {
  const url = `https://opendata.adsb.fi/api/v2/lat/${lat}/lon/${lon}/dist/${Math.round(distNm)}`;
  const res = await fetch(url, FETCH_OPTS);
  if (!res.ok) return { flights: [], status: res.status };
  const data = await res.json();
  const acft: AdsbFiAircraft[] = Array.isArray(data)
    ? data
    : data?.ac ?? (data as { aircraft?: AdsbFiAircraft[] })?.aircraft ?? [];
  const flights = acft
    .filter((a) => a.lat != null && a.lon != null && a.hex)
    .map((a) => {
      const hex = (a.hex ?? "").toString().trim().toLowerCase();
      const alt = a.alt_baro ?? a.alt_geom ?? null;
      const gs = a.gs ?? null;
      const track = a.track ?? null;
      return {
        id: hex,
        callsign: (a.flight ?? "").toString().trim(),
        lat: a.lat!,
        lon: a.lon!,
        altitude: alt != null ? Number(alt) : null,
        velocity: gs != null ? Number(gs) : null,
        heading: track != null ? Number(track) : null,
        source: "adsbfi" as const,
        origin: undefined,
      };
    });
  return { flights, status: res.status };
}

async function fetchAdsbLol(
  lat: number,
  lon: number,
  distNm: number
): Promise<{ flights: UnifiedFlight[]; status: number | null }> {
  const url = `https://api.adsb.lol/v2/lat/${lat}/lon/${lon}/dist/${Math.round(distNm)}`;
  const res = await fetch(url, FETCH_OPTS);
  if (!res.ok) return { flights: [], status: res.status };
  const data = await res.json();
  const acft: AdsbFiAircraft[] = Array.isArray(data)
    ? data
    : data?.ac ?? (data as { aircraft?: AdsbFiAircraft[] })?.aircraft ?? [];
  const flights = acft
    .filter((a) => a.lat != null && a.lon != null && a.hex)
    .map((a) => {
      const hex = (a.hex ?? "").toString().trim().toLowerCase();
      const alt = a.alt_baro ?? a.alt_geom ?? null;
      const gs = a.gs ?? null;
      const track = a.track ?? null;
      return {
        id: hex,
        callsign: (a.flight ?? "").toString().trim(),
        lat: a.lat!,
        lon: a.lon!,
        altitude: alt != null ? Number(alt) : null,
        velocity: gs != null ? Number(gs) : null,
        heading: track != null ? Number(track) : null,
        source: "adsblol" as const,
        origin: undefined,
      };
    });
  return { flights, status: res.status };
}

async function fetchTheAirTraffic(
  lat: number,
  lon: number,
  distNm: number
): Promise<{ flights: UnifiedFlight[]; status: number | null }> {
  const url = `https://api.theairtraffic.com/v2/lat/${lat}/lon/${lon}/dist/${Math.round(distNm)}`;
  const res = await fetch(url, FETCH_OPTS);
  if (!res.ok) return { flights: [], status: res.status };
  const data = await res.json();
  const acft: AdsbFiAircraft[] = Array.isArray(data)
    ? data
    : data?.ac ?? (data as { aircraft?: AdsbFiAircraft[] })?.aircraft ?? [];
  const flights = acft
    .filter((a) => a.lat != null && a.lon != null && a.hex)
    .map((a) => {
      const hex = (a.hex ?? "").toString().trim().toLowerCase();
      const alt = a.alt_baro ?? a.alt_geom ?? null;
      const gs = a.gs ?? null;
      const track = a.track ?? null;
      return {
        id: hex,
        callsign: (a.flight ?? "").toString().trim(),
        lat: a.lat!,
        lon: a.lon!,
        altitude: alt != null ? Number(alt) : null,
        velocity: gs != null ? Number(gs) : null,
        heading: track != null ? Number(track) : null,
        source: "theairtraffic" as const,
        origin: undefined,
      };
    });
  return { flights, status: res.status };
}

/** Deduplicate by id (hex), keeping first occurrence. */
function dedupeById(flights: UnifiedFlight[]): UnifiedFlight[] {
  const seen = new Set<string>();
  return flights.filter((f) => {
    const key = f.id.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;

  const lamin = clamp(Number(searchParams.get("lamin")) ?? -90, -90, 90);
  const lamax = clamp(Number(searchParams.get("lamax")) ?? 90, -90, 90);
  const lomin = clamp(Number(searchParams.get("lomin")) ?? -180, -180, 180);
  const lomax = clamp(Number(searchParams.get("lomax")) ?? 180, -180, 180);

  const bbox = { lamin, lomin, lamax, lomax };
  const { lat, lon, distNm } = bboxToCenterAndDistNm(lamin, lomin, lamax, lomax);

  let openskyFlights: UnifiedFlight[] = [];
  let adsbfiFlights: UnifiedFlight[] = [];
  let adsbLolFlights: UnifiedFlight[] = [];
  let theAirTrafficFlights: UnifiedFlight[] = [];
  let openskyStatus: number | null = null;
  let openskyRateLimit: OpenSkyRateLimitInfo = {
    remaining: null,
    retryAfterSeconds: null,
  };
  let adsbfiStatus: number | null = null;
  let adsbLolStatus: number | null = null;
  let theAirTrafficStatus: number | null = null;

  try {
    const [openSkyResult, adsbFiResult, adsbLolResult, theAirTrafficResult] = await Promise.all([
      fetchOpenSky(lamin, lomin, lamax, lomax)
        .then((res) => {
          openskyStatus = res.status;
          openskyRateLimit = res.rateLimit;
          return res.flights;
        })
        .catch(() => []),
      fetchAdsbFi(lat, lon, distNm)
        .then((res) => {
          adsbfiStatus = res.status;
          return res.flights;
        })
        .catch(() => []),
      fetchAdsbLol(lat, lon, distNm)
        .then((res) => {
          adsbLolStatus = res.status;
          return res.flights;
        })
        .catch(() => []),
      fetchTheAirTraffic(lat, lon, distNm)
        .then((res) => {
          theAirTrafficStatus = res.status;
          return res.flights;
        })
        .catch(() => []),
    ]);
    openskyFlights = openSkyResult;
    adsbfiFlights = adsbFiResult;
    adsbLolFlights = adsbLolResult;
    theAirTrafficFlights = theAirTrafficResult;
  } catch {
    // one or both failed; use whatever we have (statuses remain null)
  }

  const merged = dedupeById([
    ...openskyFlights,
    ...adsbfiFlights,
    ...adsbLolFlights,
    ...theAirTrafficFlights,
  ]);

  let flights: UnifiedFlight[];
  let usedFallback = false;
  let fromCache = false;

  if (merged.length > 0) {
    flights = merged;
    lastGoodFlights = merged;
    lastGoodTimestamp = new Date().toISOString();
    lastGoodBbox = bbox;
  } else if (lastGoodFlights && lastGoodFlights.length > 0) {
    flights = lastGoodFlights;
    fromCache = true;
  } else {
    flights = [];
  }

  return NextResponse.json(
    {
      flights,
      count: flights.length,
      bbox,
      timestamp: new Date().toISOString(),
      dataTimestamp: fromCache && lastGoodTimestamp ? lastGoodTimestamp : null,
      fallback: usedFallback,
      apiStatus: {
        opensky: openskyStatus,
        adsbfi: adsbfiStatus,
        adsblol: adsbLolStatus,
        theairtraffic: theAirTrafficStatus,
      },
      rateLimit: {
        opensky: openskyRateLimit,
      },
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
      },
    }
  );
}

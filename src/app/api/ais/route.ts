import { NextRequest, NextResponse } from "next/server";
import WebSocket from "ws";

/** Aisstream.io does not allow direct browser connections (CORS). This route proxies the stream. */

const AIS_STREAM_URL = "wss://stream.aisstream.io/v0/stream";
const COLLECT_MS = 5000;

/** Cache TTL: same bbox within this window returns cached data to avoid reconnecting to Aisstream. */
const CACHE_TTL_MS = 60 * 1000; // 1 minute
const BBOX_PRECISION = 2; // round to 2 decimals for cache key (reduces fragmentation)

interface CacheEntry {
  ships: AisShipResponse[];
  timestamp: number;
}

const cache = new Map<string, CacheEntry>();

function cacheKey(lamin: number, lomin: number, lamax: number, lomax: number): string {
  const r = (v: number) => v.toFixed(BBOX_PRECISION);
  return `${r(lamin)}_${r(lomin)}_${r(lamax)}_${r(lomax)}`;
}

function getCached(key: string): AisShipResponse[] | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.ships;
}

function setCached(key: string, ships: AisShipResponse[]): void {
  cache.set(key, { ships, timestamp: Date.now() });
  // Cap cache size to avoid unbounded memory (e.g. keep last 50 bboxes)
  if (cache.size > 50) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
    if (oldest) cache.delete(oldest[0]);
  }
}

export interface AisShipResponse {
  mmsi: string;
  lat: number;
  lng: number;
  cog: number | null;
  sog: number | null;
  navStatus?: string;
}

function parsePositionReport(pr: Record<string, unknown>): AisShipResponse | null {
  const rawLat = pr.Latitude ?? pr.lat ?? pr.Lat;
  const rawLon = pr.Longitude ?? pr.lon ?? pr.Lon ?? (pr as Record<string, unknown>).Lng;
  const lat = typeof rawLat === "number" ? rawLat : Number(rawLat);
  const lng = typeof rawLon === "number" ? rawLon : Number(rawLon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const mmsiValue = pr.MMSI ?? pr.Mmsi ?? pr.UserID ?? pr.UserId;
  if (mmsiValue == null) return null;
  const mmsi = String(mmsiValue);
  if (!mmsi) return null;

  const cogVal = pr.Cog ?? pr.cog ?? pr.TrueHeading ?? pr.Heading;
  const sogVal = pr.Sog ?? pr.sog ?? pr.Speed ?? (pr as Record<string, unknown>).SogKmh;
  const cog = typeof cogVal === "number" ? cogVal : Number(cogVal);
  const sog = typeof sogVal === "number" ? sogVal : Number(sogVal);
  const navStatus =
    (pr.NavigationalStatus ?? pr.NavStatus ?? pr.NavigationStatus ?? pr.navStatus) as
      | string
      | undefined;

  return {
    mmsi,
    lat,
    lng,
    cog: Number.isFinite(cog) ? cog : null,
    sog: Number.isFinite(sog) ? sog : null,
    navStatus: typeof navStatus === "string" && navStatus.length > 0 ? navStatus : undefined,
  };
}

export async function GET(req: NextRequest) {
  const apiKey =
    process.env.AISSTREAM_API_KEY ??
    process.env.NEXT_PUBLIC_AISSTREAM_API_KEY ??
    req.headers.get("x-user-aisstream-key")?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { ships: [], error: "AISSTREAM_API_KEY not configured" },
      { headers: { "Cache-Control": "public, s-maxage=0, no-store" } }
    );
  }

  const { searchParams } = req.nextUrl;
  const lamin = Number(searchParams.get("lamin") ?? -90);
  const lomin = Number(searchParams.get("lomin") ?? -180);
  const lamax = Number(searchParams.get("lamax") ?? 90);
  const lomax = Number(searchParams.get("lomax") ?? 180);

  if (!Number.isFinite(lamin) || !Number.isFinite(lomin) || !Number.isFinite(lamax) || !Number.isFinite(lomax)) {
    return NextResponse.json(
      { ships: [], error: "Invalid bounds" },
      { status: 400 }
    );
  }

  const key = cacheKey(lamin, lomin, lamax, lomax);
  const cached = getCached(key);
  if (cached) {
    return NextResponse.json(
      { ships: cached, count: cached.length, timestamp: new Date().toISOString(), cached: true },
      {
        headers: {
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
        },
      }
    );
  }

  const ships = await new Promise<AisShipResponse[]>((resolve) => {
    const byMmsi = new Map<string, AisShipResponse>();
    const ws = new WebSocket(AIS_STREAM_URL);

    const timeout = setTimeout(() => {
      try {
        ws.close();
      } catch {
        // ignore
      }
      resolve(Array.from(byMmsi.values()));
    }, COLLECT_MS);

    ws.on("open", () => {
      const payload = {
        APIKey: apiKey,
        BoundingBoxes: [[[lamax, lomin], [lamin, lomax]]] as [number, number][][],
        FilterMessageTypes: ["PositionReport"],
      };
      ws.send(JSON.stringify(payload));
    });

    ws.on("message", (data: WebSocket.Data) => {
      try {
        const msg = JSON.parse(data.toString()) as {
          Message?: { PositionReport?: Record<string, unknown> };
          error?: string;
        };
        if (msg.error) return;
        const pr = msg.Message?.PositionReport;
        if (!pr) return;
        const ship = parsePositionReport(pr);
        if (ship) byMmsi.set(ship.mmsi, ship);
      } catch {
        // ignore parse errors
      }
    });

    ws.on("error", () => {
      clearTimeout(timeout);
      resolve(Array.from(byMmsi.values()));
    });

    ws.on("close", () => {
      clearTimeout(timeout);
      resolve(Array.from(byMmsi.values()));
    });
  });

  setCached(key, ships);

  return NextResponse.json(
    { ships, count: ships.length, timestamp: new Date().toISOString() },
    {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
      },
    }
  );
}

import { NextRequest, NextResponse } from "next/server";

export const revalidate = 3600;

interface SafecastMeasurement {
  id?: number;
  value: number;
  unit: string;
  device_id?: number | null;
  sensor_id?: number | null;
  station_id?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  /** Some Safecast responses use nested location */
  location?: { latitude?: number; longitude?: number } | null;
  captured_at: string;
}

export interface RadiationSensor {
  lat: number;
  lng: number;
  value: number;
  capturedAt: string;
}

const FETCH_OPTS = { next: { revalidate: 3600 } as const };

function isUsvUnit(unit: string | null | undefined): boolean {
  if (!unit) return false;
  // Safecast returns μSv/h for microsieverts/hour; the API filter is `unit=usv`.
  // Normalize common variants so we don't accidentally discard valid readings.
  const norm = unit.toLowerCase().replace(/[^a-z]/g, "");
  return norm === "usv" || norm === "usvh";
}

function isCpmUnit(unit: string | null | undefined): boolean {
  if (!unit) return false;
  const norm = unit.toLowerCase().replace(/[^a-z]/g, "");
  return norm === "cpm";
}

function toUsvPerHour(value: number, unit: string): number | null {
  if (!Number.isFinite(value)) return null;
  if (isUsvUnit(unit)) return value;
  if (isCpmUnit(unit)) {
    // Best-effort conversion used by Safecast methodology for bGeigie devices:
    // μSv/h ≈ CPM / 350.0
    // Not perfect for all devices, but much better than dropping most data.
    return value / 350.0;
  }
  return null;
}

function getLatLon(m: SafecastMeasurement): { lat: number; lng: number } | null {
  const lat = m.latitude ?? m.location?.latitude;
  const lng = m.longitude ?? m.location?.longitude;
  if (lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)) {
    return { lat: Number(lat), lng: Number(lng) };
  }
  return null;
}

function sensorKey(m: SafecastMeasurement, lat: number, lng: number): string | null {
  const station = m.station_id != null ? `station:${m.station_id}` : null;
  const sensor = m.sensor_id != null ? `sensor:${m.sensor_id}` : null;
  const device = m.device_id != null ? `device:${m.device_id}` : null;
  if (station) return station;
  if (sensor) return sensor;
  if (device) return device;
  return `loc:${lat.toFixed(4)},${lng.toFixed(4)}`;
}

function parseBboxParam(param: string | null, fallback: [number, number]): [number, number] {
  if (!param) return fallback;
  const parts = param.split(",");
  if (parts.length !== 2) return fallback;
  const lat = Number(parts[0]);
  const lon = Number(parts[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return fallback;
  return [lat, lon];
}

/** Regional centers so radiation data covers the whole globe (Safecast uses lat/lng/distance). */
const REGIONS: { lat: number; lng: number; distance: number; perPage: number }[] = [
  { lat: 50, lng: 10, distance: 3500, perPage: 200 },    // Europe (central)
  { lat: 54, lng: -2, distance: 1200, perPage: 150 },    // UK / NW Europe
  { lat: 50, lng: 25, distance: 2000, perPage: 150 },    // Eastern Europe
  { lat: 40, lng: -100, distance: 4000, perPage: 200 },  // US / North America
  { lat: 55, lng: -105, distance: 3000, perPage: 150 },  // Canada
  { lat: 20, lng: -100, distance: 2500, perPage: 150 },  // Mexico / Central America
  { lat: -15, lng: -55, distance: 3500, perPage: 200 },  // South America
  { lat: 35, lng: 135, distance: 3500, perPage: 200 },   // Japan / East Asia
  { lat: 5, lng: 105, distance: 3000, perPage: 150 },    // Southeast Asia
  { lat: 22, lng: 78, distance: 2500, perPage: 150 },    // South Asia (India)
  { lat: 55, lng: 80, distance: 3500, perPage: 150 },    // Russia / Central Asia
  { lat: 30, lng: 45, distance: 2500, perPage: 150 },    // Middle East
  { lat: 0, lng: 25, distance: 4000, perPage: 200 },     // Africa
  { lat: -25, lng: 135, distance: 3000, perPage: 150 }, // Australia / Oceania
];

function buildRegionUrl(region: (typeof REGIONS)[0], page: number): string {
  const url = new URL("https://api.safecast.org/measurements.json");
  url.searchParams.set("per_page", String(region.perPage));
  url.searchParams.set("order", "captured_at+desc");
  url.searchParams.set("page", String(page));
  url.searchParams.set("latitude", String(region.lat));
  url.searchParams.set("longitude", String(region.lng));
  url.searchParams.set("distance", String(region.distance));
  return url.toString();
}

/** Global feed (no geo filter) for additional recent measurements. */
function buildGlobalUrl(page: number): string {
  const url = new URL("https://api.safecast.org/measurements.json");
  url.searchParams.set("per_page", "300");
  url.searchParams.set("order", "captured_at+desc");
  url.searchParams.set("page", String(page));
  return url.toString();
}

function parseMeasurementsResponse(data: unknown): SafecastMeasurement[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object" && Array.isArray((data as { measurements?: unknown }).measurements)) {
    return (data as { measurements: SafecastMeasurement[] }).measurements;
  }
  return [];
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;

  const [lamax, lomax] = parseBboxParam(searchParams.get("bmax"), [90, 180]);
  const [lamin, lomin] = parseBboxParam(searchParams.get("bmin"), [-90, -180]);

  try {
    const bySensor = new Map<string, { sensor: RadiationSensor; capturedMs: number }>();
    const TARGET_UNIQUE = 750;

    // Fetch from all regions in parallel for full global coverage (1 page per region to limit requests).
    const regionRequests = [
      ...REGIONS.map((r) => buildRegionUrl(r, 1)),
      buildGlobalUrl(1),
      buildGlobalUrl(2),
    ];
    const results = await Promise.allSettled(
      regionRequests.map((url) =>
        fetch(url, FETCH_OPTS).then((res) => {
          if (!res.ok) throw new Error(`Safecast ${res.status}`);
          return res.json();
        })
      )
    );

    for (const result of results) {
      if (result.status !== "fulfilled") continue;
      const raw = parseMeasurementsResponse(result.value);
      for (const m of raw) {
        if (!m || m.unit == null) continue;
        const coords = getLatLon(m);
        if (!coords) continue;
        const { lat, lng } = coords;
        if (lat < lamin || lng < lomin || lat > lamax || lng > lomax) continue;

        const usv = toUsvPerHour(Number(m.value), m.unit);
        if (usv == null) continue;

        const key = sensorKey(m, lat, lng);
        if (!key) continue;

        const capturedMs = new Date(m.captured_at).getTime();
        if (!Number.isFinite(capturedMs)) continue;

        const prev = bySensor.get(key);
        if (!prev || capturedMs > prev.capturedMs) {
          bySensor.set(key, {
            capturedMs,
            sensor: {
              lat,
              lng,
              value: usv,
              capturedAt: new Date(capturedMs).toISOString(),
            },
          });
        }
      }
    }

    const sensors: RadiationSensor[] = Array.from(bySensor.values())
      .sort((a, b) => b.capturedMs - a.capturedMs)
      .slice(0, TARGET_UNIQUE)
      .map((v) => v.sensor);

    return NextResponse.json(
      {
        sensors,
        count: sensors.length,
        timestamp: new Date().toISOString(),
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=7200",
        },
      }
    );
  } catch (error) {
    // Ensure we never bubble up a raw 500 from this route.
    return NextResponse.json(
      {
        sensors: [],
        count: 0,
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : "Safecast fetch failed",
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "public, s-maxage=900, stale-while-revalidate=1800",
        },
      }
    );
  }
}


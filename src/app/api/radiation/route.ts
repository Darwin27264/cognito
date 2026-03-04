import { NextRequest, NextResponse } from "next/server";

export const revalidate = 3600;

interface SafecastMeasurement {
  id: number;
  value: number;
  unit: string;
  device_id?: number | null;
  sensor_id?: number | null;
  station_id?: number | null;
  latitude: number | null;
  longitude: number | null;
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

function sensorKey(m: SafecastMeasurement): string | null {
  const station = m.station_id != null ? `station:${m.station_id}` : null;
  const sensor = m.sensor_id != null ? `sensor:${m.sensor_id}` : null;
  const device = m.device_id != null ? `device:${m.device_id}` : null;
  if (station) return station;
  if (sensor) return sensor;
  if (device) return device;
  if (m.latitude == null || m.longitude == null) return null;
  // Fall back to location bucketing (~10m) to represent a "sensor" on the map.
  return `loc:${m.latitude.toFixed(4)},${m.longitude.toFixed(4)}`;
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

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;

  const [lamax, lomax] = parseBboxParam(searchParams.get("bmax"), [90, 180]);
  const [lamin, lomin] = parseBboxParam(searchParams.get("bmin"), [-90, -180]);

  const baseUrl = new URL("https://api.safecast.org/measurements.json");
  baseUrl.searchParams.set("bmax", `${lamax},${lomax}`);
  baseUrl.searchParams.set("bmin", `${lamin},${lomin}`);
  baseUrl.searchParams.set("per_page", "750");
  // Keep newest first so we select the freshest reading per sensor/location.
  baseUrl.searchParams.set("order", "captured_at+desc");

  try {
    // Safecast returns "measurements" (often many per same sensor/location).
    // To avoid stacking hundreds of identical markers, dedupe to unique sensors/locations,
    // keeping the most recent reading for each.
    const bySensor = new Map<string, { sensor: RadiationSensor; capturedMs: number }>();
    const MAX_PAGES = 6; // up to 4500 raw measurements (server-cached for 1h)
    const TARGET_UNIQUE = 750;

    for (let page = 1; page <= MAX_PAGES; page++) {
      const url = new URL(baseUrl.toString());
      url.searchParams.set("page", String(page));

      const res = await fetch(url.toString(), FETCH_OPTS);
      if (!res.ok) {
        return NextResponse.json(
          {
            sensors: [],
            count: 0,
            timestamp: new Date().toISOString(),
            error: `Safecast ${res.status}`,
          },
          {
            headers: {
              "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=7200",
            },
          }
        );
      }

      const raw: SafecastMeasurement[] = await res.json();
      if (!Array.isArray(raw) || raw.length === 0) break;

      for (const m of raw) {
        if (!m) continue;
        if (m.latitude == null || m.longitude == null) continue;
        if (!Number.isFinite(m.latitude) || !Number.isFinite(m.longitude)) continue;

        const usv = toUsvPerHour(Number(m.value), m.unit);
        if (usv == null) continue;

        const key = sensorKey(m);
        if (!key) continue;

        const capturedMs = new Date(m.captured_at).getTime();
        if (!Number.isFinite(capturedMs)) continue;

        const prev = bySensor.get(key);
        if (!prev || capturedMs > prev.capturedMs) {
          bySensor.set(key, {
            capturedMs,
            sensor: {
              lat: m.latitude,
              lng: m.longitude,
              value: usv,
              capturedAt: new Date(capturedMs).toISOString(),
            },
          });
        }
      }

      if (bySensor.size >= TARGET_UNIQUE) break;
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


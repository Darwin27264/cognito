import { NextRequest, NextResponse } from "next/server";

export const revalidate = 3600;

interface SafecastMeasurement {
  id: number;
  value: number;
  unit: string;
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

  const url = new URL("https://api.safecast.org/measurements.json");
  url.searchParams.set("bmax", `${lamax},${lomax}`);
  url.searchParams.set("bmin", `${lamin},${lomin}`);
  url.searchParams.set("distance", "100");
  url.searchParams.set("per_page", "750");
  // Prefer microsieverts/hour readings so values are directly comparable to public thresholds.
  url.searchParams.set("unit", "usv");
  url.searchParams.set("order", "captured_at+desc");

  try {
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

    const sensors: RadiationSensor[] = (raw ?? [])
      .filter(
        (m) =>
          m &&
          m.unit === "usv" &&
          m.value != null &&
          Number.isFinite(m.value) &&
          m.latitude != null &&
          m.longitude != null &&
          Number.isFinite(m.latitude) &&
          Number.isFinite(m.longitude)
      )
      .map((m) => ({
        lat: m.latitude as number,
        lng: m.longitude as number,
        value: m.value,
        capturedAt: new Date(m.captured_at).toISOString(),
      }));

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
    return NextResponse.json(
      {
        sensors: [],
        count: 0,
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : "Safecast fetch failed",
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=900, stale-while-revalidate=1800",
        },
      }
    );
  }
}


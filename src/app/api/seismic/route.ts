import { NextResponse } from "next/server";
import { fetchWithTimeout } from "@/lib/fetchWithTimeout";

export const revalidate = 60;

interface USGSFeature {
  type: string;
  properties: {
    mag: number;
    place: string;
    time: number;
    updated: number;
    url: string;
    title: string;
    type: string;
    alert: string | null;
    tsunami: number;
  };
  geometry: {
    type: string;
    coordinates: [number, number, number];
  };
}

interface USGSResponse {
  type: string;
  metadata: { generated: number; count: number; title: string };
  features: USGSFeature[];
}

export interface SeismicEvent {
  lat: number;
  lng: number;
  mag: number;
  place: string;
  time: string;
  url: string;
  title: string;
  alert: string | null;
  tsunami: boolean;
  depth: number;
}

export async function GET() {
  try {
    const url =
      "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson";

    const res = await fetchWithTimeout(url, {
      timeoutMs: 10_000,
      revalidate: 60,
    });

    if (!res.ok) throw new Error(`USGS ${res.status}`);

    const json: USGSResponse = await res.json();

    const events: SeismicEvent[] = (json.features ?? [])
      .filter((f) => f.geometry?.coordinates?.length >= 2)
      .map((f) => ({
        lat: f.geometry.coordinates[1],
        lng: f.geometry.coordinates[0],
        depth: f.geometry.coordinates[2],
        mag: f.properties.mag,
        place: f.properties.place ?? "Unknown location",
        time: new Date(f.properties.time).toISOString(),
        url: f.properties.url ?? "",
        title: f.properties.title ?? "",
        alert: f.properties.alert,
        tsunami: f.properties.tsunami === 1,
      }));

    return NextResponse.json(
      {
        events,
        count: events.length,
        timestamp: new Date().toISOString(),
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
        },
      }
    );
  } catch {
    return NextResponse.json(
      {
        events: [],
        count: 0,
        timestamp: new Date().toISOString(),
        error: "Seismic data temporarily unavailable",
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
        },
      }
    );
  }
}

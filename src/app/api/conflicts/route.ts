import { NextResponse } from "next/server";

export const revalidate = 3600;

const FALLBACK_HOTSPOTS = [
  { lat: 48.38, lng: 35.04, name: "Eastern Ukraine", count: 42 },
  { lat: 15.50, lng: 44.21, name: "Yemen", count: 28 },
  { lat: 33.31, lng: 44.37, name: "Iraq", count: 15 },
  { lat: 36.20, lng: 37.16, name: "Syria — Aleppo", count: 22 },
  { lat: 31.52, lng: 34.46, name: "Gaza Strip", count: 55 },
  { lat: 2.05, lng: 45.34, name: "Somalia", count: 18 },
  { lat: 13.75, lng: -1.53, name: "Burkina Faso", count: 12 },
  { lat: 12.64, lng: -8.00, name: "Mali", count: 14 },
  { lat: 6.52, lng: 3.37, name: "Nigeria — Lagos", count: 9 },
  { lat: 34.53, lng: 69.17, name: "Afghanistan — Kabul", count: 20 },
  { lat: 11.59, lng: 43.15, name: "Djibouti", count: 6 },
  { lat: 15.78, lng: 32.54, name: "Sudan — Khartoum", count: 35 },
  { lat: 19.43, lng: -99.13, name: "Mexico — Cartel Violence", count: 10 },
  { lat: 25.28, lng: 51.52, name: "Persian Gulf", count: 7 },
  { lat: 9.03, lng: 38.74, name: "Ethiopia — Addis Ababa", count: 11 },
  { lat: 4.85, lng: 31.61, name: "South Sudan", count: 16 },
  { lat: 33.89, lng: 35.50, name: "Lebanon — Beirut", count: 13 },
  { lat: -1.29, lng: 36.82, name: "Kenya — Nairobi", count: 5 },
  { lat: 21.02, lng: 105.85, name: "South China Sea — Tensions", count: 4 },
  { lat: 38.90, lng: 125.75, name: "Korean DMZ", count: 3 },
].map((p) => ({ ...p, url: "#", html: "" }));

interface GdeltFeature {
  type: string;
  geometry: { type: string; coordinates: [number, number] };
  properties: {
    name: string;
    html: string;
    url: string;
    count: number;
  };
}

interface GdeltGeoResponse {
  features?: GdeltFeature[];
}

export async function GET() {
  try {
    const query = encodeURIComponent("conflict OR war OR military OR attack OR bombing");
    const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${query}&mode=PointData&maxrecords=80&format=GeoJSON&sort=DateDesc`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(url, {
      next: { revalidate: 3600 },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) throw new Error(`GDELT ${res.status}`);

    const json: GdeltGeoResponse = await res.json();
    const points = (json.features ?? [])
      .filter((f) => f.geometry?.coordinates)
      .map((f) => ({
        lat: f.geometry.coordinates[1],
        lng: f.geometry.coordinates[0],
        name: f.properties.name,
        count: f.properties.count,
        url: f.properties.url,
        html: f.properties.html,
      }));

    if (points.length === 0) throw new Error("Empty GDELT response");

    return NextResponse.json(
      { points, source: "gdelt", timestamp: new Date().toISOString() },
      {
        headers: {
          "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=7200",
        },
      }
    );
  } catch {
    return NextResponse.json(
      {
        points: FALLBACK_HOTSPOTS,
        source: "fallback",
        timestamp: new Date().toISOString(),
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=7200",
        },
      }
    );
  }
}

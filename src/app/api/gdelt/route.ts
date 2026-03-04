import { NextResponse } from "next/server";

export const revalidate = 3600;

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

const FALLBACK_EVENTS = [
  { lat: 48.38, lng: 35.04, name: "Eastern Ukraine — shelling reported near Dnipro", url: "https://www.bbc.com/news/world-europe", count: 42 },
  { lat: 31.52, lng: 34.46, name: "Gaza Strip — escalation in airstrikes", url: "https://www.aljazeera.com/tag/gaza/", count: 55 },
  { lat: 15.50, lng: 44.21, name: "Yemen — Houthi missile launches reported", url: "https://www.reuters.com/world/middle-east/", count: 28 },
  { lat: 36.20, lng: 37.16, name: "Syria — Aleppo corridor clashes", url: "https://www.bbc.com/news/world-middle-east", count: 22 },
  { lat: 33.31, lng: 44.37, name: "Iraq — militia activity near Baghdad", url: "https://www.reuters.com/world/middle-east/", count: 15 },
  { lat: 15.78, lng: 32.54, name: "Sudan — Khartoum ceasefire violations", url: "https://www.aljazeera.com/tag/sudan/", count: 35 },
  { lat: 2.05, lng: 45.34, name: "Somalia — Al-Shabaab offensive", url: "https://www.bbc.com/news/world-africa", count: 18 },
  { lat: 13.75, lng: -1.53, name: "Burkina Faso — military operations in Sahel", url: "https://www.reuters.com/world/africa/", count: 12 },
  { lat: 34.53, lng: 69.17, name: "Afghanistan — Taliban security operations", url: "https://www.bbc.com/news/world-asia", count: 20 },
  { lat: 4.85, lng: 31.61, name: "South Sudan — ethnic clashes in Jonglei", url: "https://www.reuters.com/world/africa/", count: 16 },
  { lat: 33.89, lng: 35.50, name: "Lebanon — Hezbollah border tensions", url: "https://www.aljazeera.com/tag/lebanon/", count: 13 },
  { lat: 9.03, lng: 38.74, name: "Ethiopia — Amhara region unrest", url: "https://www.bbc.com/news/world-africa", count: 11 },
  { lat: 12.64, lng: -8.00, name: "Mali — JNIM attacks in central region", url: "https://www.reuters.com/world/africa/", count: 14 },
  { lat: 6.52, lng: 3.37, name: "Nigeria — Boko Haram activity in northeast", url: "https://www.bbc.com/news/world-africa", count: 9 },
  { lat: 19.43, lng: -99.13, name: "Mexico — cartel violence surge", url: "https://www.reuters.com/world/americas/", count: 10 },
];

type GdeltEvent = {
  lat: number;
  lng: number;
  name: string;
  url: string;
  count: number;
};

let gdeltCache: { events: GdeltEvent[]; timestamp: number } | null = null;
const GDELT_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
let fetchInProgress = false;

const GDELT_FETCH_OPTS = { next: { revalidate: 1800 } as const };

async function fetchGdeltEvents(): Promise<GdeltEvent[] | null> {
  const query = encodeURIComponent(
    "conflict OR war OR military OR attack OR bombing OR airstrike"
  );
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${query}&mode=PointData&maxrecords=250&format=GeoJSON&sort=DateDesc`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(url, { signal: controller.signal, ...GDELT_FETCH_OPTS });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const json: GdeltGeoResponse = await res.json();
    const events = (json.features ?? [])
      .filter((f) => f.geometry?.coordinates?.length === 2)
      .map((f) => ({
        lat: f.geometry.coordinates[1],
        lng: f.geometry.coordinates[0],
        name: f.properties.name || "Unknown event",
        url: f.properties.url || "",
        count: f.properties.count ?? 1,
      }));
    return events.length > 0 ? events : null;
  } catch {
    clearTimeout(timeout);
    return null;
  }
}

function refreshInBackground() {
  if (fetchInProgress) return;
  fetchInProgress = true;
  fetchGdeltEvents()
    .then((events) => {
      if (events) {
        gdeltCache = { events, timestamp: Date.now() };
      }
    })
    .finally(() => {
      fetchInProgress = false;
    });
}

export async function GET() {
  try {
    const now = Date.now();

    // If cache is fresh, return it immediately and skip any API call
    if (gdeltCache && now - gdeltCache.timestamp < GDELT_CACHE_TTL_MS) {
      // Refresh in background if older than 10 minutes
      if (now - gdeltCache.timestamp > 10 * 60 * 1000) {
        refreshInBackground();
      }
      return NextResponse.json(
        {
          events: gdeltCache.events,
          source: "gdelt",
          timestamp: new Date().toISOString(),
        },
        {
          headers: {
            "Cache-Control":
              "public, s-maxage=3600, stale-while-revalidate=7200",
          },
        }
      );
    }

    // No cache — return fallback instantly and fetch real data in background
    gdeltCache = { events: FALLBACK_EVENTS, timestamp: now };
    refreshInBackground();
    return NextResponse.json(
      {
        events: FALLBACK_EVENTS,
        source: "fallback",
        timestamp: new Date().toISOString(),
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
        },
      }
    );
  } catch (error) {
    // Absolute fallback if something unexpected happens.
    return NextResponse.json(
      {
        events: FALLBACK_EVENTS,
        source: "fallback-error",
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : "GDELT handler failed",
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
        },
      }
    );
  }
}

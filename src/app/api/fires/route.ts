import { NextRequest, NextResponse } from "next/server";

export const revalidate = 3600;

/** Max fire points returned to limit payload and client render cost. Well under 5k/10min. */
const MAX_FIRE_POINTS = 1200;

export interface FirePoint {
  lat: number;
  lon: number;
  brightness: number | null;
  confidence: string | null;
}

const FETCH_OPTS = { next: { revalidate: 3600 } as const };

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
    } else if ((c === "," && !inQuotes) || c === "\n" || c === "\r") {
      out.push(cur.trim());
      cur = "";
      if (c !== ",") break;
    } else {
      cur += c;
    }
  }
  out.push(cur.trim());
  return out;
}

function parseFirmsCsv(csvText: string): FirePoint[] {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const header = parseCsvLine(lines[0]);
  const latIdx = header.findIndex((h) => /latitude|lat/i.test(h));
  const lonIdx = header.findIndex((h) => /longitude|lon|lng/i.test(h));
  const brightIdx = header.findIndex((h) => /brightness|bright_ti4|bright_ti5/i.test(h));
  const confIdx = header.findIndex((h) => /confidence/i.test(h));
  if (latIdx < 0 || lonIdx < 0) return [];

  const out: FirePoint[] = [];
  for (let i = 1; i < lines.length; i++) {
    const row = parseCsvLine(lines[i]);
    const lat = Number(row[latIdx]);
    const lon = Number(row[lonIdx]);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      out.push({
        lat,
        lon,
        brightness: brightIdx >= 0 && row[brightIdx] ? Number(row[brightIdx]) : null,
        confidence: confIdx >= 0 && row[confIdx] ? row[confIdx] : null,
      });
    }
  }
  return out;
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  // Prefer server env; fall back to user-provided key from header (for deployed dashboards).
  const key =
    process.env.NASA_FIRMS_API_KEY ??
    req.headers.get("x-user-nasa-firms-key")?.trim();
  if (!key) {
    return NextResponse.json(
      { fires: [], message: "NASA_FIRMS_API_KEY not configured" },
      { headers: { "Cache-Control": "public, s-maxage=3600" } }
    );
  }

  const west = searchParams.get("west") ?? "-180";
  const south = searchParams.get("south") ?? "-90";
  const east = searchParams.get("east") ?? "180";
  const north = searchParams.get("north") ?? "90";
  // NASA FIRMS accepts "world" for global or west,south,east,north
  const isWorld =
    west === "-180" && south === "-90" && east === "180" && north === "90";
  const area = isWorld ? "world" : `${west},${south},${east},${north}`;
  const source = "VIIRS_SNPP_NRT";
  // Use 3-day range so we get fire data (1-day can be empty for global)
  const dayRange = searchParams.get("days") ?? "3";
  const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${key}/${source}/${area}/${dayRange}`;

  try {
    // Response can be >2MB; disable Next data cache to avoid warnings and overhead.
    const res = await fetch(url, { cache: "no-store" });
    const text = await res.text();
    // If NASA returns HTML error page or JSON, we cannot parse as CSV
    const trimmed = text.trim();
    if (trimmed.startsWith("<") || trimmed.startsWith("{")) {
      const errorMsg = trimmed.startsWith("{")
        ? (JSON.parse(text) as { message?: string })?.message ?? `FIRMS ${res.status}`
        : `FIRMS ${res.status} (invalid response)`;
      return NextResponse.json(
        { fires: [], error: errorMsg },
        { headers: { "Cache-Control": "public, s-maxage=60" } }
      );
    }
    if (!res.ok) {
      return NextResponse.json(
        { fires: [], error: `FIRMS ${res.status}` },
        { headers: { "Cache-Control": "public, s-maxage=3600" } }
      );
    }
    const parsed = parseFirmsCsv(text);
    const fires = parsed.slice(0, MAX_FIRE_POINTS);
    return NextResponse.json(
      { fires, source: "nasa_firms", timestamp: new Date().toISOString() },
      {
        headers: {
          "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=7200",
        },
      }
    );
  } catch (e) {
    return NextResponse.json(
      { fires: [], error: String(e) },
      { headers: { "Cache-Control": "public, s-maxage=60" } }
    );
  }
}

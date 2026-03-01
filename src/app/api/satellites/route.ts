import { NextResponse } from "next/server";

/** Revalidate TLE data every 12 hours; positions are computed client-side. */
export const revalidate = 43200;

const CELESTRAK_BASE = "https://celestrak.org/NORAD/elements/gp.php";
const FETCH_OPTS = { next: { revalidate: 43200 } } as const;

/** Only high-value assets: military/recon + space stations (ISS, etc.). Keeps orbital layer manageable. */
const CELESTRAK_GROUPS = ["military", "stations"] as const;

export interface SatelliteTLE {
  name: string;
  tle: string;
}

/**
 * Parse CelesTrak plain-text TLE response into array of { name, tle }.
 * Each TLE block is 3 lines: Name, Line 1, Line 2.
 * Returns NORAD catalog number from line 1 (for deduplication).
 */
function parseTLEList(text: string): SatelliteTLE[] {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim());
  const out: SatelliteTLE[] = [];
  for (let i = 0; i + 2 < lines.length; i += 3) {
    const name = lines[i].trim();
    const line1 = lines[i + 1].trim();
    const line2 = lines[i + 2].trim();
    if (line1.startsWith("1 ") && line2.startsWith("2 ")) {
      out.push({ name, tle: `${line1}\n${line2}` });
    }
  }
  return out;
}

/** Extract NORAD catalog number from TLE line 1 for deduplication. */
function getNoradId(tle: string): string {
  const line1 = tle.split("\n")[0]?.trim() ?? "";
  const match = line1.match(/^1\s+(\d{5})/);
  return match ? match[1] : line1.slice(0, 12);
}

export async function GET() {
  try {
    const responses = await Promise.all(
      CELESTRAK_GROUPS.map((group) =>
        fetch(`${CELESTRAK_BASE}?GROUP=${group}&FORMAT=tle`, FETCH_OPTS)
      )
    );

    const texts = await Promise.all(
      responses.map((r) => (r.ok ? r.text() : Promise.resolve("")))
    );

    const byNorad = new Map<string, SatelliteTLE>();
    for (const text of texts) {
      if (!text) continue;
      for (const sat of parseTLEList(text)) {
        const id = getNoradId(sat.tle);
        if (!byNorad.has(id)) byNorad.set(id, sat);
      }
    }
    const satellites = Array.from(byNorad.values());

    return NextResponse.json(
      {
        satellites,
        timestamp: new Date().toISOString(),
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=43200, stale-while-revalidate=86400",
        },
      }
    );
  } catch (e) {
    return NextResponse.json(
      { satellites: [], error: String(e) },
      { headers: { "Cache-Control": "public, s-maxage=60" } }
    );
  }
}

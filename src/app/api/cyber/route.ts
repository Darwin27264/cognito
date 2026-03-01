import { NextResponse } from "next/server";
import { fetchWithTimeout } from "@/lib/fetchWithTimeout";

const IODA_BASE = "https://api.ioda.inetintel.cc.gatech.edu/v2/outages";
/** IODA data refreshes periodically; 15 min cache reduces load. */
const CACHE_REVALIDATE_SEC = 900;

export interface CyberOutageItem {
  entityCode: string;
  start: number;
  signalType: string;
  entityName?: string;
  severity?: string;
  end?: number;
}

/** Raw outage object from IODA API (flexible shape). */
interface IODAOutageRow {
  entityCode?: string;
  countryCode?: string;
  entityName?: string;
  start?: number;
  startTime?: number;
  end?: number;
  endTime?: number;
  datasource?: string;
  signal?: string;
  severity?: string;
  [key: string]: unknown;
}

function parseOutages(body: unknown): CyberOutageItem[] {
  let raw: IODAOutageRow[] = [];
  if (Array.isArray(body)) {
    raw = body as IODAOutageRow[];
  } else if (body && typeof body === "object") {
    const o = body as Record<string, unknown>;
    if (Array.isArray(o.events)) raw = o.events as IODAOutageRow[];
    else if (Array.isArray(o.data)) raw = o.data as IODAOutageRow[];
    else if (Array.isArray(o.outages)) raw = o.outages as IODAOutageRow[];
  }
  return raw
    .filter((row): row is IODAOutageRow => row != null && typeof row === "object")
    .map((row) => {
      const entityCode =
        typeof row.entityCode === "string"
          ? row.entityCode
          : typeof row.countryCode === "string"
            ? row.countryCode
            : "??";
      const start =
        typeof row.start === "number"
          ? row.start
          : typeof row.startTime === "number"
            ? row.startTime
            : 0;
      const signalType =
        typeof row.datasource === "string"
          ? row.datasource
          : typeof row.signal === "string"
            ? row.signal
            : "outage";
      const end =
        typeof row.end === "number"
          ? row.end
          : typeof row.endTime === "number"
            ? row.endTime
            : undefined;
      return {
        entityCode,
        start,
        signalType,
        entityName: typeof row.entityName === "string" ? row.entityName : undefined,
        severity: typeof row.severity === "string" ? row.severity : undefined,
        end,
      };
    })
    .filter((o) => o.entityCode !== "??" || o.start > 0);
}

export async function GET() {
  const nowSec = Math.floor(Date.now() / 1000);
  const fromSec = nowSec - 24 * 60 * 60; // 24 hours ago
  const params = new URLSearchParams({
    from: String(fromSec),
    until: String(nowSec),
  });
  const url = `${IODA_BASE}/events?${params.toString()}`;

  try {
    const res = await fetchWithTimeout(url, {
      timeoutMs: 12_000,
      revalidate: CACHE_REVALIDATE_SEC,
    });
    if (!res.ok) {
      const altUrl = `${IODA_BASE}/alerts?${params.toString()}`;
      const altRes = await fetchWithTimeout(altUrl, {
        timeoutMs: 12_000,
        revalidate: CACHE_REVALIDATE_SEC,
      });
      if (!altRes.ok) {
        return NextResponse.json(
          {
            outages: [],
            timestamp: new Date().toISOString(),
            error: "IODA unavailable",
            windowHours: 24,
            source: "ioda",
          },
          {
            headers: {
              "Cache-Control": `public, s-maxage=${CACHE_REVALIDATE_SEC}, stale-while-revalidate=900`,
            },
          }
        );
      }
      const altBody = await altRes.json();
      const outages = parseOutages(altBody);
      return NextResponse.json(
        {
          outages,
          timestamp: new Date().toISOString(),
          windowHours: 24,
          source: "ioda",
        },
        {
          headers: {
            "Cache-Control": `public, s-maxage=${CACHE_REVALIDATE_SEC}, stale-while-revalidate=900`,
          },
        }
      );
    }
    const body = await res.json();
    const outages = parseOutages(body);
    return NextResponse.json(
      {
        outages,
        timestamp: new Date().toISOString(),
        windowHours: 24,
        source: "ioda",
      },
      {
        headers: {
          "Cache-Control": `public, s-maxage=${CACHE_REVALIDATE_SEC}, stale-while-revalidate=900`,
        },
      }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        outages: [],
        timestamp: new Date().toISOString(),
        error: message,
        windowHours: 24,
        source: "ioda",
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
        },
      }
    );
  }
}

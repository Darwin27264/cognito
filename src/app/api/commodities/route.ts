import { NextResponse } from "next/server";

export const revalidate = 3600;

/**
 * Commodities endpoint. Previously used yahoo-finance2 (removed).
 * Implement Finnhub/Twelve Data here if ticker data is needed.
 */
export async function GET() {
  return NextResponse.json(
    { data: [], timestamp: new Date().toISOString() },
    {
      headers: {
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=7200",
      },
    }
  );
}

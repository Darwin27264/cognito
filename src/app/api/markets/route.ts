import { NextResponse } from "next/server";

export const revalidate = 60;

/** Finnhub free tier: 60 req/min. Twelve Data: 8 req/min. Single batch per request; client polls at 5 min. */
const TICKERS = [
  { symbol: "GLD", name: "Gold (GLD)" },
  { symbol: "USO", name: "Oil (USO)" },
  { symbol: "VIXY", name: "Volatility (VIXY)" },
  { symbol: "LMT", name: "Lockheed Martin" },
  { symbol: "RTX", name: "RTX" },
  { symbol: "TLT", name: "Treasury 20Y (TLT)" },
  { symbol: "UUP", name: "US Dollar (UUP)" },
] as const;

export interface MarketQuote {
  symbol: string;
  name: string;
  price: number;
  changePercent: number;
}

interface FinnhubQuote {
  c: number;  // current price
  d: number;  // change
  dp: number; // percent change
}

async function fetchFromFinnhub(): Promise<MarketQuote[]> {
  const token = process.env.FINNHUB_API_KEY;
  if (!token) throw new Error("FINNHUB_API_KEY is not set");

  const results = await Promise.all(
    TICKERS.map(async ({ symbol, name }) => {
      const url = `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${token}`;
      const res = await fetch(url, {
        next: { revalidate: 60 },
      });
      if (!res.ok) {
        if (res.status === 429) throw new Error("Finnhub rate limit");
        throw new Error(`Finnhub ${res.status}`);
      }
      const data: FinnhubQuote = await res.json();
      const price = typeof data.c === "number" ? data.c : 0;
      const changePercent = typeof data.dp === "number" ? data.dp : 0;
      return { symbol, name, price, changePercent };
    })
  );
  return results;
}

interface TwelveDataQuoteItem {
  symbol?: string;
  name?: string;
  open?: string;
  close?: string;
  percent_change?: string;
}

function parseTwelveDataResponse(body: unknown): MarketQuote[] {
  const bySymbol = new Map<string, TwelveDataQuoteItem>();
  if (Array.isArray(body)) {
    body.forEach((item) => {
      const sym = item?.symbol ?? item?.symbol_code;
      if (sym) bySymbol.set(String(sym), item as TwelveDataQuoteItem);
    });
  } else if (body && typeof body === "object" && "data" in body && Array.isArray((body as { data: unknown[] }).data)) {
    ((body as { data: TwelveDataQuoteItem[] }).data).forEach((item) => {
      const sym = item?.symbol;
      if (sym) bySymbol.set(sym, item);
    });
  } else if (body && typeof body === "object") {
    for (const [key, val] of Object.entries(body)) {
      if (val && typeof val === "object" && (val as TwelveDataQuoteItem).symbol) {
        bySymbol.set((val as TwelveDataQuoteItem).symbol ?? key, val as TwelveDataQuoteItem);
      }
    }
  }

  return TICKERS.map(({ symbol, name }) => {
    const item = bySymbol.get(symbol);
    const close = item?.close != null ? Number(item.close) : 0;
    const open = item?.open != null ? Number(item.open) : close;
    const percentChange = item?.percent_change != null
      ? Number(item.percent_change)
      : (open && close ? ((close - open) / open) * 100 : 0);
    return {
      symbol,
      name,
      price: close,
      changePercent: percentChange,
    };
  });
}

async function fetchFromTwelveData(): Promise<MarketQuote[]> {
  const apiKey = process.env.TWELVEDATA_API_KEY;
  if (!apiKey) throw new Error("TWELVEDATA_API_KEY is not set");

  const symbols = TICKERS.map((t) => t.symbol).join(",");
  const url = `https://api.twelvedata.com/quote?symbol=${symbols}&apikey=${apiKey}`;
  const res = await fetch(url, {
    next: { revalidate: 60 },
  });
  if (!res.ok) throw new Error(`Twelve Data ${res.status}`);
  const body = await res.json();
  return parseTwelveDataResponse(body);
}

export async function GET() {
  try {
    let data: MarketQuote[];
    try {
      data = await fetchFromFinnhub();
    } catch {
      data = await fetchFromTwelveData();
    }

    const cacheControl =
      data.length > 0
        ? "public, s-maxage=60, stale-while-revalidate=120"
        : "public, s-maxage=0, must-revalidate";

    return NextResponse.json(
      { data, timestamp: new Date().toISOString() },
      { headers: { "Cache-Control": cacheControl } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        data: [],
        timestamp: new Date().toISOString(),
        error: message,
      },
      {
        status: 200,
        headers: { "Cache-Control": "public, s-maxage=0, must-revalidate" },
      }
    );
  }
}

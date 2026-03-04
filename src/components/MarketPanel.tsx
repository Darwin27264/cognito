"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { BarChart3 } from "lucide-react";
import { MARKETS_POLL_MS } from "@/lib/apiConfig";
import { useReload } from "@/context/ReloadContext";

interface MarketQuote {
  symbol: string;
  name: string;
  price: number;
  changePercent: number;
}

interface MarketsResponse {
  data: MarketQuote[];
  timestamp?: string;
  error?: string;
}

const VIXY_SYMBOL = "VIXY";

function changeColor(symbol: string, changePercent: number): string {
  if (symbol === VIXY_SYMBOL) {
    return changePercent > 0 ? "text-red-500" : "text-emerald-500";
  }
  return changePercent >= 0 ? "text-emerald-500" : "text-red-500";
}

function formatPrice(price: number): string {
  return price.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

const MarketAssetRow = memo(function MarketAssetRow({ asset }: { asset: MarketQuote }) {
  return (
    <li className="flex items-center justify-between gap-2 px-3 py-2 border-b border-zinc-800 last:border-b-0">
      <div className="min-w-0 flex-1">
        <span className="font-mono text-[10px] text-text-muted tracking-wider block truncate">
          {asset.name}
        </span>
        <span className="font-mono text-[10px] text-text-secondary">
          {asset.symbol}
        </span>
      </div>
      <div className="flex items-baseline gap-2 shrink-0 text-right">
        <span className="font-mono text-xs font-semibold text-text-primary">
          {formatPrice(asset.price)}
        </span>
        <span
          className={`font-mono text-[11px] font-medium ${changeColor(
            asset.symbol,
            asset.changePercent
          )}`}
        >
          {asset.changePercent >= 0 ? "+" : ""}
          {asset.changePercent.toFixed(2)}%
        </span>
      </div>
    </li>
  );
});

const FETCH_TIMEOUT_MS = 15_000;

function formatLastRefresh(isoTimestamp?: string): string {
  if (!isoTimestamp) return "";
  const then = new Date(isoTimestamp).getTime();
  if (!Number.isFinite(then)) return "";
  const diffMin = Math.floor((Date.now() - then) / 60_000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const h = Math.floor(diffMin / 60);
  return `${h}h ${diffMin % 60}m ago`;
}

export default function MarketPanel() {
  const [data, setData] = useState<MarketQuote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | undefined>(undefined);
  const controllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);
  const { reloadToken } = useReload();

  const fetchMarkets = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const requestId = ++requestIdRef.current;
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      setError(false);
      setErrorMessage(null);
      const res = await fetch("/api/markets", {
        cache: "no-store",
        signal: controller.signal,
      });
      if (requestIdRef.current !== requestId) return;
      const json: MarketsResponse = await res.json();
      const apiError = json.error;
      setData(json.data ?? []);
      setLastUpdated(json.timestamp ?? new Date().toISOString());
      if (apiError) {
        setError(true);
        setErrorMessage(apiError);
      }
    } catch (err) {
      if ((err as Error)?.name === "AbortError" || requestIdRef.current !== requestId) return;
      setError(true);
      setErrorMessage(err instanceof Error ? err.message : "Fetch failed");
    } finally {
      if (requestIdRef.current === requestId) {
        clearTimeout(timeoutId);
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(fetchMarkets, 0);
    const interval = setInterval(fetchMarkets, MARKETS_POLL_MS);
    return () => {
      clearTimeout(t);
      clearInterval(interval);
      controllerRef.current?.abort();
    };
  }, [fetchMarkets]);

  useEffect(() => {
    if (!reloadToken) return;
    fetchMarkets();
  }, [reloadToken, fetchMarkets]);

  return (
    <section className="flex flex-col h-full bg-zinc-950 border border-zinc-800">
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800 shrink-0">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-3.5 h-3.5 text-accent-amber" />
          <span className="font-mono text-[11px] font-bold tracking-widest text-text-primary">
            STRATEGIC MARKETS & RESOURCES
          </span>
        </div>
        {loading && (
          <div className="w-1.5 h-1.5 bg-accent-amber animate-pulse rounded-full" />
        )}
      </div>

      {loading ? (
        <MarketPanelSkeleton />
      ) : error || data.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center min-h-[120px] gap-3 px-3">
          <span className="font-mono text-xs text-text-muted text-center">
            {error ? "MARKET DATA UNAVAILABLE" : "NO DATA"}
          </span>
          {errorMessage && (
            <span className="font-mono text-[10px] text-text-muted/80 text-center max-w-full break-words">
              {errorMessage}
            </span>
          )}
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              fetchMarkets();
            }}
            className="font-mono text-[10px] text-accent-amber hover:text-accent-amber-dim transition-colors underline"
          >
            RETRY
          </button>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto min-h-0 scrollbar-hide scroll-contain">
          <ul className="divide-y divide-zinc-800">
            {data.map((asset) => (
              <MarketAssetRow key={asset.symbol} asset={asset} />
            ))}
          </ul>
          {lastUpdated && (
            <div className="py-2 text-center">
              <span className="font-mono text-[9px] text-text-muted">
                LAST REFRESH {formatLastRefresh(lastUpdated)}
              </span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export function MarketPanelSkeleton() {
  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center justify-between gap-2 px-3 py-2.5 border-b border-zinc-800"
        >
          <div className="space-y-1.5 flex-1 min-w-0">
            <div className="h-2.5 w-20 bg-zinc-800 rounded animate-pulse" />
            <div className="h-2 w-12 bg-zinc-800/80 rounded animate-pulse" />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="h-3 w-14 bg-zinc-800 rounded animate-pulse" />
            <div className="h-2.5 w-10 bg-zinc-800/80 rounded animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}

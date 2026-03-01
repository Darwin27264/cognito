"use client";

import { memo, useCallback, useEffect, useState } from "react";
import { CYBER_POLL_MS } from "@/lib/apiConfig";

interface CyberOutageItem {
  entityCode: string;
  start: number;
  signalType: string;
  entityName?: string;
  severity?: string;
  end?: number;
}

interface CyberResponse {
  outages: CyberOutageItem[];
  timestamp?: string;
  error?: string;
  windowHours?: number;
  source?: string;
}

function formatTMinus(startUnixSec: number): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const diffSec = Math.max(0, nowSec - startUnixSec);
  if (diffSec < 60) return "Started <1m ago";
  const m = Math.floor(diffSec / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `Started ${d}d ${h % 24}h ago`;
  if (h > 0) return `Started ${h}h ${m % 60}m ago`;
  return `Started ${m}m ago`;
}

function formatLastRefresh(isoTimestamp?: string): string {
  if (!isoTimestamp) return "";
  const then = new Date(isoTimestamp).getTime();
  const min = Math.floor((Date.now() - then) / 60_000);
  if (min < 1) return "Just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  return `${h}h ${min % 60}m ago`;
}

function CyberGridInner() {
  const [outages, setOutages] = useState<CyberOutageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [meta, setMeta] = useState<{ timestamp?: string; windowHours?: number; source?: string }>({});

  const fetchCyber = useCallback(async () => {
    try {
      setError(false);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15_000);
      const res = await fetch("/api/cyber", { signal: controller.signal });
      clearTimeout(timeoutId);
      const json: CyberResponse = await res.json();
      setOutages(Array.isArray(json.outages) ? json.outages : []);
      setMeta({
        timestamp: json.timestamp,
        windowHours: json.windowHours ?? 24,
        source: json.source ?? "ioda",
      });
      if (json.error) setError(true);
    } catch {
      setError(true);
      setOutages([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCyber();
    const t = setInterval(fetchCyber, CYBER_POLL_MS);
    return () => clearInterval(t);
  }, [fetchCyber]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 font-mono text-[10px] text-text-muted">
        <div className="h-1.5 w-1.5 bg-zinc-700 animate-pulse" />
        <span>LOADING IODA...</span>
      </div>
    );
  }

  const displayList = outages.slice(0, 5);
  const hasOutages = displayList.length > 0;
  const windowLabel = meta.windowHours ? `${meta.windowHours}h` : "24h";
  const lastRefresh = formatLastRefresh(meta.timestamp);

  return (
    <div className="flex flex-col h-full min-h-0 gap-1">
      {/* Status line */}
      {error ? (
        <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800">
          <div className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
          <span className="font-mono text-[10px] font-semibold tracking-wider text-amber-400">
            COMMS STATUS: DATA STALE
          </span>
        </div>
      ) : hasOutages ? (
        <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-1.5 rounded-full animate-pulse bg-red-500" />
            <span className="font-mono text-[10px] font-semibold tracking-wider text-red-400">
              {outages.length} ACTIVE ({windowLabel})
            </span>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-0.5 px-3 py-2 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="font-mono text-[10px] font-semibold tracking-wider text-emerald-400">
              GLOBAL COMMS: NOMINAL
            </span>
          </div>
          <span className="font-mono text-[9px] text-text-muted">
            No outages in last {windowLabel}
          </span>
        </div>
      )}

      {/* Outage rows or meta footer */}
      {hasOutages ? (
        <ul className="flex flex-col divide-y divide-zinc-800 flex-1 min-h-0 overflow-y-auto custom-scrollbar scroll-contain">
          {displayList.map((item, i) => (
            <li
              key={`${item.entityCode}-${item.start}-${i}`}
              className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 last:border-b-0"
            >
              <div className="h-1.5 w-1.5 flex-shrink-0 rounded-full animate-pulse bg-red-500" />
              <div className="min-w-0 flex-1">
                <span className="font-mono text-[10px] font-medium text-text-primary tracking-wider">
                  {item.entityName ?? item.entityCode}
                </span>
                {(item.signalType && item.signalType !== "outage") && (
                  <span className="font-mono text-[9px] text-text-muted block">
                    {item.entityCode} · {item.signalType}
                  </span>
                )}
              </div>
              <span className="font-mono text-[9px] text-text-muted shrink-0">
                {formatTMinus(item.start)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="px-3 py-1.5">
          <span className="font-mono text-[9px] text-text-muted">
            {meta.source?.toUpperCase() ?? "IODA"} · Last refresh {lastRefresh || "—"}
          </span>
        </div>
      )}
    </div>
  );
}

export default memo(function CyberGrid() {
  return (
    <section
      className="flex flex-col h-full bg-zinc-950 border-t border-zinc-800 font-mono overflow-hidden rounded-none"
    >
      <div className="shrink-0 px-3 py-1.5 border-b border-zinc-800">
        <span className="font-mono text-[9px] font-bold tracking-widest text-text-muted uppercase">
          Cyber & Telecommunications Status
        </span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar scroll-contain">
        <CyberGridInner />
      </div>
    </section>
  );
});

export function CyberGridSkeleton() {
  return (
    <div className="flex flex-col h-full bg-zinc-950 border-t border-zinc-800 font-mono overflow-hidden">
      <div className="shrink-0 px-3 py-1.5 border-b border-zinc-800">
        <div className="h-2.5 w-48 bg-zinc-900 animate-pulse" />
      </div>
      <div className="flex-1 p-3 space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="h-1.5 w-1.5 bg-zinc-900 animate-pulse" />
            <div className="h-3 w-16 bg-zinc-900 animate-pulse" />
            <div className="h-3 w-24 bg-zinc-900 animate-pulse ml-auto" />
          </div>
        ))}
      </div>
    </div>
  );
}

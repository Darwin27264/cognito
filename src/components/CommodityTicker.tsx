"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { TrendingUp, TrendingDown, Minus, RotateCw } from "lucide-react";
import { SettingsModal } from "@/components/SettingsModal";
import { COMMODITIES_POLL_MS, THREAT_LEVEL_POLL_MS } from "@/lib/apiConfig";
import { useReload } from "@/context/ReloadContext";

interface CommodityData {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  currency: string;
}

interface TickerResponse {
  data: CommodityData[];
  timestamp: string;
}

type ThreatLevel = "LOW" | "GUARDED" | "ELEVATED" | "HIGH" | "SEVERE";

function computeThreatLevel(eventCount: number): ThreatLevel {
  if (eventCount >= 200) return "SEVERE";
  if (eventCount >= 120) return "HIGH";
  if (eventCount >= 60) return "ELEVATED";
  if (eventCount >= 20) return "GUARDED";
  return "LOW";
}

function threatClass(level: ThreatLevel): string {
  const map: Record<ThreatLevel, string> = {
    LOW: "threat-badge--low",
    GUARDED: "threat-badge--guarded",
    ELEVATED: "threat-badge--elevated",
    HIGH: "threat-badge--high",
    SEVERE: "threat-badge--severe",
  };
  return map[level];
}

function threatDotColor(level: ThreatLevel): string {
  const map: Record<ThreatLevel, string> = {
    LOW: "#39ff14",
    GUARDED: "#22d3ee",
    ELEVATED: "#d4a017",
    HIGH: "#ff6b2b",
    SEVERE: "#ff2020",
  };
  return map[level];
}

function threatTooltip(level: ThreatLevel, eventCount: number): string {
  const bands =
    "LOW <20 · GUARDED 20–59 · ELEVATED 60–119 · HIGH 120–199 · SEVERE ≥200 (events in window)";
  return `THREAT ${level}: derived from ${eventCount} conflict events. Bands: ${bands}`;
}

function ChangeIcon({ value }: { value: number }) {
  if (value > 0) return <TrendingUp className="w-3 h-3" />;
  if (value < 0) return <TrendingDown className="w-3 h-3" />;
  return <Minus className="w-3 h-3" />;
}

function changeColor(value: number): string {
  if (value > 0) return "text-accent-green";
  if (value < 0) return "text-accent-red";
  return "text-text-muted";
}

function TickerSkeleton() {
  return (
    <div className="flex items-center gap-6">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex items-center gap-2 shrink-0">
          <div className="h-2.5 w-14 bg-tactical-gunmetal rounded animate-pulse" />
          <div className="h-3 w-16 bg-tactical-gunmetal rounded animate-pulse" />
          <div className="h-2.5 w-12 bg-tactical-gunmetal rounded animate-pulse" />
        </div>
      ))}
    </div>
  );
}

function CommodityTicker() {
  const [data, setData] = useState<TickerResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [eventCount, setEventCount] = useState(0);
  const mountedRef = useRef(true);
  const { reloadToken, triggerReload } = useReload();

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/commodities");
      const json: TickerResponse = await res.json();
      if (mountedRef.current) setData(json);
    } catch {
      /* will retry on next interval */
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  const fetchThreatLevel = useCallback(async () => {
    try {
      const res = await fetch("/api/gdelt");
      const json = await res.json();
      if (mountedRef.current) setEventCount((json.events ?? []).length);
    } catch {
      /* keep previous value */
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    fetchData();
    fetchThreatLevel();
    const interval = setInterval(fetchData, COMMODITIES_POLL_MS);
    const threatInterval = setInterval(fetchThreatLevel, THREAT_LEVEL_POLL_MS);
    return () => {
      clearInterval(interval);
      clearInterval(threatInterval);
    };
  }, [fetchData, fetchThreatLevel]);

  useEffect(() => {
    if (!reloadToken) return;
    fetchData();
    fetchThreatLevel();
  }, [reloadToken, fetchData, fetchThreatLevel]);

  const level = computeThreatLevel(eventCount);

  return (
    <header className="w-full border-b border-panel-border bg-tactical-dark">
      <div className="flex items-center px-4 h-10">
        {/* Brand (left) */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="w-2 h-2 bg-accent-green rounded-full animate-pulse-amber" />
          <span className="font-mono text-sm font-bold tracking-[0.3em] text-accent-amber">
            COGNITO
          </span>
          <span className="text-[10px] text-text-muted font-mono tracking-wider hidden sm:inline">
            EVENTS DASHBOARD
          </span>
        </div>

        {/* Centered Threat Level Badge (desktop) */}
        <div className="hidden md:flex flex-1 justify-center">
          <div
            className={`threat-badge ${threatClass(level)}`}
            title={threatTooltip(level, eventCount)}
          >
            <span
              className="threat-dot"
              style={{ background: threatDotColor(level) }}
            />
            THREAT: {level}
          </div>
        </div>

        {/* Right: ticker + reload */}
        <div className="flex items-center gap-4 shrink-0">
          <div className="flex items-center gap-6 overflow-hidden">
            {loading ? (
              <TickerSkeleton />
            ) : data?.data ? (
              data.data.map((c) => (
                <div key={c.symbol} className="flex items-center gap-2 shrink-0">
                  <span className="font-mono text-[10px] text-text-muted tracking-wider">
                    {c.name}
                  </span>
                  <span className="font-mono text-xs font-bold text-text-primary">
                    $
                    {c.price.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                  <span
                    className={`font-mono text-[11px] flex items-center gap-1 ${changeColor(c.changePercent)}`}
                  >
                    <ChangeIcon value={c.changePercent} />
                    {c.changePercent >= 0 ? "+" : ""}
                    {c.changePercent.toFixed(2)}%
                  </span>
                </div>
              ))
            ) : (
              <span className="font-mono text-xs text-accent-red">
                SIGNAL LOST
              </span>
            )}
          </div>

          {/* Reload: trigger smart data refresh without full page reload */}
          <button
            type="button"
            onClick={triggerReload}
            className="shrink-0 flex items-center gap-1.5 font-mono text-[10px] text-text-muted hover:text-accent-amber transition-colors focus:outline-none focus:ring-1 focus:ring-panel-border rounded px-1.5 py-0.5"
            title="Refresh live data"
          >
            <RotateCw className="w-3 h-3" />
            RELOAD
          </button>
          <SettingsModal />
        </div>
      </div>
    </header>
  );
}

export default memo(CommodityTicker);

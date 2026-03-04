"use client";

import { memo, useEffect, useMemo, useState } from "react";
import { Activity, Clock } from "lucide-react";
import { useLayerFreshness } from "@/context/LayerFreshnessContext";
import type { LayerFreshnessKey } from "@/context/LayerFreshnessContext";

/** Isolated so only the clock re-renders every second; rest of StatusBar stays stable. */
const StatusBarClock = memo(function StatusBarClock() {
  const [time, setTime] = useState("");
  useEffect(() => {
    function tick() {
      const d = new Date();
      const yy = d.getUTCFullYear();
      const mo = d.toLocaleString("en-US", { timeZone: "UTC", month: "short" });
      const dd = String(d.getUTCDate()).padStart(2, "0");
      const hh = String(d.getUTCHours()).padStart(2, "0");
      const mm = String(d.getUTCMinutes()).padStart(2, "0");
      const ss = String(d.getUTCSeconds()).padStart(2, "0");
      setTime(`${dd} ${mo} ${yy} ${hh}:${mm}:${ss}`);
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="flex items-center gap-1.5 flex-shrink-0">
      <Clock className="w-3 h-3 text-text-muted" />
      <span className="font-mono text-[10px] text-text-muted tracking-wider">
        {time} UTC
      </span>
    </div>
  );
});

function formatFreshness(iso: string | null | undefined): string {
  if (!iso) return "——";
  const then = new Date(iso).getTime();
  const sec = Math.floor((Date.now() - then) / 1000);
  if (sec < 60) return `${String(sec).padStart(2, "0")}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${String(min).padStart(2, "0")}m`;
  const h = Math.floor(min / 60);
  return `${String(h).padStart(2, "0")}h`;
}

function formatRateLimitCountdown(
  retryAfterSeconds: number | null | undefined,
  layerIso: string | null | undefined
): string | null {
  if (!retryAfterSeconds || !layerIso) return null;
  const ts = new Date(layerIso).getTime();
  if (!Number.isFinite(ts)) return null;
  const elapsed = Math.floor((Date.now() - ts) / 1000);
  const remaining = retryAfterSeconds - elapsed;
  if (remaining <= 0) return "0s";
  if (remaining < 60) return `${remaining}s`;
  const min = Math.floor(remaining / 60);
  const sec = remaining % 60;
  return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

const LAYER_LABELS: Record<LayerFreshnessKey, string> = {
  aircraft: "ACFT",
  gdelt: "GDELT",
  seismic: "SEISMIC",
  fires: "FIRES",
  orbital: "SATS",
  maritime: "AIS",
  radiation: "RAD",
};

export default function StatusBar() {
  const { freshness, aircraftApiStatus, layerStatusCodes } = useLayerFreshness();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const freshnessEntries = useMemo(
    () =>
      (
        [
          "aircraft",
          "gdelt",
          "seismic",
          "fires",
          "orbital",
          "maritime",
          "radiation",
        ] as LayerFreshnessKey[]
      ).map((key) => ({
        key,
        label: LAYER_LABELS[key],
        value: formatFreshness(freshness[key]),
      })),
    [freshness, now]
  );

  const errorDetails = useMemo(() => {
    const messages: string[] = [];
    if (aircraftApiStatus) {
      const { opensky, adsbfi, adsblol, theairtraffic } = aircraftApiStatus;
      if (typeof opensky === "number" && opensky >= 400) {
        messages.push(`AIRCRAFT · OpenSky ${opensky}`);
      }
      if (typeof adsbfi === "number" && adsbfi >= 400) {
        messages.push(`AIRCRAFT · adsb.fi ${adsbfi}`);
      }
      if (typeof adsblol === "number" && adsblol >= 400) {
        messages.push(`AIRCRAFT · ADSB.lol ${adsblol}`);
      }
      if (typeof theairtraffic === "number" && theairtraffic >= 400) {
        messages.push(`AIRCRAFT · TheAirTraffic ${theairtraffic}`);
      }
    }
    const layerKeys: LayerFreshnessKey[] = [
      "aircraft",
      "gdelt",
      "seismic",
      "fires",
      "orbital",
      "maritime",
      "radiation",
    ];
    for (const key of layerKeys) {
      const code = layerStatusCodes?.[key];
      if (typeof code === "number" && code >= 400) {
        messages.push(`${LAYER_LABELS[key]} layer ${code}`);
      }
    }
    return messages;
  }, [aircraftApiStatus, layerStatusCodes]);

  const hasErrors = errorDetails.length > 0;

  return (
    <footer className="flex items-center justify-between px-4 h-7 border-t border-panel-border bg-tactical-dark">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5">
          <Activity
            className={`w-3 h-3 ${
              hasErrors ? "text-accent-amber animate-pulse-amber" : "text-accent-green"
            }`}
          />
          <span className="font-mono text-[10px] text-accent-green tracking-wider">
            <span
              title={hasErrors ? errorDetails.join("\n") : undefined}
              className={hasErrors ? "text-accent-amber cursor-help" : undefined}
            >
              {hasErrors ? "SYSTEMS DEGRADED" : "SYSTEMS NOMINAL"}
            </span>
          </span>
        </div>
        <div className="w-px h-3 bg-panel-border" />
        <div className="flex items-center gap-3 font-mono text-[10px] text-text-secondary tracking-wider">
          {freshnessEntries.map(({ key, label, value }) => {
            const title =
              key === "aircraft" && aircraftApiStatus
                ? [
                    aircraftApiStatus.opensky != null ? `OpenSky: ${aircraftApiStatus.opensky}` : null,
                    aircraftApiStatus.adsbfi != null ? `adsb.fi: ${aircraftApiStatus.adsbfi}` : null,
                    aircraftApiStatus.adsblol != null ? `ADSB.lol: ${aircraftApiStatus.adsblol}` : null,
                    aircraftApiStatus.theairtraffic != null
                      ? `TheAirTraffic: ${aircraftApiStatus.theairtraffic}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join("  ·  ") || undefined
                : undefined;
            const annotatedValue =
              key === "aircraft" && aircraftApiStatus
                ? (() => {
                    const {
                      opensky,
                      adsbfi,
                      adsblol,
                      theairtraffic,
                      openskyRetryAfterSeconds,
                    } = aircraftApiStatus;
                    const countdown = formatRateLimitCountdown(
                      openskyRetryAfterSeconds,
                      freshness.aircraft
                    );
                    if (opensky === 429) {
                      if (countdown) {
                        return `${value} (OpenSky 429 · RL ${countdown})`;
                      }
                      return `${value} (OpenSky 429)`;
                    }
                    if (typeof opensky === "number" && opensky >= 400) {
                      return `${value} (OpenSky ${opensky})`;
                    }
                    if (typeof adsbfi === "number" && adsbfi >= 400)
                      return `${value} (adsb.fi ${adsbfi})`;
                    if (typeof adsblol === "number" && adsblol >= 400)
                      return `${value} (ADSB.lol ${adsblol})`;
                    if (typeof theairtraffic === "number" && theairtraffic >= 400)
                      return `${value} (TheAirTraffic ${theairtraffic})`;
                    return value;
                  })()
                : value;
            return (
              <span
                key={key}
                title={title}
                className={title ? "cursor-help" : undefined}
              >
                {label}: <span className="text-text-muted">{annotatedValue}</span>
              </span>
            );
          })}
        </div>
      </div>
      <StatusBarClock />
    </footer>
  );
}

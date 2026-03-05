"use client";

import { memo, Suspense } from "react";
import dynamic from "next/dynamic";
import CommodityTicker from "@/components/CommodityTicker";
import IntelFeed from "@/components/IntelFeed";
import { MarketPanelSkeleton } from "@/components/MarketPanel";
import { CyberGridSkeleton } from "@/components/CyberGrid";
import StatusBar from "@/components/StatusBar";
import { LayerFreshnessProvider } from "@/context/LayerFreshnessContext";
import { ReloadProvider } from "@/context/ReloadContext";
import { ApiKeysProvider } from "@/context/ApiKeysContext";

const MapSkeleton = memo(function MapSkeleton() {
  return (
    <div className="flex flex-col h-full bg-panel border border-panel-border">
      <div className="flex items-center justify-between px-3 py-2 border-b border-panel-border bg-tactical-charcoal">
        <div className="h-3 w-40 bg-tactical-gunmetal animate-pulse rounded" />
        <div className="h-3 w-24 bg-tactical-gunmetal animate-pulse rounded" />
      </div>
      <div className="flex-1 bg-tactical-black relative overflow-hidden">
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-mono text-xs text-accent-amber animate-pulse-amber">
            INITIALIZING MAP SUBSYSTEM...
          </span>
        </div>
        <div className="absolute top-8 left-12 w-3 h-3 bg-accent-red/20 rounded-full animate-pulse" />
        <div className="absolute top-20 left-32 w-2 h-2 bg-accent-red/15 rounded-full animate-pulse" />
        <div className="absolute top-16 right-24 w-4 h-4 bg-accent-red/10 rounded-full animate-pulse" />
        <div className="absolute bottom-20 left-1/3 w-2.5 h-2.5 bg-accent-amber/15 rounded-full animate-pulse" />
        <div className="absolute bottom-32 right-1/4 w-3 h-3 bg-cyan-400/10 rounded-full animate-pulse" />
      </div>
    </div>
  );
});

const MarketPanelFallback = memo(function MarketPanelFallback() {
  return (
    <div className="flex flex-col h-full bg-zinc-950 border border-zinc-800">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0">
        <div className="h-3.5 w-3.5 bg-zinc-900 animate-pulse" />
        <div className="h-3 w-40 bg-zinc-900 animate-pulse" />
      </div>
      <MarketPanelSkeleton />
    </div>
  );
});

const CyberGridFallback = memo(function CyberGridFallback() {
  return <CyberGridSkeleton />;
});

const ConflictMap = dynamic(() => import("@/components/ConflictMap"), {
  ssr: false,
  loading: () => <MapSkeleton />,
});

const MarketPanel = dynamic(() => import("@/components/MarketPanel"), {
  ssr: false,
  loading: () => <MarketPanelFallback />,
});

const CyberGrid = dynamic(() => import("@/components/CyberGrid"), {
  ssr: false,
  loading: () => <CyberGridFallback />,
});

export default function Dashboard() {
  return (
    <ApiKeysProvider>
      <LayerFreshnessProvider>
        <ReloadProvider>
          <div className="flex flex-col h-screen overflow-hidden">
          <CommodityTicker />

          <main className="flex-1 grid grid-cols-1 lg:grid-cols-[1.6fr_minmax(0,8.4fr)_2fr] min-h-0">
            <aside className="hidden lg:flex flex-col h-full min-h-0 border-r border-zinc-800">
              <div className="flex flex-col flex-1 min-h-0 w-full">
                <div className="h-[80%] min-h-0 overflow-y-auto custom-scrollbar scroll-contain flex flex-col border-b border-zinc-800">
                  <Suspense fallback={<MarketPanelFallback />}>
                    <MarketPanel />
                  </Suspense>
                </div>
                <div className="h-[20%] min-h-0 overflow-y-auto custom-scrollbar scroll-contain flex flex-col">
                  <Suspense fallback={<CyberGridFallback />}>
                    <CyberGrid />
                  </Suspense>
                </div>
              </div>
            </aside>
            <div className="min-h-[400px] lg:min-h-0">
              <ConflictMap />
            </div>
            <div className="border-l border-panel-border min-h-[300px] lg:min-h-0">
              <IntelFeed />
            </div>
          </main>

          <StatusBar />
          </div>
        </ReloadProvider>
      </LayerFreshnessProvider>
    </ApiKeysProvider>
  );
}

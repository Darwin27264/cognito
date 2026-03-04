"use client";

import { memo, useEffect, useState, useCallback, useRef } from "react";
import { FileText, ExternalLink, Shield } from "lucide-react";

import { INTEL_POLL_MS } from "@/lib/apiConfig";
import { useReload } from "@/context/ReloadContext";

interface IntelArticle {
  title: string;
  url: string;
  date: string;
  source: string;
  country: string;
  image: string | null;
  description: string | null;
}

function formatIntelDate(raw: string): string {
  try {
    const d = new Date(raw);
    if (isNaN(d.getTime())) return raw;
    return d.toLocaleString("en-US", {
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return raw;
  }
}

const IntelArticleRow = memo(function IntelArticleRow({ article }: { article: IntelArticle }) {
  const a = article;
  return (
    <li className="border-b border-panel-border hover:bg-tactical-charcoal transition-colors group">
      <a
        href={a.url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-start gap-3 px-3 py-2.5"
      >
        <FileText className="w-3.5 h-3.5 text-text-muted mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs text-text-primary leading-snug line-clamp-2 group-hover:text-accent-amber transition-colors">
            {a.title}
          </p>
          {a.description && (
            <p className="text-[11px] text-text-secondary leading-snug line-clamp-1 mt-0.5">
              {a.description}
            </p>
          )}
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className="font-mono text-[10px] text-accent-green-dim tracking-wider uppercase">
              {a.source}
            </span>
            <span className="text-[10px] text-text-muted">•</span>
            <span className="font-mono text-[10px] text-text-muted">
              {formatIntelDate(a.date)}
            </span>
          </div>
        </div>
        <ExternalLink className="w-3 h-3 text-text-muted opacity-0 group-hover:opacity-100 transition-opacity mt-0.5 shrink-0" />
      </a>
    </li>
  );
});

function SidebarSkeleton() {
  return (
    <div className="flex-1 overflow-hidden">
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="flex items-start gap-3 px-3 py-2.5 border-b border-panel-border"
        >
          <div className="w-3.5 h-3.5 bg-tactical-gunmetal rounded animate-pulse mt-0.5 shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="h-3 bg-tactical-gunmetal rounded animate-pulse w-full" />
            <div className="h-3 bg-tactical-gunmetal rounded animate-pulse w-4/5" />
            <div className="flex gap-2 mt-1">
              <div className="h-2.5 bg-tactical-gunmetal rounded animate-pulse w-16" />
              <div className="h-2.5 bg-tactical-gunmetal rounded animate-pulse w-20" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function fetchIntel(signal?: AbortSignal): Promise<IntelArticle[]> {
  return fetch("/api/intel", { signal })
    .then((r) => r.json())
    .then((d) => {
      if (d.error) throw new Error(d.error);
      return d.articles ?? [];
    });
}

function IntelFeed() {
  const [articles, setArticles] = useState<IntelArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
   const { reloadToken } = useReload();

  const load = useCallback((isInitial: boolean) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    if (isInitial) setLoading(true);
    fetchIntel(controller.signal)
      .then((list) => {
        if (controller.signal.aborted) return;
        setArticles(list);
        setError(false);
      })
      .catch((err) => {
        if (controller.signal.aborted || err?.name === "AbortError") return;
        setArticles([]);
        setError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
  }, []);

  useEffect(() => {
    load(true);
    const id = setInterval(() => load(false), INTEL_POLL_MS);
    return () => {
      clearInterval(id);
      abortRef.current?.abort();
    };
  }, [load]);

  useEffect(() => {
    if (!reloadToken) return;
    load(false);
  }, [reloadToken, load]);

  return (
    <section className="flex flex-col h-full bg-panel border border-panel-border">
      <div className="flex items-center justify-between px-3 py-2 border-b border-panel-border bg-tactical-charcoal">
        <div className="flex items-center gap-2">
          <Shield className="w-3.5 h-3.5 text-accent-amber" />
          <span className="font-mono text-[11px] font-bold tracking-widest text-text-primary">
            INTEL FEED // SITREP
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-text-muted">
            {articles.length} ITEMS
          </span>
          {loading && (
            <div className="w-1.5 h-1.5 bg-accent-amber animate-pulse-amber" />
          )}
        </div>
      </div>

      {loading ? (
        <SidebarSkeleton />
      ) : articles.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center h-32 gap-2">
          <span className="font-mono text-xs text-text-muted">
            {error ? "FEED TEMPORARILY UNAVAILABLE" : "NO INTEL AVAILABLE"}
          </span>
          {error && (
            <span className="font-mono text-[10px] text-accent-red-dim">
              CHECK API KEY CONFIG
            </span>
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto min-h-0 scroll-contain">
          <ul>
            {articles.map((a, i) => (
              <IntelArticleRow key={`${a.url}-${i}`} article={a} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export default memo(IntelFeed);

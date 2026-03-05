"use client";

import { useCallback, useState } from "react";
import { Settings, X } from "lucide-react";
import { useApiKeys } from "@/context/ApiKeysContext";

const LABELS: Record<string, string> = {
  NASA_FIRMS_API_KEY: "NASA FIRMS (fires/thermal)",
  NEWSAPI_KEY: "NewsAPI (intel feed)",
  AISSTREAM_API_KEY: "AIS Stream (maritime)",
  FINNHUB_API_KEY: "Finnhub (markets)",
  TWELVEDATA_API_KEY: "Twelve Data (markets fallback)",
};

export function SettingsModal() {
  const { keys, setKeys } = useApiKeys();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Record<string, string>>(() => ({
    NASA_FIRMS_API_KEY: keys.NASA_FIRMS_API_KEY ?? "",
    NEWSAPI_KEY: keys.NEWSAPI_KEY ?? "",
    AISSTREAM_API_KEY: keys.AISSTREAM_API_KEY ?? "",
    FINNHUB_API_KEY: keys.FINNHUB_API_KEY ?? "",
    TWELVEDATA_API_KEY: keys.TWELVEDATA_API_KEY ?? "",
  }));
  const [remember, setRemember] = useState(false);

  const handleOpen = useCallback(() => {
    setForm({
      NASA_FIRMS_API_KEY: keys.NASA_FIRMS_API_KEY ?? "",
      NEWSAPI_KEY: keys.NEWSAPI_KEY ?? "",
      AISSTREAM_API_KEY: keys.AISSTREAM_API_KEY ?? "",
      FINNHUB_API_KEY: keys.FINNHUB_API_KEY ?? "",
      TWELVEDATA_API_KEY: keys.TWELVEDATA_API_KEY ?? "",
    });
    setOpen(true);
  }, [keys]);

  const handleSave = useCallback(() => {
    setKeys(
      {
        NASA_FIRMS_API_KEY: form.NASA_FIRMS_API_KEY || undefined,
        NEWSAPI_KEY: form.NEWSAPI_KEY || undefined,
        AISSTREAM_API_KEY: form.AISSTREAM_API_KEY || undefined,
        FINNHUB_API_KEY: form.FINNHUB_API_KEY || undefined,
        TWELVEDATA_API_KEY: form.TWELVEDATA_API_KEY || undefined,
      },
      remember
    );
    setOpen(false);
  }, [form, remember, setKeys]);

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="shrink-0 flex items-center gap-1.5 font-mono text-[10px] text-text-muted hover:text-accent-amber transition-colors focus:outline-none focus:ring-1 focus:ring-panel-border rounded px-1.5 py-0.5"
        title="API keys (for deployed dashboard)"
      >
        <Settings className="w-3 h-3" />
        SETTINGS
      </button>

      {open && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/70">
          <div className="bg-tactical-dark border border-panel-border rounded-lg shadow-xl max-w-md w-full max-h-[90vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-4 py-4 border-b border-panel-border">
              <span className="font-mono text-xs font-bold tracking-widest text-accent-amber">
                API KEYS
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="p-1 text-text-muted hover:text-text-primary"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-4 py-4 overflow-y-auto flex-1 space-y-5">
              <p className="font-mono text-[10px] text-text-muted">
                Optional: enter keys for use in this browser when server env is not set. Server-side keys take priority. Keys are stored in session (or locally if you check &quot;Remember&quot;).
              </p>
              {Object.entries(LABELS).map(([key, label]) => {
                const value = form[key] ?? "";
                const preview = value.length >= 3 ? `${value.slice(0, 3)}••••••` : value.length > 0 ? "••••••" : null;
                return (
                  <div key={key} className="space-y-2">
                    <label className="block font-mono text-[10px] text-text-secondary">
                      {label}
                    </label>
                    <input
                      type="password"
                      value={value}
                      onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                      className="w-full bg-tactical-charcoal border border-panel-border rounded px-2 py-1.5 font-mono text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent-amber"
                      placeholder="Optional"
                      autoComplete="off"
                    />
                    {preview && (
                      <p className="font-mono text-[10px] text-text-muted" title="First 3 characters for identification">
                        <span className="text-text-secondary">ID:</span> {preview}
                      </p>
                    )}
                  </div>
                );
              })}
              <label className="flex items-center gap-2 pt-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                  className="rounded border-panel-border text-accent-amber focus:ring-accent-amber"
                />
                <span className="font-mono text-[10px] text-text-secondary">
                  Remember in this browser (localStorage)
                </span>
              </label>
            </div>
            <div className="flex justify-end gap-3 px-4 py-4 border-t border-panel-border">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="px-3 py-1.5 font-mono text-[10px] text-text-muted hover:text-text-primary"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                className="px-3 py-1.5 font-mono text-[10px] bg-accent-amber/20 text-accent-amber border border-accent-amber/50 rounded hover:bg-accent-amber/30"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

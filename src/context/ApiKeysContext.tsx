"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

const STORAGE_KEY = "cognitio_user_api_keys";
const STORAGE_PERSIST_KEY = "cognitio_remember_api_keys";

export type ApiKeysConfig = {
  NASA_FIRMS_API_KEY?: string;
  NEWSAPI_KEY?: string;
  AISSTREAM_API_KEY?: string;
  FINNHUB_API_KEY?: string;
  TWELVEDATA_API_KEY?: string;
};

const KEY_HEADER_MAP: Record<keyof ApiKeysConfig, string> = {
  NASA_FIRMS_API_KEY: "X-User-NASA-FIRMS-Key",
  NEWSAPI_KEY: "X-User-NewsAPI-Key",
  AISSTREAM_API_KEY: "X-User-AISSTREAM-Key",
  FINNHUB_API_KEY: "X-User-FINNHUB-Key",
  TWELVEDATA_API_KEY: "X-User-TWELVEDATA-Key",
};

function loadKeysFromStorage(): ApiKeysConfig {
  if (typeof window === "undefined") return {};
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ApiKeysConfig;
      return Object.fromEntries(
        Object.entries(parsed).filter(([, v]) => typeof v === "string" && v.trim() !== "")
      ) as ApiKeysConfig;
    }
    const persist = localStorage.getItem(STORAGE_PERSIST_KEY);
    if (persist) {
      const parsed = JSON.parse(persist) as ApiKeysConfig;
      return Object.fromEntries(
        Object.entries(parsed).filter(([, v]) => typeof v === "string" && v.trim() !== "")
      ) as ApiKeysConfig;
    }
  } catch {
    /* ignore */
  }
  return {};
}

function saveKeysToStorage(keys: ApiKeysConfig, remember: boolean) {
  if (typeof window === "undefined") return;
  try {
    const payload = JSON.stringify(keys);
    sessionStorage.setItem(STORAGE_KEY, payload);
    if (remember) {
      localStorage.setItem(STORAGE_PERSIST_KEY, payload);
    } else {
      localStorage.removeItem(STORAGE_PERSIST_KEY);
    }
  } catch {
    /* ignore */
  }
}

type ApiKeysContextValue = {
  keys: ApiKeysConfig;
  setKeys: (keys: ApiKeysConfig, remember?: boolean) => void;
  /** Headers to attach to requests to our /api/* routes when user has entered keys. Server prefers env vars. */
  getHeaders: () => Record<string, string>;
};

const ApiKeysContext = createContext<ApiKeysContextValue | undefined>(undefined);

export function ApiKeysProvider({ children }: { children: ReactNode }) {
  const [keys, setKeysState] = useState<ApiKeysConfig>(loadKeysFromStorage);

  const setKeys = useCallback((newKeys: ApiKeysConfig, remember = false) => {
    const trimmed: ApiKeysConfig = {};
    for (const [k, v] of Object.entries(newKeys)) {
      if (typeof v === "string" && v.trim() !== "") {
        trimmed[k as keyof ApiKeysConfig] = v.trim();
      }
    }
    setKeysState(trimmed);
    saveKeysToStorage(trimmed, remember);
  }, []);

  const getHeaders = useCallback(() => {
    const out: Record<string, string> = {};
    for (const [envKey, headerName] of Object.entries(KEY_HEADER_MAP)) {
      const value = keys[envKey as keyof ApiKeysConfig];
      if (value) out[headerName] = value;
    }
    return out;
  }, [keys]);

  const value = useMemo(
    () => ({ keys, setKeys, getHeaders }),
    [keys, setKeys, getHeaders]
  );

  return (
    <ApiKeysContext.Provider value={value}>
      {children}
    </ApiKeysContext.Provider>
  );
}

export function useApiKeys(): ApiKeysContextValue {
  const ctx = useContext(ApiKeysContext);
  if (!ctx) {
    throw new Error("useApiKeys must be used within ApiKeysProvider");
  }
  return ctx;
}

export { KEY_HEADER_MAP };

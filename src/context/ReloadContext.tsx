"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";

type ReloadContextValue = {
  reloadToken: number;
  triggerReload: () => void;
};

const ReloadContext = createContext<ReloadContextValue | undefined>(undefined);

export function ReloadProvider({ children }: { children: ReactNode }) {
  const [reloadToken, setReloadToken] = useState(0);

  const triggerReload = useCallback(() => {
    setReloadToken((t) => t + 1);
  }, []);

  return (
    <ReloadContext.Provider value={{ reloadToken, triggerReload }}>
      {children}
    </ReloadContext.Provider>
  );
}

export function useReload(): ReloadContextValue {
  const ctx = useContext(ReloadContext);
  if (!ctx) {
    throw new Error("useReload must be used within a ReloadProvider");
  }
  return ctx;
}


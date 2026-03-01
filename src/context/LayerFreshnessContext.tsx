"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type LayerFreshnessKey =
  | "aircraft"
  | "gdelt"
  | "seismic"
  | "fires"
  | "orbital"
  | "maritime"
  | "radiation";

export type LayerFreshnessState = Partial<Record<LayerFreshnessKey, string | null>>;

export type LayerStatusCodesState = Partial<Record<LayerFreshnessKey, number | null>>;

export type AircraftApiStatus = {
  opensky: number | null;
  adsbfi: number | null;
  adsblol: number | null;
  theairtraffic: number | null;
  openskyRateLimitRemaining: number | null;
  openskyRetryAfterSeconds: number | null;
};

const initialState: LayerFreshnessState = {
  aircraft: null,
  gdelt: null,
  seismic: null,
  fires: null,
  orbital: null,
  maritime: null,
  radiation: null,
};

const LayerFreshnessContext = createContext<{
  freshness: LayerFreshnessState;
  setLayerTimestamp: (layer: LayerFreshnessKey, isoTimestamp: string | null) => void;
  layerStatusCodes: LayerStatusCodesState;
  setLayerStatusCode: (layer: LayerFreshnessKey, statusCode: number | null) => void;
  aircraftApiStatus: AircraftApiStatus | null;
  setAircraftApiStatus: (status: AircraftApiStatus | null) => void;
}>({
  freshness: initialState,
  setLayerTimestamp: () => {},
  layerStatusCodes: {},
  setLayerStatusCode: () => {},
  aircraftApiStatus: null,
  setAircraftApiStatus: () => {},
});

export function LayerFreshnessProvider({ children }: { children: ReactNode }) {
  const [freshness, setFreshness] = useState<LayerFreshnessState>(initialState);
  const [layerStatusCodes, setLayerStatusCodesState] = useState<LayerStatusCodesState>({});
  const [aircraftApiStatus, setAircraftApiStatus] = useState<AircraftApiStatus | null>(null);

  const setLayerTimestamp = useCallback((layer: LayerFreshnessKey, isoTimestamp: string | null) => {
    setFreshness((prev) => ({ ...prev, [layer]: isoTimestamp }));
  }, []);

  const setLayerStatusCode = useCallback((layer: LayerFreshnessKey, statusCode: number | null) => {
    setLayerStatusCodesState((prev) => ({ ...prev, [layer]: statusCode }));
  }, []);

  const value = useMemo(
    () => ({
      freshness,
      setLayerTimestamp,
      layerStatusCodes,
      setLayerStatusCode,
      aircraftApiStatus,
      setAircraftApiStatus,
    }),
    [freshness, setLayerTimestamp, layerStatusCodes, setLayerStatusCode, aircraftApiStatus]
  );

  return (
    <LayerFreshnessContext.Provider value={value}>
      {children}
    </LayerFreshnessContext.Provider>
  );
}

export function useLayerFreshness() {
  return useContext(LayerFreshnessContext);
}

"use client";

import { memo, useEffect, useState, useMemo, useCallback, useRef } from "react";
import useSWR from "swr";
import { getSatelliteInfo } from "tle.js";
import { useLayerFreshness } from "@/context/LayerFreshnessContext";
import { useReload } from "@/context/ReloadContext";
import { useApiKeys } from "@/context/ApiKeysContext";
import {
  FLIGHTS_POLL_MS,
  GDELT_POLL_MS,
  SEISMIC_POLL_MS,
  FIRES_POLL_MS,
  SATELLITE_POSITION_UPDATE_MS,
  INITIAL_LOAD_TIMEOUT_MS,
  AIS_POLL_MS,
} from "@/lib/apiConfig";
import { formatTimeAgo, formatExactTime } from "@/lib/formatTimeAgo";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Polyline,
  Rectangle,
  useMap,
  useMapEvents,
} from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import L from "leaflet";
import { Radio, ExternalLink, X, Crosshair, Loader2 } from "lucide-react";
import "leaflet/dist/leaflet.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GdeltEvent {
  lat: number;
  lng: number;
  name: string;
  url: string;
  count: number;
}

interface FlightData {
  id?: string;
  callsign: string;
  lat: number;
  lng: number;
  altitude: number | null;
  velocity: number | null;
  heading: number | null;
  origin?: string;
  source?: string;
}

interface FirePoint {
  lat: number;
  lon: number;
  brightness: number | null;
  confidence: string | null;
}

interface SeismicEvent {
  lat: number;
  lng: number;
  mag: number;
  place: string;
  time: string;
  url: string;
  title: string;
  alert: string | null;
  tsunami: boolean;
  depth: number;
}

interface Chokepoint {
  name: string;
  bounds: [[number, number], [number, number]];
  label: [number, number];
}

interface SatellitePosition {
  name: string;
  lat: number;
  lng: number;
  height?: number;
  /** Ground-track position N seconds ahead for direction vector. */
  velocityEnd?: [number, number] | null;
}

interface MapBounds {
  lamin: number;
  lomin: number;
  lamax: number;
  lomax: number;
}
interface AisShip {
  mmsi: string;
  lat: number;
  lng: number;
  cog: number | null;
  sog: number | null;
  navStatus?: string;
}

interface RadiationSensor {
  lat: number;
  lng: number;
  value: number;
  capturedAt: string;
}

type LayerKey =
  | "aircraft"
  | "gdelt"
  | "seismic"
  | "chokepoints"
  | "fires"
  | "orbital"
  | "maritime"
  | "radiation";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STRATEGIC_CHOKEPOINTS: Chokepoint[] = [
  {
    name: "STRAIT OF HORMUZ",
    bounds: [[25.5, 55.5], [27.0, 57.0]],
    label: [26.25, 56.25],
  },
  {
    name: "SUEZ CANAL",
    bounds: [[29.8, 32.2], [31.3, 33.0]],
    label: [30.55, 32.6],
  },
  {
    name: "BAB EL-MANDEB",
    bounds: [[12.0, 43.0], [13.0, 44.0]],
    label: [12.5, 43.5],
  },
  {
    name: "TAIWAN STRAIT",
    bounds: [[23.5, 117.5], [25.5, 120.5]],
    label: [24.5, 119.0],
  },
  {
    name: "PANAMA CANAL",
    bounds: [[8.8, -80.0], [9.5, -79.3]],
    label: [9.15, -79.65],
  },
  {
    name: "MALACCA STRAIT",
    bounds: [[1.0, 101.5], [4.0, 104.5]],
    label: [2.5, 103.0],
  },
  {
    name: "GIBRALTAR STRAIT",
    bounds: [[35.7, -6.0], [36.2, -5.2]],
    label: [35.95, -5.6],
  },
  {
    name: "BOSPHORUS",
    bounds: [[40.9, 28.8], [41.3, 29.3]],
    label: [41.1, 29.05],
  },
];

const VELOCITY_VECTOR_SECONDS = 120;
const SATELLITE_VELOCITY_VECTOR_MS = 120_000;
const BOUNDS_DEBOUNCE_MS = 500;
const VIEWPORT_CULL_BUFFER_DEG = 2;
const VELOCITY_VECTOR_MIN_ZOOM = 8;

/** Longitude wrap: return all lng equivalents in [lomin, lomax] so markers appear in every visible world copy. */
function getVisibleWrappedLongitudes(
  lng: number,
  lomin: number,
  lomax: number
): number[] {
  const out: number[] = [];
  for (let k = -2; k <= 2; k++) {
    const lngW = lng + k * 360;
    if (lngW >= lomin && lngW <= lomax) out.push(lngW);
  }
  return out.length > 0 ? out : [lng];
}

// ---------------------------------------------------------------------------
// SVG Icon Factories
// ---------------------------------------------------------------------------

function makeAircraftIcon(heading: number | null): L.DivIcon {
  const deg = heading ?? 0;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="transform:rotate(${deg}deg);color:#c9a227;filter:drop-shadow(0 0 3px rgba(201,162,39,0.5))"><path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/></svg>`;
  return L.divIcon({
    html: svg,
    className: "aircraft-icon-wrapper",
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

function makeTrackedAircraftIcon(heading: number | null): L.DivIcon {
  const deg = heading ?? 0;
  const html = `<div class="tracked-aircraft-box"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="transform:rotate(${deg}deg);color:#c9a227;filter:drop-shadow(0 0 6px rgba(201,162,39,0.8))"><path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/></svg></div>`;
  return L.divIcon({
    html,
    className: "aircraft-icon-wrapper",
    iconSize: [36, 36],
    iconAnchor: [18, 18],
  });
}

function makeGdeltIcon(): L.DivIcon {
  return L.divIcon({
    html: `<span class="gdelt-diamond"></span>`,
    className: "gdelt-icon-wrapper",
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

function makeSeismicIcon(mag: number): L.DivIcon {
  const size = Math.max(18, Math.min(30, mag * 4));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="#eab308" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="filter:drop-shadow(0 0 4px rgba(234,179,8,0.6))"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>`;
  return L.divIcon({
    html: svg,
    className: "seismic-icon-wrapper",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function makeChokepointLabel(name: string): L.DivIcon {
  return L.divIcon({
    html: `<span class="chokepoint-label">${name}</span>`,
    className: "chokepoint-label-wrapper",
    iconSize: [140, 20],
    iconAnchor: [70, 10],
  });
}

function makeFireIcon(): L.DivIcon {
  return L.divIcon({
    html: `<span class="fire-thermal-icon"></span>`,
    className: "fire-icon-wrapper",
    iconSize: [12, 12],
    iconAnchor: [6, 6],
  });
}

/** Orbital assets: neon purple diamond crosshair to distinguish from aircraft (amber/cyan). */
function makeSatelliteIcon(): L.DivIcon {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#b24bf3" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="filter:drop-shadow(0 0 4px rgba(178,75,243,0.7))"><path d="M12 2v20M2 12h20"/><path d="M4.93 4.93l14.14 14.14"/><path d="M4.93 19.07l14.14-14.14"/><circle cx="12" cy="12" r="3"/></svg>`;
  return L.divIcon({
    html: svg,
    className: "satellite-icon-wrapper",
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
}

/** Tracked satellite: same icon wrapped in a pulsing purple bounding box. */
function makeTrackedSatelliteIcon(): L.DivIcon {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#b24bf3" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="filter:drop-shadow(0 0 6px rgba(178,75,243,0.9))"><path d="M12 2v20M2 12h20"/><path d="M4.93 4.93l14.14 14.14"/><path d="M4.93 19.07l14.14-14.14"/><circle cx="12" cy="12" r="3"/></svg>`;
  const html = `<div class="tracked-satellite-box">${svg}</div>`;
  return L.divIcon({
    html,
    className: "satellite-icon-wrapper",
    iconSize: [40, 40],
    iconAnchor: [20, 20],
  });
}

function makeShipIcon(cog: number | null): L.DivIcon {
  const deg = cog ?? 0;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="transform:rotate(${deg}deg);color:#22d3ee;filter:drop-shadow(0 0 4px rgba(34,211,238,0.7))"><path d="M12 2L5 11h4v9l3-2 3 2v-9h4z"/></svg>`;
  return L.divIcon({
    html: svg,
    className: "ship-icon-wrapper",
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

function conflictClusterIcon(cluster: { getChildCount(): number }): L.DivIcon {
  const n = cluster.getChildCount();
  const size = n > 50 ? 48 : n > 20 ? 40 : 34;
  return L.divIcon({
    html: `<span class="cluster-conflict" style="width:${size}px;height:${size}px">${n}</span>`,
    className: "cluster-icon-wrapper",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function seismicClusterIcon(cluster: { getChildCount(): number }): L.DivIcon {
  const n = cluster.getChildCount();
  const size = n > 20 ? 44 : n > 8 ? 38 : 32;
  return L.divIcon({
    html: `<span class="cluster-seismic" style="width:${size}px;height:${size}px">${n}</span>`,
    className: "cluster-icon-wrapper",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function fireClusterIcon(cluster: { getChildCount(): number }): L.DivIcon {
  const n = cluster.getChildCount();
  const size = n > 50 ? 44 : n > 20 ? 38 : 32;
  const fontSize = n > 99 ? 10 : n > 9 ? 11 : 12;
  return L.divIcon({
    html: `<span class="cluster-fire-box" style="width:${size}px;height:${size}px;font-size:${fontSize}px">${n}</span>`,
    className: "cluster-icon-wrapper",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

// ---------------------------------------------------------------------------
// Velocity vector calculation
// ---------------------------------------------------------------------------

function computeVelocityEndpoint(
  lat: number,
  lng: number,
  headingDeg: number | null,
  velocityMs: number | null
): [number, number] | null {
  if (headingDeg == null || velocityMs == null || velocityMs <= 0) return null;
  const R = 6371000;
  const d = velocityMs * VELOCITY_VECTOR_SECONDS;
  const bearing = (headingDeg * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lng1 = (lng * Math.PI) / 180;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d / R) +
      Math.cos(lat1) * Math.sin(d / R) * Math.cos(bearing)
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(d / R) * Math.cos(lat1),
      Math.cos(d / R) - Math.sin(lat1) * Math.sin(lat2)
    );
  return [(lat2 * 180) / Math.PI, (lng2 * 180) / Math.PI];
}

// ---------------------------------------------------------------------------
// Map event listener: dynamic bounds with debounce
// ---------------------------------------------------------------------------

function BoundsTracker({
  onBoundsChange,
  onVisibleLngRange,
}: {
  onBoundsChange: (b: MapBounds) => void;
  /** Visible longitude range from pixel bounds (unprojected) so data can wrap when map scrolls. */
  onVisibleLngRange?: (lomin: number, lomax: number) => void;
}) {
  const mapRef = useRef<L.Map | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handler = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const map = mapRef.current;
      if (!map) return;
      const b = map.getBounds();
      onBoundsChange({
        lamin: b.getSouth(),
        lomin: b.getWest(),
        lamax: b.getNorth(),
        lomax: b.getEast(),
      });
      const px = map.getPixelBounds();
      const lngWest = map.unproject(px.getTopLeft()).lng;
      const lngEast = map.unproject(px.getBottomRight()).lng;
      onVisibleLngRange?.(lngWest, lngEast);
    }, BOUNDS_DEBOUNCE_MS);
  }, [onBoundsChange, onVisibleLngRange]);

  const map = useMapEvents({
    moveend: handler,
    zoomend: handler,
  });

  useEffect(() => {
    mapRef.current = map;
    const b = map.getBounds();
    onBoundsChange({
      lamin: b.getSouth(),
      lomin: b.getWest(),
      lamax: b.getNorth(),
      lomax: b.getEast(),
    });
    const px = map.getPixelBounds();
    const lngWest = map.unproject(px.getTopLeft()).lng;
    const lngEast = map.unproject(px.getBottomRight()).lng;
    onVisibleLngRange?.(lngWest, lngEast);
  }, [onBoundsChange, onVisibleLngRange, map]);

  return null;
}

/** When a satellite is tracked, keep the map view centered on it as it moves. */
function TrackedSatelliteView({
  positions,
  trackedIndex,
  positionsVersion,
}: {
  positions: SatellitePosition[];
  trackedIndex: number | null;
  positionsVersion: number;
}) {
  const map = useMap();
  const positionsRef = useRef(positions);
  positionsRef.current = positions;
  useEffect(() => {
    if (trackedIndex == null) return;
    const pos = positionsRef.current;
    if (trackedIndex >= pos.length) return;
    const sat = pos[trackedIndex];
    if (!sat) return;
    map.setView([sat.lat, sat.lng], map.getZoom(), { animate: true, duration: 1 });
  }, [map, trackedIndex, positionsVersion]);
  return null;
}

/** Reports current zoom to parent for zoom-dependent rendering (e.g. velocity vectors). */
function MapZoomReporter({ onZoomChange }: { onZoomChange: (zoom: number) => void }) {
  const map = useMapEvents({
    zoomend: () => onZoomChange(map.getZoom()),
    moveend: () => onZoomChange(map.getZoom()),
  });
  const onZoomChangeRef = useRef(onZoomChange);
  onZoomChangeRef.current = onZoomChange;
  useEffect(() => {
    onZoomChangeRef.current(map.getZoom());
  }, [map]);
  return null;
}

function ZoomSync({ zoom }: { zoom: number }) {
  const map = useMap();
  const lastZoomRef = useRef<number | null>(null);

  useEffect(() => {
    if (!Number.isFinite(zoom)) return;
    const current = map.getZoom();
    if (lastZoomRef.current === zoom || current === zoom) return;
    lastZoomRef.current = zoom;
    map.setZoom(zoom, { animate: true });
  }, [map, zoom]);

  return null;
}

function aircraftClusterIcon(cluster: { getChildCount(): number }): L.DivIcon {
  const n = cluster.getChildCount();
  const size = n > 100 ? 44 : n > 30 ? 38 : 32;
  return L.divIcon({
    html: `<span class="cluster-aircraft" style="width:${size}px;height:${size}px">${n}</span>`,
    className: "cluster-icon-wrapper",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function maritimeClusterIcon(cluster: { getChildCount(): number }): L.DivIcon {
  const n = cluster.getChildCount();
  const size = n > 100 ? 44 : n > 30 ? 38 : 32;
  const fontSize = n > 99 ? 10 : n > 9 ? 11 : 12;
  return L.divIcon({
    html: `<span class="cluster-maritime" style="display:flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;min-width:${size}px;min-height:${size}px;font-size:${fontSize}px;font-weight:700;border-radius:50%;background:rgba(34,211,238,0.35);border:1.5px solid #22d3ee;color:#22d3ee;box-shadow:0 0 10px rgba(34,211,238,0.4);line-height:1;">${n}</span>`,
    className: "cluster-icon-wrapper",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function radiationClusterIcon(cluster: { getChildCount(): number }): L.DivIcon {
  const n = cluster.getChildCount();
  const size = n > 200 ? 52 : n > 80 ? 46 : n > 20 ? 40 : 36;
  const fontSize = n > 999 ? 8 : n > 99 ? 9 : 10;
  // Radiation trefoil SVG (classic 3-blade nuclear symbol)
  const trefoil = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="rgba(57,255,20,0.95)" style="flex-shrink:0;filter:drop-shadow(0 0 3px rgba(57,255,20,0.7))"><circle cx="12" cy="12" r="3"/><path d="M12 2a10 10 0 0 1 8.66 5l-5 2.89A4 4 0 0 0 12 8V2z"/><path d="M12 2a10 10 0 0 0-8.66 5l5 2.89A4 4 0 0 1 12 8V2z"/><path d="M3.34 17a10 10 0 0 0 17.32 0l-5-2.89a4 4 0 0 1-7.32 0L3.34 17z"/></svg>`;
  return L.divIcon({
    html: `<div class="cluster-radiation" style="width:${size}px;height:${size}px;min-width:${size}px;min-height:${size}px;">${trefoil}<span style="font-size:${fontSize}px;font-weight:800;line-height:1;">${n}</span></div>`,
    className: "cluster-icon-wrapper",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

// ---------------------------------------------------------------------------
// Layer Toggle Control (memoized so map updates don't re-render this panel)
// ---------------------------------------------------------------------------

const LayerToggle = memo(function LayerToggle({
  layers,
  layerLoading,
  onToggle,
}: {
  layers: Record<LayerKey, boolean>;
  layerLoading: Partial<Record<LayerKey, boolean>>;
  onToggle: (k: LayerKey) => void;
}) {
  const groups: {
    title: string;
    items: { key: LayerKey; label: string; color: string }[];
  }[] = [
    {
      title: "ASSETS",
      items: [
        { key: "aircraft", label: "AIRCRAFT", color: "#c9a227" },
        { key: "maritime", label: "MARITIME AIS", color: "#22d3ee" },
        { key: "orbital", label: "ORBITAL ASSETS", color: "#b24bf3" },
      ],
    },
    {
      title: "INTEL & EVENTS",
      items: [
        { key: "gdelt", label: "GDELT INTEL", color: "#ff2020" },
        { key: "seismic", label: "SEISMIC", color: "#eab308" },
        { key: "fires", label: "ACTIVE FIRES (NASA)", color: "#b45309" },
        { key: "radiation", label: "RADIATION SENSORS", color: "#39ff14" },
        { key: "chokepoints", label: "CHOKEPOINTS", color: "#556b2f" },
      ],
    },
  ];

  return (
    <div className="layer-toggle-panel">
      <div className="layer-toggle-header">LAYERS</div>
      {groups.map((group) => (
        <div key={group.title}>
          <div className="layer-toggle-group-label">{group.title}</div>
          {group.items.map((item) => (
            <button
              key={item.key}
              className={`layer-toggle-btn ${layers[item.key] ? "active" : ""}`}
              onClick={() => onToggle(item.key)}
            >
              <span
                className="layer-toggle-indicator"
                style={{
                  background: layers[item.key] ? item.color : "transparent",
                  borderColor: item.color,
                }}
              />
              {item.label}
              {layerLoading[item.key] && (
                <Loader2
                  className="layer-loading-spinner"
                  style={{ width: 11, height: 11, color: item.color }}
                />
              )}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function ConflictMap() {
  const [events, setEvents] = useState<GdeltEvent[]>([]);
  const [flights, setFlights] = useState<FlightData[]>([]);
  const [seismic, setSeismic] = useState<SeismicEvent[]>([]);
  const [fires, setFires] = useState<FirePoint[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [loadingFlights, setLoadingFlights] = useState(true);
  const [loadingSeismic, setLoadingSeismic] = useState(true);
  const [loadingFires, setLoadingFires] = useState(true);
  const [bounds, setBounds] = useState<MapBounds | null>(null);
  const [visibleLngRange, setVisibleLngRange] = useState<{ lomin: number; lomax: number } | null>(null);
  const [mapZoom, setMapZoom] = useState(3);
  const {
    freshness,
    setLayerTimestamp,
    setAircraftApiStatus,
    setLayerStatusCode,
    layerStatusCodes,
    aircraftApiStatus,
  } = useLayerFreshness();
  const [layers, setLayers] = useState<Record<LayerKey, boolean>>({
    aircraft: true,
    gdelt: true,
    seismic: true,
    chokepoints: true,
    fires: true,
    orbital: false,
    maritime: true,
    radiation: true,
  });
  const [satellitePositions, setSatellitePositions] = useState<SatellitePosition[]>([]);
  const [satellitePositionsVersion, setSatellitePositionsVersion] = useState(0);
  const [loadingSatellites, setLoadingSatellites] = useState(true);
  const satelliteTLEsRef = useRef<{ name: string; tle: string }[]>([]);
  const [trackedSatelliteIndex, setTrackedSatelliteIndex] = useState<number | null>(null);
  const [trackedCallsigns, setTrackedCallsigns] = useState<string[]>([]);
  const [initialLoad, setInitialLoad] = useState(true);
  const [aisShips, setAisShips] = useState<Record<string, AisShip>>({});
  const [radiationSensors, setRadiationSensors] = useState<RadiationSensor[]>([]);
  const [loadingRadiation, setLoadingRadiation] = useState(false);
  const { reloadToken } = useReload();
  const { getHeaders } = useApiKeys();
  const getHeadersRef = useRef(getHeaders);
  getHeadersRef.current = getHeaders;

  const fetcher = useCallback(
    (url: string) => fetch(url, { headers: getHeaders() }).then((r) => r.json()),
    [getHeaders]
  );
  const flightsKey = useMemo(() => {
    if (!bounds) return null;
    const round = (v: number) => v.toFixed(2);
    return `/api/flights?lamin=${round(bounds.lamin)}&lomin=${round(
      bounds.lomin
    )}&lamax=${round(bounds.lamax)}&lomax=${round(bounds.lomax)}`;
  }, [bounds]);

  const { data: flightsResponse, isLoading: swrLoadingFlights, mutate: mutateFlights } = useSWR(
    flightsKey,
    fetcher,
    {
      refreshInterval: FLIGHTS_POLL_MS,
      keepPreviousData: true,
    }
  );

  const normalizedFlights = useMemo(() => {
    const list = flightsResponse?.flights ?? [];
    return list.map((f: { lon: number; [k: string]: unknown }) => ({
      ...f,
      lng: f.lon,
    })) as FlightData[];
  }, [flightsResponse]);

  useEffect(() => {
    if (!normalizedFlights.length) return;
    setFlights((prev) => {
      const byKey = new Map<string, FlightData>();
      for (const f of prev) {
        const key = (f.id ?? f.callsign ?? "").toString();
        if (key) byKey.set(key, f);
      }
      for (const f of normalizedFlights) {
        const key = (f.id ?? f.callsign ?? "").toString();
        if (key) byKey.set(key, f);
      }
      return Array.from(byKey.values());
    });
  }, [normalizedFlights]);

  useEffect(() => {
    setLoadingFlights(swrLoadingFlights);
  }, [swrLoadingFlights]);

  useEffect(() => {
    const ts = flightsResponse?.timestamp;
    if (ts) setLayerTimestamp("aircraft", ts);
    const apiStatus = flightsResponse?.apiStatus;
    const rateLimit = flightsResponse?.rateLimit?.opensky;
    if (apiStatus) {
      setAircraftApiStatus({
        opensky: apiStatus.opensky ?? null,
        adsbfi: apiStatus.adsbfi ?? null,
        adsblol: apiStatus.adsblol ?? null,
        theairtraffic: apiStatus.theairtraffic ?? null,
        openskyRateLimitRemaining: rateLimit?.remaining ?? null,
        openskyRetryAfterSeconds: rateLimit?.retryAfterSeconds ?? null,
      });
      const codes = [
        apiStatus.opensky,
        apiStatus.adsbfi,
        apiStatus.adsblol,
        apiStatus.theairtraffic,
      ].filter((c): c is number => typeof c === "number");
      const layerCode = codes.length ? Math.min(...codes) : null;
      setLayerStatusCode("aircraft", layerCode);
    }
  }, [
    flightsResponse?.timestamp,
    flightsResponse?.apiStatus,
    flightsResponse?.rateLimit,
    setLayerTimestamp,
    setAircraftApiStatus,
    setLayerStatusCode,
  ]);

  const mountedRef = useRef(true);

  const fetchEvents = useCallback(() => {
    fetch("/api/gdelt")
      .then((r) => r.json())
      .then((d) => {
        if (!mountedRef.current) return;
        setEvents(d.events ?? []);
        if (d.timestamp) setLayerTimestamp("gdelt", d.timestamp);
        setLayerStatusCode("gdelt", d.error ? 500 : 200);
      })
      .catch(() => {
        setLayerStatusCode("gdelt", 500);
      })
      .finally(() => {
        if (mountedRef.current) setLoadingEvents(false);
      });
  }, [setLayerTimestamp, setLayerStatusCode]);

  const fetchSeismic = useCallback(() => {
    fetch("/api/seismic")
      .then((r) => r.json())
      .then((d) => {
        if (!mountedRef.current) return;
        setSeismic(d.events ?? []);
        if (d.timestamp) setLayerTimestamp("seismic", d.timestamp);
      })
      .catch(() => {
        setLayerStatusCode("seismic", 500);
      })
      .finally(() => {
        if (mountedRef.current) setLoadingSeismic(false);
      });
  }, [setLayerTimestamp, setLayerStatusCode]);

  const fetchFires = useCallback(() => {
    setLoadingFires(true);
    fetch("/api/fires", { headers: getHeaders() })
      .then((r) => r.json())
      .then((d) => {
        if (!mountedRef.current) return;
        setFires(d.fires ?? []);
        if (d.timestamp) setLayerTimestamp("fires", d.timestamp);
      })
      .catch(() => {
        if (mountedRef.current) setFires([]);
        setLayerStatusCode("fires", 500);
      })
      .finally(() => {
        if (mountedRef.current) setLoadingFires(false);
      });
  }, [setLayerTimestamp, setLayerStatusCode, getHeaders]);

  const handleBoundsChange = useCallback((b: MapBounds) => {
    setBounds(b);
  }, []);

  const handleVisibleLngRange = useCallback((lomin: number, lomax: number) => {
    setVisibleLngRange({ lomin, lomax });
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Live Maritime AIS: proxy via /api/ais; rate-limited and server-cached to avoid API abuse
  const [loadingMaritime, setLoadingMaritime] = useState(false);
  const lastAisFetchRef = useRef<number>(0);

  const fetchAis = useCallback(() => {
    if (!bounds) return;
    const now = Date.now();
    if (now - lastAisFetchRef.current < AIS_POLL_MS) return; // rate-limit: at most one request per AIS_POLL_MS
    lastAisFetchRef.current = now;

    const { lamin, lomin, lamax, lomax } = bounds;
    const round = (v: number) => v.toFixed(4);
    const url = `/api/ais?lamin=${round(lamin)}&lomin=${round(lomin)}&lamax=${round(lamax)}&lomax=${round(lomax)}`;
    setLoadingMaritime(true);
    fetch(url, { headers: getHeaders() })
      .then((r) => r.json())
      .then((d) => {
        if (!mountedRef.current) return;
        const list = Array.isArray(d.ships) ? d.ships : [];
        setAisShips((prev) => {
          const next = { ...prev };
          for (const ship of list) {
            if (ship?.mmsi != null) {
              next[String(ship.mmsi)] = {
                mmsi: String(ship.mmsi),
                lat: Number(ship.lat),
                lng: Number(ship.lng),
                cog: ship.cog != null ? Number(ship.cog) : null,
                sog: ship.sog != null ? Number(ship.sog) : null,
                navStatus: ship.navStatus,
              };
            }
          }
          return next;
        });
        if (d.timestamp) setLayerTimestamp("maritime", d.timestamp);
      })
      .catch(() => {
        if (mountedRef.current) setAisShips({});
        setLayerStatusCode("maritime", 500);
      })
      .finally(() => {
        if (mountedRef.current) setLoadingMaritime(false);
      });
  }, [bounds, getHeaders]);

  useEffect(() => {
    if (!layers.maritime || !bounds) return;
    fetchAis();
    const t = setInterval(fetchAis, AIS_POLL_MS);
    return () => clearInterval(t);
  }, [layers.maritime, bounds, fetchAis]);

  // Radiation sensors: fetch on mount and when user clicks Reload. Use ref for getHeaders so
  // we don't re-run this effect when context updates (e.g. fire timestamp), which would trigger
  // a second fetch that can fail and overwrite good data.
  useEffect(() => {
    const controller = new AbortController();
    setLoadingRadiation(true);
    fetch("/api/radiation?bmax=90,180&bmin=-90,-180", {
      signal: controller.signal,
      headers: getHeadersRef.current(),
    })
      .then((r) => r.json())
      .then((d) => {
        if (!mountedRef.current) return;
        // Only update sensors on success; never overwrite with empty when server returned an error
        if (!d.error && Array.isArray(d.sensors)) {
          setRadiationSensors(d.sensors);
        }
        if (d.timestamp) setLayerTimestamp("radiation", d.timestamp);
        setLayerStatusCode("radiation", d.error ? 500 : 200);
      })
      .catch((error: unknown) => {
        if (!mountedRef.current) return;
        if (error instanceof DOMException && error.name === "AbortError") return;
        // Don't clear existing sensors on fetch failure — keep last good data
        setLayerStatusCode("radiation", 500);
      })
      .finally(() => {
        if (mountedRef.current) setLoadingRadiation(false);
      });
    return () => controller.abort();
  }, [reloadToken, setLayerTimestamp, setLayerStatusCode]);

  useEffect(() => {
    if (!reloadToken) return;
    fetchEvents();
    fetchSeismic();
    fetchFires();
    if (layers.maritime && bounds) {
      fetchAis();
    }
    mutateFlights();
  }, [
    reloadToken,
    fetchEvents,
    fetchSeismic,
    fetchFires,
    layers.maritime,
    bounds,
    fetchAis,
    mutateFlights,
  ]);

  useEffect(() => {
    fetchEvents();
    fetchSeismic();
    fetchFires();
    const tGdelt = setInterval(fetchEvents, GDELT_POLL_MS);
    const tSeismic = setInterval(fetchSeismic, SEISMIC_POLL_MS);
    const tFires = setInterval(fetchFires, FIRES_POLL_MS);
    return () => {
      clearInterval(tGdelt);
      clearInterval(tSeismic);
      clearInterval(tFires);
    };
  }, [fetchEvents, fetchSeismic, fetchFires]);

  // Orbital: fetch TLE list once; positions computed client-side every 1s to avoid API rate limits.
  const updateSatellitePositions = useCallback(() => {
    const tles = satelliteTLEsRef.current;
    if (tles.length === 0) return;
    const now = Date.now();
    const futureMs = now + SATELLITE_VELOCITY_VECTOR_MS;
    const next: SatellitePosition[] = [];
    for (const { name, tle } of tles) {
      try {
        const info = getSatelliteInfo(tle, now);
        let velocityEnd: [number, number] | null = null;
        try {
          const future = getSatelliteInfo(tle, futureMs);
          if (
            Number.isFinite(future.lat) &&
            Number.isFinite(future.lng) &&
            (future.lat !== info.lat || future.lng !== info.lng)
          ) {
            velocityEnd = [future.lat, future.lng];
          }
        } catch {
          // Ignore future propagation errors
        }
        next.push({
          name,
          lat: info.lat,
          lng: info.lng,
          height: info.height,
          velocityEnd,
        });
      } catch {
        // Skip decayed or invalid TLEs
      }
    }
    setSatellitePositions(next);
    setSatellitePositionsVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoadingSatellites(true);
    fetch("/api/satellites")
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && Array.isArray(d.satellites)) {
          satelliteTLEsRef.current = d.satellites;
          updateSatellitePositions();
          if (d.timestamp) setLayerTimestamp("orbital", d.timestamp);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingSatellites(false);
      });
    return () => {
      cancelled = true;
    };
  }, [updateSatellitePositions, setLayerTimestamp]);

  useEffect(() => {
    const interval = setInterval(updateSatellitePositions, SATELLITE_POSITION_UPDATE_MS);
    return () => clearInterval(interval);
  }, [updateSatellitePositions]);


  /** Core data ready: bounds from map + all four main feeds loaded. Ensures flights have a key before we consider "ready". */
  const coreDataReady =
    bounds !== null &&
    !loadingEvents &&
    !loadingFlights &&
    !loadingSeismic &&
    !loadingFires;

  useEffect(() => {
    if (coreDataReady) setInitialLoad(false);
  }, [coreDataReady]);

  /** Dismiss initial-load overlay after max wait so the map is never stuck if a feed never resolves. */
  useEffect(() => {
    const t = setTimeout(() => setInitialLoad(false), INITIAL_LOAD_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, []);

  const toggleLayer = useCallback((key: LayerKey) => {
    setLayers((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const loading = loadingEvents || loadingFlights || loadingSeismic || loadingFires;

  const layerLoading = useMemo(
    () => ({
      aircraft: loadingFlights,
      gdelt: loadingEvents,
      seismic: loadingSeismic,
      fires: loadingFires,
      orbital: loadingSatellites,
      maritime: loadingMaritime,
      radiation: loadingRadiation,
    }),
    [
      loadingFlights,
      loadingEvents,
      loadingSeismic,
      loadingFires,
      loadingSatellites,
      loadingMaritime,
      loadingRadiation,
    ]
  );

  // GDELT markers — stable keys so popup doesn't remount on data refresh
  const gdeltMarkers = useMemo(
    () =>
      events
        .filter((e) => e.lat && e.lng)
        .map((e, i) => ({
          ...e,
          icon: makeGdeltIcon(),
          key: `gd-${e.lat.toFixed(4)}-${e.lng.toFixed(4)}-${(e.name || "n").slice(0, 35).replace(/\s/g, "")}-${i}`,
        })),
    [events]
  );

  // Flight markers — stable key by id (icao24); exclude invalid coords so Leaflet never receives NaN/undefined
  const flightData = useMemo(
    () =>
      flights
        .filter((f) => Number.isFinite(f.lat) && Number.isFinite(f.lng))
        .map((f, i) => ({
          ...f,
          icon: makeAircraftIcon(f.heading),
          key: `fl-${f.id ?? f.callsign ?? `idx-${i}`}`,
          velocityEnd: computeVelocityEndpoint(
            f.lat,
            f.lng,
            f.heading,
            f.velocity
          ),
        })),
    [flights]
  );

  // Seismic markers — stable key by event time+position; exclude invalid coords
  const seismicMarkers = useMemo(
    () =>
      seismic
        .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng))
        .map((s, i) => ({
          ...s,
          icon: makeSeismicIcon(s.mag),
          key: `eq-${s.time}-${s.lat.toFixed(4)}-${s.lng.toFixed(4)}-${i}`,
        })),
    [seismic]
  );

  // Fire markers — stable key by position+index; exclude invalid coords
  const fireMarkers = useMemo(
    () =>
      fires
        .filter((fire) => Number.isFinite(fire.lat) && Number.isFinite(fire.lon))
        .map((fire, i) => ({
          ...fire,
          icon: makeFireIcon(),
          key: `fire-${fire.lat.toFixed(4)}-${fire.lon.toFixed(4)}-${i}`,
        })),
    [fires]
  );

  // Visible longitude range for wrapping (from pixel bounds when panned); fallback to bounds.
  const wrapBounds = useMemo(() => {
    if (visibleLngRange) return visibleLngRange;
    if (bounds) return { lomin: bounds.lomin, lomax: bounds.lomax };
    return { lomin: -180, lomax: 180 };
  }, [visibleLngRange, bounds]);

  /** In-view filter: only include markers within bounds + buffer to reduce DOM when zoomed out. */
  const inView = useMemo(() => {
    if (!bounds) return () => true;
    const pad = VIEWPORT_CULL_BUFFER_DEG;
    const { lamin, lomin, lamax, lomax } = bounds;
    return (lat: number, lng: number) =>
      lat >= lamin - pad &&
      lat <= lamax + pad &&
      lng >= lomin - pad &&
      lng <= lomax + pad;
  }, [bounds]);

  // Expand markers to wrapped longitudes; only include markers in view for performance when zoomed out
  const wrappedGdeltMarkers = useMemo(() => {
    const { lomin, lomax } = wrapBounds;
    return gdeltMarkers
      .filter((e) => inView(e.lat, e.lng))
      .flatMap((e) =>
        getVisibleWrappedLongitudes(e.lng, lomin, lomax).map((lngW) => ({
          ...e,
          lng: lngW,
          key: `${e.key}-w${lngW}`,
        }))
      );
  }, [gdeltMarkers, wrapBounds, inView]);

  const wrappedSeismicMarkers = useMemo(() => {
    const { lomin, lomax } = wrapBounds;
    return seismicMarkers
      .filter((s) => inView(s.lat, s.lng))
      .flatMap((s) =>
        getVisibleWrappedLongitudes(s.lng, lomin, lomax).map((lngW) => ({
          ...s,
          lng: lngW,
          key: `${s.key}-w${lngW}`,
        }))
      );
  }, [seismicMarkers, wrapBounds, inView]);

  const wrappedFireMarkers = useMemo(() => {
    const { lomin, lomax } = wrapBounds;
    return fireMarkers
      .filter((f) => inView(f.lat, f.lon))
      .flatMap((f) =>
        getVisibleWrappedLongitudes(f.lon, lomin, lomax).map((lngW) => ({
          ...f,
          lon: lngW,
          key: `${f.key}-w${lngW}`,
        }))
      );
  }, [fireMarkers, wrapBounds, inView]);

  const aisShipsList = useMemo(() => Object.values(aisShips), [aisShips]);

  const wrappedAisShips = useMemo(() => {
    const { lomin, lomax } = wrapBounds;
    return aisShipsList
      .filter(
        (ship) =>
          Number.isFinite(ship.lat) &&
          Number.isFinite(ship.lng) &&
          inView(ship.lat, ship.lng)
      )
      .flatMap((ship) =>
        getVisibleWrappedLongitudes(ship.lng, lomin, lomax).map((lngW) => ({
          ...ship,
          lng: lngW,
          key: `ais-${ship.mmsi}-w${lngW}`,
        }))
      );
  }, [aisShipsList, wrapBounds, inView]);

  const wrappedRadiationSensors = useMemo(() => {
    const { lomin, lomax } = wrapBounds;
    const filtered = radiationSensors.filter(
      (s) =>
        Number.isFinite(s.lat) &&
        Number.isFinite(s.lng) &&
        Number.isFinite(s.value) &&
        inView(s.lat, s.lng)
    );
    const result: (RadiationSensor & { key: string })[] = [];
    for (let i = 0; i < filtered.length; i++) {
      const s = filtered[i];
      const wrappedLngs = getVisibleWrappedLongitudes(s.lng, lomin, lomax);
      for (let w = 0; w < wrappedLngs.length; w++) {
        result.push({ ...s, lng: wrappedLngs[w], key: `rad-${i}-w${w}` });
      }
    }
    return result;
  }, [radiationSensors, wrapBounds, inView]);

  /** Chokepoints at each visible longitude copy so they appear when the map wraps. */
  const wrappedChokepoints = useMemo(() => {
    const { lomin, lomax } = wrapBounds;
    return STRATEGIC_CHOKEPOINTS.flatMap((cp) => {
      const [[lat1, lng1], [lat2, lng2]] = cp.bounds;
      const [labelLat, labelLng] = cp.label;
      return getVisibleWrappedLongitudes(labelLng, lomin, lomax).map((lngW) => {
        const offset = lngW - labelLng;
        return {
          name: cp.name,
          bounds: [
            [lat1, lng1 + offset] as [number, number],
            [lat2, lng2 + offset] as [number, number],
          ] as [[number, number], [number, number]],
          label: [labelLat, lngW] as [number, number],
          key: `${cp.name}-w${lngW}`,
        };
      });
    });
  }, [wrapBounds]);

  /** Orbital markers at each visible longitude copy. Key uses baseIndex + wrapIdx so it stays stable when position updates every second; otherwise the popup would close on refresh. */
  const wrappedSatellitePositions = useMemo(() => {
    const { lomin, lomax } = wrapBounds;
    return satellitePositions
      .filter((sat) => Number.isFinite(sat.lat) && Number.isFinite(sat.lng))
      .flatMap((sat, i) =>
        getVisibleWrappedLongitudes(sat.lng, lomin, lomax).map((lngW, wrapIdx) => {
          const lngDelta = sat.velocityEnd ? sat.velocityEnd[1] - sat.lng : 0;
          const velocityEndWrapped: [number, number] | null =
            sat.velocityEnd
              ? [sat.velocityEnd[0], lngW + lngDelta]
              : null;
          return {
            ...sat,
            lng: lngW,
            key: `orb-${i}-w${wrapIdx}`,
            baseIndex: i,
            velocityEndWrapped,
          };
        })
      );
  }, [satellitePositions, wrapBounds]);

  const trackedSet = useMemo(
    () => new Set(trackedCallsigns),
    [trackedCallsigns]
  );

  const trackedFlights = useMemo(
    () => flightData.filter((f) => trackedSet.has(f.callsign)),
    [trackedSet, flightData]
  );

  const setMapZoomStable = useCallback((z: number) => setMapZoom(z), []);

  const visibleFlights = useMemo(() => {
    const pad = VIEWPORT_CULL_BUFFER_DEG;
    const b = bounds ?? { lamin: -90, lomin: -180, lamax: 90, lomax: 180 };
    const { lamin, lomin, lamax, lomax } = b;
    const inBounds = (lat: number, lng: number) =>
      lat >= lamin - pad &&
      lat <= lamax + pad &&
      lng >= lomin - pad &&
      lng <= lomax + pad;
    type VisibleFlight = Omit<(typeof flightData)[number], "velocityEnd"> & {
      lng: number;
      key: string;
      velocityEnd?: [number, number];
    };
    const out: VisibleFlight[] = [];
    for (const f of flightData) {
      const lngs = getVisibleWrappedLongitudes(f.lng, lomin, lomax);
      const tracked = trackedSet.has(f.callsign);
      for (const lngW of lngs) {
        if (inBounds(f.lat, lngW) || tracked) {
          const velocityEnd = computeVelocityEndpoint(f.lat, lngW, f.heading, f.velocity) ?? undefined;
          out.push({
            ...f,
            lng: lngW,
            key: `${f.key}-w${lngW}`,
            velocityEnd,
          });
        }
      }
    }
    return out;
  }, [flightData, bounds, trackedSet]);

  const handleTrackAircraft = useCallback((callsign: string) => {
    if (!callsign) return;
    setTrackedCallsigns((prev) =>
      prev.includes(callsign) ? prev : [...prev, callsign]
    );
  }, []);

  const handleUntrackAircraft = useCallback((callsign: string) => {
    setTrackedCallsigns((prev) => prev.filter((c) => c !== callsign));
  }, []);

  // Stable position refs so Popup's useEffect (position in deps) doesn't tear down/reopen on every re-render
  const positionCacheRef = useRef<Record<string, [number, number]>>({});
  const getStablePosition = useCallback((key: string, lat: number, lng: number): [number, number] => {
    const safeLat = Number.isFinite(lat) ? lat : 0;
    const safeLng = Number.isFinite(lng) ? lng : 0;
    const cached = positionCacheRef.current[key];
    if (cached && cached[0] === safeLat && cached[1] === safeLng) return cached;
    const next: [number, number] = [safeLat, safeLng];
    positionCacheRef.current[key] = next;
    return next;
  }, []);

  return (
    <section className="flex flex-col h-full bg-panel border border-panel-border">
      {/* Header bar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-panel-border bg-tactical-charcoal">
        <div className="flex items-center gap-2">
          <Radio className="w-3.5 h-3.5 text-accent-red" />
          <span className="font-mono text-[11px] font-bold tracking-widest text-text-primary">
            THEATER MAP // GLOBAL
          </span>
        </div>
        <div className="flex items-center gap-4">
          <span className="font-mono text-[10px] text-accent-red">
            {events.length} EVENTS
          </span>
          <span className="font-mono text-[10px] text-amber-500">
            {flights.length} ACFT
          </span>
          <span className="font-mono text-[10px] text-yellow-500">
            {seismic.length} SEISMIC
          </span>
          <span className="font-mono text-[10px] text-orange-500">
            {fires.length} FIRES
          </span>
          <span className="font-mono text-[10px] text-[#b24bf3]">
            {satellitePositions.length} SATS
          </span>
          <span className="font-mono text-[10px] text-cyan-400">
            {Object.keys(aisShips).length} AIS
          </span>
          <span className="font-mono text-[10px] text-[#39ff14]">
            {radiationSensors.length} RAD
          </span>
          <div
            className={`w-1.5 h-1.5 ${
              loading
                ? "bg-accent-amber animate-pulse-amber"
                : "bg-accent-green"
            }`}
          />
        </div>
      </div>

      {/* Map area */}
      <div className="flex-1 relative min-h-0">
        {initialLoad && (
          <div
            className="absolute inset-0 z-[1100] flex flex-col items-center justify-center bg-tactical-black/90 pointer-events-auto"
            aria-live="polite"
            aria-busy="true"
          >
            <div className="flex items-center gap-2 font-mono text-xs text-accent-amber">
              <Loader2 className="w-5 h-5 animate-spin" />
              LOADING THEATER DATA...
            </div>
            <p className="font-mono text-[10px] text-text-muted mt-2 max-w-[240px] text-center">
              Fetching map layers. The map will become interactive when ready.
            </p>
          </div>
        )}

        <MapContainer
          center={[25, 42]}
          zoom={3}
          minZoom={2}
          maxZoom={14}
          zoomControl={false}
          className="w-full h-full"
          style={{ background: "#0a0a0a" }}
        >
          <TileLayer
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}"
            attribution=""
          />

          <BoundsTracker onBoundsChange={handleBoundsChange} onVisibleLngRange={handleVisibleLngRange} />
          <MapZoomReporter onZoomChange={setMapZoomStable} />
          <ZoomSync zoom={mapZoom} />
          <TrackedSatelliteView positions={satellitePositions} trackedIndex={trackedSatelliteIndex} positionsVersion={satellitePositionsVersion} />

          {/* GDELT Intel markers -- clustered, pulsing red diamonds */}
          {layers.gdelt && (
            <MarkerClusterGroup
              chunkedLoading
              iconCreateFunction={conflictClusterIcon}
              maxClusterRadius={60}
              spiderfyOnMaxZoom
              disableClusteringAtZoom={10}
            >
              {wrappedGdeltMarkers.map((e) => (
                <Marker key={e.key} position={getStablePosition(e.key, e.lat, e.lng)} icon={e.icon}>
                  <Popup>
                    <div className="popup-card">
                      <div className="popup-label popup-label--conflict">
                        SIGINT // GDELT EVENT
                      </div>
                      <p className="popup-body">{e.name}</p>
                      <div className="popup-meta">{e.count} reports</div>
                      {e.url && e.url !== "#" && (
                        <a
                          href={e.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="popup-link"
                        >
                          <ExternalLink
                            style={{ width: 12, height: 12, display: "inline" }}
                          />{" "}
                          SOURCE ARTICLE
                        </a>
                      )}
                      <div className="popup-meta popup-freshness mt-1.5 pt-1.5 border-t border-panel-border">
                        Data refreshed {formatTimeAgo(freshness.gdelt)} · {formatExactTime(freshness.gdelt)}
                      </div>
                    </div>
                  </Popup>
                </Marker>
              ))}
            </MarkerClusterGroup>
          )}

          {/* Aircraft -- viewport-culled, clustered when zoomed out; velocity vectors at zoom 8+ or tracked */}
          {layers.aircraft && (
            <>
              <MarkerClusterGroup
                chunkedLoading
                iconCreateFunction={aircraftClusterIcon}
                maxClusterRadius={28}
                spiderfyOnMaxZoom
                disableClusteringAtZoom={6}
              >
                {visibleFlights.map((f) => {
                  const isTracked =
                    f.callsign !== "" && trackedSet.has(f.callsign);
                  return (
                    <Marker
                      key={f.key}
                      position={getStablePosition(f.key, f.lat, f.lng)}
                      icon={
                        isTracked
                          ? makeTrackedAircraftIcon(f.heading)
                          : f.icon
                      }
                      zIndexOffset={isTracked ? 1000 : 0}
                    >
                      <Popup>
                        <div className="popup-card">
                          <div className="popup-label popup-label--flight">
                            AIRCRAFT
                          </div>
                          {f.callsign && (
                            <button
                              type="button"
                              className={`popup-track-btn ${isTracked ? "popup-track-btn--active" : ""}`}
                              title={isTracked ? "Untrack" : "Track aircraft"}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (isTracked) {
                                  handleUntrackAircraft(f.callsign);
                                } else {
                                  handleTrackAircraft(f.callsign);
                                }
                              }}
                            >
                              {isTracked ? (
                                <X style={{ width: 14, height: 14 }} />
                              ) : (
                                <Crosshair style={{ width: 14, height: 14 }} />
                              )}
                            </button>
                          )}
                          <div className="popup-row">
                            <span className="popup-row-key">CALLSIGN</span>
                            <span className="popup-row-val">
                              {f.callsign || "N/A"}
                            </span>
                          </div>
                          <div className="popup-row">
                            <span className="popup-row-key">ALT</span>
                            <span className="popup-row-val">
                              {f.altitude != null
                                ? `${Math.round(f.altitude).toLocaleString()} m`
                                : "N/A"}
                            </span>
                          </div>
                          <div className="popup-row">
                            <span className="popup-row-key">VEL</span>
                            <span className="popup-row-val">
                              {f.velocity != null
                                ? `${Math.round(f.velocity)} m/s`
                                : "N/A"}
                            </span>
                          </div>
                          <div className="popup-row">
                            <span className="popup-row-key">HDG</span>
                            <span className="popup-row-val">
                              {f.heading != null
                                ? `${Math.round(f.heading)}°`
                                : "N/A"}
                            </span>
                          </div>
                          <div className="popup-row">
                            <span className="popup-row-key">ORIGIN</span>
                            <span className="popup-row-val">
                              {f.origin || "UNK"}
                            </span>
                          </div>
                          <div className="popup-row">
                            <span className="popup-row-key">SRC</span>
                            <span className="popup-row-val">
                              {(f.source ?? "mixed").toString().toUpperCase()}
                            </span>
                          </div>
                          <div className="popup-meta popup-freshness mt-1.5 pt-1.5 border-t border-panel-border">
                            Data refreshed {formatTimeAgo(freshness.aircraft)} · {formatExactTime(freshness.aircraft)}
                          </div>
                        </div>
                      </Popup>
                    </Marker>
                  );
                })}
              </MarkerClusterGroup>
              {visibleFlights.map((f) => {
                const isTracked =
                  f.callsign !== "" && trackedSet.has(f.callsign);
                const showVelocity =
                  f.velocityEnd &&
                  (mapZoom >= VELOCITY_VECTOR_MIN_ZOOM || isTracked);
                if (!showVelocity) return null;
                return (
                  <Polyline
                    key={`vec-${f.key}`}
                    positions={[
                      [f.lat, f.lng],
                      f.velocityEnd as [number, number],
                    ]}
                    pathOptions={{
                      color: "#c9a227",
                      weight: isTracked ? 2.5 : 1.5,
                      opacity: isTracked ? 0.7 : 0.4,
                      dashArray: "4 6",
                    }}
                  />
                );
              })}
            </>
          )}

          {/* Seismic events -- clustered, yellow warning triangles */}
          {layers.seismic && (
            <MarkerClusterGroup
              chunkedLoading
              iconCreateFunction={seismicClusterIcon}
              maxClusterRadius={50}
              spiderfyOnMaxZoom
              disableClusteringAtZoom={8}
            >
              {wrappedSeismicMarkers.map((s) => (
                <Marker key={s.key} position={getStablePosition(s.key, s.lat, s.lng)} icon={s.icon}>
                  <Popup>
                    <div className="popup-card">
                      <div className="popup-label popup-label--seismic">
                        SEISMIC EVENT
                      </div>
                      <p className="popup-body">{s.title}</p>
                      <div className="popup-row">
                        <span className="popup-row-key">MAG</span>
                        <span className="popup-row-val">{s.mag.toFixed(1)}</span>
                      </div>
                      <div className="popup-row">
                        <span className="popup-row-key">DEPTH</span>
                        <span className="popup-row-val">
                          {s.depth.toFixed(1)} km
                        </span>
                      </div>
                      <div className="popup-row">
                        <span className="popup-row-key">TIME</span>
                        <span className="popup-row-val">
                          {new Date(s.time).toLocaleString("en-US", {
                            hour12: false,
                            month: "short",
                            day: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                      {s.tsunami && (
                        <div className="popup-meta" style={{ color: "#ff2020" }}>
                          TSUNAMI WARNING
                        </div>
                      )}
                      {s.url && (
                        <a
                          href={s.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="popup-link"
                        >
                          <ExternalLink
                            style={{ width: 12, height: 12, display: "inline" }}
                          />{" "}
                          USGS DETAIL
                        </a>
                      )}
                      <div className="popup-meta popup-freshness mt-1.5 pt-1.5 border-t border-panel-border">
                        Data refreshed {formatTimeAgo(freshness.seismic)} · {formatExactTime(freshness.seismic)}
                      </div>
                    </div>
                  </Popup>
                </Marker>
              ))}
            </MarkerClusterGroup>
          )}

          {/* NASA FIRMS thermal anomalies -- clustered orange/red squares */}
          {layers.fires && (
            <MarkerClusterGroup
              chunkedLoading
              iconCreateFunction={fireClusterIcon}
              maxClusterRadius={55}
              spiderfyOnMaxZoom
              disableClusteringAtZoom={9}
            >
              {wrappedFireMarkers.map((fire) => (
                <Marker key={fire.key} position={getStablePosition(fire.key, fire.lat, fire.lon)} icon={fire.icon}>
                  <Popup>
                    <div className="popup-card">
                      <div className="popup-label popup-label--fire">
                        THERMAL ANOMALY DETECTED
                      </div>
                      <div className="popup-row">
                        <span className="popup-row-key">BRIGHTNESS</span>
                        <span className="popup-row-val">
                          {fire.brightness != null ? `${fire.brightness.toFixed(1)} K` : "N/A"}
                        </span>
                      </div>
                      {fire.confidence && (
                        <div className="popup-row">
                          <span className="popup-row-key">CONFIDENCE</span>
                          <span className="popup-row-val">{fire.confidence}</span>
                        </div>
                      )}
                      <div className="popup-meta popup-freshness mt-1.5 pt-1.5 border-t border-panel-border">
                        Data refreshed {formatTimeAgo(freshness.fires)} · {formatExactTime(freshness.fires)}
                      </div>
                    </div>
                  </Popup>
                </Marker>
              ))}
            </MarkerClusterGroup>
          )}

          {/* Live Orbital Tracking -- wrapped for infinite scroll so sats show in every visible world copy */}
          {layers.orbital &&
            wrappedSatellitePositions.map((wrapped) => {
              const isTracked = trackedSatelliteIndex === wrapped.baseIndex;
              return (
              <Marker
                key={wrapped.key}
                position={getStablePosition(wrapped.key, wrapped.lat, wrapped.lng)}
                icon={isTracked ? makeTrackedSatelliteIcon() : makeSatelliteIcon()}
                zIndexOffset={isTracked ? 1000 : 0}
              >
                <Popup>
                  <div className="popup-card">
                    <div className="popup-label popup-label--orbital">
                      ORBITAL ASSET
                    </div>
                    {trackedSatelliteIndex === wrapped.baseIndex ? (
                      <button
                        type="button"
                        className="popup-track-btn popup-track-btn--active"
                        title="Stop tracking"
                        onClick={(e) => {
                          e.stopPropagation();
                          setTrackedSatelliteIndex(null);
                        }}
                      >
                        <X style={{ width: 14, height: 14 }} />
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="popup-track-btn"
                        title="Track satellite — map will follow"
                        onClick={(e) => {
                          e.stopPropagation();
                          setTrackedSatelliteIndex(wrapped.baseIndex);
                        }}
                      >
                        <Crosshair style={{ width: 14, height: 14 }} />
                      </button>
                    )}
                    <p className="popup-body">{wrapped.name}</p>
                    {wrapped.height != null && (
                      <div className="popup-row">
                        <span className="popup-row-key">ALT</span>
                        <span className="popup-row-val">
                          {wrapped.height.toFixed(0)} km
                        </span>
                      </div>
                    )}
                    <div className="popup-row">
                      <span className="popup-row-key">LAT / LON</span>
                      <span className="popup-row-val">
                        {wrapped.lat.toFixed(4)}°, {wrapped.lng.toFixed(4)}°
                      </span>
                    </div>
                    <div className="popup-meta popup-freshness mt-1.5 pt-1.5 border-t border-panel-border">
                      Data refreshed {formatTimeAgo(freshness.orbital)} · {formatExactTime(freshness.orbital)}
                    </div>
                  </div>
                </Popup>
              </Marker>
            );
            })}

          {/* Tracked satellite direction vector -- like aircraft velocity */}
          {layers.orbital &&
            trackedSatelliteIndex != null &&
            wrappedSatellitePositions
              .filter(
                (w) =>
                  w.baseIndex === trackedSatelliteIndex && w.velocityEndWrapped
              )
              .map((w) => (
                <Polyline
                  key={`orb-vec-${w.key}`}
                  positions={[
                    [w.lat, w.lng],
                    w.velocityEndWrapped as [number, number],
                  ]}
                  pathOptions={{
                    color: "#b24bf3",
                    weight: 2,
                    opacity: 0.7,
                    dashArray: "6 8",
                  }}
                />
              ))}

          {/* Strategic Chokepoints -- dashed green boxes with labels (wrapped for infinite scroll) */}
          {layers.chokepoints &&
            wrappedChokepoints.map((cp) => (
              <span key={cp.key}>
                <Rectangle
                  bounds={cp.bounds}
                  pathOptions={{
                    color: "#556b2f",
                    weight: 1.5,
                    opacity: 0.6,
                    fillOpacity: 0.04,
                    dashArray: "6 4",
                  }}
                />
                <Marker
                  position={cp.label}
                  icon={makeChokepointLabel(cp.name)}
                  interactive={false}
                />
              </span>
            ))}
          {/* Live Maritime Logistics (AIS) — clustered like aircraft */}
          {layers.maritime && (
            <MarkerClusterGroup
              chunkedLoading
              iconCreateFunction={maritimeClusterIcon}
              maxClusterRadius={50}
              spiderfyOnMaxZoom
              disableClusteringAtZoom={8}
            >
              {wrappedAisShips.map((ship) => (
                <Marker
                  key={ship.key}
                  position={getStablePosition(ship.key, ship.lat, ship.lng)}
                  icon={makeShipIcon(ship.cog)}
                >
                  <Popup>
                    <div className="popup-card">
                      <div className="popup-label">
                        MARITIME AIS TRACK
                      </div>
                      <div className="popup-row">
                        <span className="popup-row-key">MMSI</span>
                        <span className="popup-row-val">{ship.mmsi}</span>
                      </div>
                      <div className="popup-row">
                        <span className="popup-row-key">SOG</span>
                        <span className="popup-row-val">
                          {ship.sog != null ? `${ship.sog.toFixed(1)} kn` : "N/A"}
                        </span>
                      </div>
                      <div className="popup-row">
                        <span className="popup-row-key">NAV STATUS</span>
                        <span className="popup-row-val">
                          {ship.navStatus ?? "UNK"}
                        </span>
                      </div>
                      <div className="popup-meta popup-freshness mt-1.5 pt-1.5 border-t border-panel-border">
                        Data refreshed {formatTimeAgo(freshness.maritime)} · {formatExactTime(freshness.maritime)}
                      </div>
                    </div>
                  </Popup>
                </Marker>
              ))}
            </MarkerClusterGroup>
          )}
          {/* Radiation Sensors (Safecast) */}
          {layers.radiation && (
            <MarkerClusterGroup
              chunkedLoading
              iconCreateFunction={radiationClusterIcon}
              maxClusterRadius={55}
              spiderfyOnMaxZoom
              disableClusteringAtZoom={10}
            >
              {wrappedRadiationSensors.map((s) => {
                const v = s.value;
                const basePos = getStablePosition(s.key, s.lat, s.lng);
                let className = "radiation-point-low";
                if (v >= 0.5 && v <= 2.0) {
                  className = "radiation-point-med";
                } else if (v > 2.0) {
                  className = "radiation-point-high";
                }
                return (
                  <Marker
                    key={s.key}
                    position={basePos}
                    icon={L.divIcon({
                      html: `<span class="radiation-dot ${className}${v > 2.0 ? " critical-radiation-pulse" : ""}"></span>`,
                      className: "radiation-icon-wrapper",
                      iconSize: [16, 16],
                      iconAnchor: [8, 8],
                    })}
                  >
                    <Popup>
                      <div className="popup-card">
                        <div className="popup-label">SAFECAST SENSOR</div>
                        <div className="popup-row">
                          <span className="popup-row-key">LEVEL</span>
                          <span className="popup-row-val">
                            {v.toFixed(3)} μSv/h
                          </span>
                        </div>
                        <div className="popup-row">
                          <span className="popup-row-key">CAPTURED</span>
                          <span className="popup-row-val">
                            {new Date(s.capturedAt).toLocaleString("en-US", {
                              hour12: false,
                              month: "short",
                              day: "2-digit",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        </div>
                        <div className="popup-meta popup-freshness mt-1.5 pt-1.5 border-t border-panel-border">
                          Layer refreshed {formatTimeAgo(freshness.radiation)} · {formatExactTime(freshness.radiation)}
                        </div>
                      </div>
                    </Popup>
                  </Marker>
                );
              })}
            </MarkerClusterGroup>
          )}
        </MapContainer>

        {/* Bottom-left: orbital tracking pill (when tracking) above layer toggle */}
        <div className="absolute bottom-4 left-4 z-[1000] flex flex-col-reverse gap-2">
          <LayerToggle
            layers={layers}
            layerLoading={layerLoading}
            onToggle={toggleLayer}
          />
          {layers.orbital && trackedSatelliteIndex != null && satellitePositions[trackedSatelliteIndex] && (
            <div className="tracking-panel" style={{ maxWidth: 220 }}>
              <div className="tracking-panel-header">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-[#b24bf3] shrink-0">◆</span>
                  <span className="font-mono text-[10px] truncate" title={satellitePositions[trackedSatelliteIndex].name}>
                    TRACKING: {satellitePositions[trackedSatelliteIndex].name}
                  </span>
                </div>
                <button
                  className="tracking-panel-close shrink-0"
                  onClick={() => setTrackedSatelliteIndex(null)}
                  title="Stop tracking"
                >
                  <X style={{ width: 12, height: 12 }} />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Bottom-right: zoom slider for precise control */}
        <div className="absolute bottom-4 right-4 z-[1000] flex flex-col items-end gap-2 pointer-events-none">
          {/* API error notifications */}
          {(() => {
            const msgs: string[] = [];
            const keys: LayerKey[] = ["aircraft", "gdelt", "seismic", "fires", "maritime", "radiation"];
            for (const key of keys) {
              const code = layerStatusCodes?.[key];
              if (typeof code === "number" && code >= 400) {
                msgs.push(`${key.toUpperCase()} ${code}`);
              }
            }
            if (aircraftApiStatus) {
              const { opensky, adsbfi, adsblol, theairtraffic } = aircraftApiStatus;
              if (typeof opensky === "number" && opensky >= 400) msgs.push(`OpenSky ${opensky}`);
              if (typeof adsbfi === "number" && adsbfi >= 400) msgs.push(`adsb.fi ${adsbfi}`);
              if (typeof adsblol === "number" && adsblol >= 400) msgs.push(`ADSB.lol ${adsblol}`);
              if (typeof theairtraffic === "number" && theairtraffic >= 400)
                msgs.push(`TheAirTraffic ${theairtraffic}`);
            }
            if (!msgs.length) return null;
            return (
              <div className="pointer-events-auto bg-tactical-dark/95 border border-accent-red/60 px-3 py-2 rounded-sm shadow-lg max-w-xs">
                <div className="font-mono text-[9px] text-accent-red tracking-widest mb-1">
                  DATA ALERT
                </div>
                <div className="font-mono text-[9px] text-text-secondary space-y-0.5">
                  {msgs.slice(0, 4).map((m) => (
                    <div key={m}>{m}</div>
                  ))}
                  {msgs.length > 4 && (
                    <div>+ {msgs.length - 4} more</div>
                  )}
                </div>
              </div>
            );
          })()}

          <div className="bg-tactical-dark/90 border border-panel-border px-3 py-1.5 rounded-sm shadow-lg flex items-center gap-3 pointer-events-auto">
            <span className="font-mono text-[9px] text-text-muted tracking-widest">
              ZOOM
            </span>
            <input
              type="range"
              min={2}
              max={14}
              step={0.5}
              value={mapZoom}
              onChange={(e) => {
                const z = Number(e.target.value);
                if (!Number.isFinite(z)) return;
                setMapZoomStable(z);
              }}
              className="w-40 accent-accent-amber cursor-pointer"
            />
            <span className="font-mono text-[9px] text-text-secondary w-8 text-right">
              {mapZoom.toFixed(1)}x
            </span>
          </div>
        </div>

        {/* Aircraft Tracking Panel -- bottom right, floating over map */}
        {trackedCallsigns.length > 0 && (
          <div className="absolute bottom-4 right-4 z-[1000]">
            <div className="tracking-panel">
              <div className="tracking-panel-header">
                <div className="flex items-center gap-1.5">
                  <Crosshair
                    style={{ width: 11, height: 11 }}
                    className="animate-pulse-amber"
                  />
                  <span>
                    TRACKING ({trackedCallsigns.length})
                  </span>
                </div>
                <button
                  className="tracking-panel-close"
                  onClick={() => setTrackedCallsigns([])}
                >
                  <X style={{ width: 12, height: 12 }} />
                </button>
              </div>
              <div className="tracking-panel-body tracking-panel-scroll">
                {trackedCallsigns.map((cs) => {
                  const tf = trackedFlights.find((f) => f.callsign === cs);
                  return (
                    <div key={cs} className="tracking-entry">
                      <div className="tracking-entry-header">
                        <span className="tracking-entry-callsign">{cs}</span>
                        <button
                          className="tracking-panel-close"
                          onClick={() => handleUntrackAircraft(cs)}
                          title="Untrack"
                        >
                          <X style={{ width: 10, height: 10 }} />
                        </button>
                      </div>
                      {tf ? (
                        <>
                          <div className="popup-row">
                            <span className="popup-row-key">ALT</span>
                            <span className="popup-row-val">
                              {tf.altitude != null
                                ? `${Math.round(tf.altitude).toLocaleString()} m`
                                : "N/A"}
                            </span>
                          </div>
                          <div className="popup-row">
                            <span className="popup-row-key">VEL</span>
                            <span className="popup-row-val">
                              {tf.velocity != null
                                ? `${Math.round(tf.velocity)} m/s`
                                : "N/A"}
                            </span>
                          </div>
                          <div className="popup-row">
                            <span className="popup-row-key">HDG</span>
                            <span className="popup-row-val">
                              {tf.heading != null
                                ? `${Math.round(tf.heading)}°`
                                : "N/A"}
                            </span>
                          </div>
                          <div className="popup-row">
                            <span className="popup-row-key">POS</span>
                            <span className="popup-row-val">
                              {tf.lat.toFixed(3)}, {tf.lng.toFixed(3)}
                            </span>
                          </div>
                        </>
                      ) : (
                        <div className="tracking-signal-lost">
                          <span>SIGNAL LOST</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Scanline overlay */}
        <div className="absolute inset-0 pointer-events-none z-[999]">
          <div className="absolute inset-0 bg-gradient-to-b from-accent-green/[0.02] to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 h-px bg-accent-green/10" />
          <div className="absolute top-0 left-0 right-0 h-px bg-accent-green/10" />
        </div>
      </div>
    </section>
  );
}

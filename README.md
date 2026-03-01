## Cognito Events Dashboard

Real-time geopolitical events dashboard: conflict tracking, live air and maritime traffic, markets, and curated intel — built with Next.js (App Router), React, and Leaflet.

---

## Features

- **Global theater map**: Live aircraft, maritime AIS, GDELT events, seismic activity, wildfires, orbital assets, chokepoints, and radiation sensors.
- **Strategic markets & resources**: Curated ETF/equity basket (gold, oil, volatility, treasuries, defense stocks, USD).
- **Intel feed**: NewsAPI-powered SITREP panel focused on geopolitical and military topics.
- **Cyber & telecom status**: IODA outage signals summarized for the last \(N\) hours.
- **Layer freshness & health**: Per-layer timestamps and API health indicators in the status bar.

---

## Getting started

### Prerequisites

- **Node.js** 18+ and **npm**.
- Accounts/API keys for the optional data providers you want to enable (see below).

### Clone and install

```bash
git clone https://github.com/<your-user>/cognitio.git
cd cognitio
npm install
```

### Configure environment

Create a `.env.local` file in the project root:

```bash
cp .env.example .env.local   # or create it by hand using the table below
```

Set the variables you care about:

- Values marked **required** must be set for that feature to work.
- Everything else is **optional**; routes will degrade gracefully if a key is missing.

| Variable              | Required? | Used by           | Notes |
| --------------------- | --------- | ----------------- | ----- |
| `FINNHUB_API_KEY`     | Optional  | Markets           | Primary quotes source. Free tier from `https://finnhub.io/`. |
| `TWELVEDATA_API_KEY`  | Optional  | Markets           | Fallback if Finnhub is missing/failing. `https://twelvedata.com/`. |
| `NEWSAPI_KEY`         | Optional  | Intel feed        | NewsAPI for SITREP. `https://newsapi.org/`. |
| `NASA_FIRMS_API_KEY`  | Optional  | Fires layer       | NASA FIRMS MAP_KEY. `https://firms.modaps.eosdis.nasa.gov/`. |
| `AISSTREAM_API_KEY`   | Optional  | Maritime AIS      | Aisstream.io websocket proxy. `https://aisstream.io/`. |
| `OPEN_SKY_ENABLED`    | Optional  | Flights           | If set to `0`, `false`, or `off`, skips OpenSky entirely and relies on ADS-B sources only. |

Data sources that **do not require keys** (used directly via their public APIs): OpenSky (anonymous mode), adsb.fi, ADSB.lol, TheAirTraffic, GDELT, USGS, IODA, Safecast, and CelesTrak.

### Run the app

```bash
npm run dev
```

Then open `http://localhost:3000` in your browser.

---

## Architecture overview

- **Frontend**: Single-page dashboard layout with header ticker, left sidebar (markets + cyber), center map, right intel feed, and footer status bar.
- **API layer**: Next.js Route Handlers under `src/app/api/*` that proxy and normalize upstream APIs, with cache headers tuned to free-tier limits.
- **State**: React state + `LayerFreshnessContext` for per-layer timestamps and aircraft API health, plus local panel state for polling and loading.
- **Map**: Leaflet via `react-leaflet`, with clustering, viewport culling, and longitude wrapping for a smooth “infinite scroll” world.

### Key components

- `Dashboard` — main layout wiring together ticker, map, intel, and side panels.
- `ConflictMap` — Leaflet map and all layers (aircraft, AIS, GDELT, seismic, fires, satellites, chokepoints, radiation).
- `CommodityTicker` — top ticker with threat level badge and market snapshots.
- `MarketPanel` — “Strategic Markets & Resources” quotes panel.
- `IntelFeed` — right-hand intel/SITREP feed from NewsAPI.
- `CyberGrid` — cyber/telecom outage summary from IODA.
- `StatusBar` — bottom strip with system status, per-layer freshness, and UTC clock.

---

## Data flows (high level)

1. **Flights**: `/api/flights` merges OpenSky + multiple ADS-B sources into a unified list and is polled from the client.
2. **Markets**: `/api/markets` hits Finnhub first, then falls back to Twelve Data if necessary; the client polls every few minutes.
3. **Cyber (IODA)**: `/api/cyber` fetches recent outage signals; the cyber panel polls periodically and shows “last refresh”.
4. **GDELT**: `/api/gdelt` powers both the map conflict layer and threat-level calculations.
5. **Seismic**: `/api/seismic` wraps the USGS GeoJSON feed for recent earthquakes.
6. **Fires**: `/api/fires` queries NASA FIRMS with the current map bbox for thermal anomalies.
7. **Intel**: `/api/intel` calls NewsAPI for geopolitically relevant articles.
8. **Satellites**: `/api/satellites` fetches TLE from CelesTrak once; the browser uses `tle.js` to propagate positions every second.
9. **Maritime AIS**: `/api/ais` connects to Aisstream.io over WebSocket, aggregates ships, and caches by bbox.
10. **Radiation**: `/api/radiation` queries Safecast for recent µSv/h measurements in the current map window.

---

## Commands

- `npm run dev` — Start the Next.js development server (default port 3000).
- `npm run build` — Production build.
- `npm run start` — Run the production server after `build`.
- `npm run lint` — Run ESLint.

---

## Contributing / local testing

- **Lint**: Run `npm run lint` before opening a PR.
- **Build**: Run `npm run build` to catch type and build errors.
- **Manual testing**:
  - With keys configured, verify each panel (markets, cyber, map layers, intel) populates as expected.
  - With specific keys removed, confirm error and empty states are graceful (e.g. “SIGNAL LOST”, “FEED TEMPORARILY UNAVAILABLE”) and that the rest of the dashboard still works.

---

## Security and keys

- Keep your `.env.local` **out of version control** (GitHub) — it should never be committed.
- Only variables prefixed with `NEXT_PUBLIC_` are exposed to the browser; this project intentionally keeps third-party keys server-side where possible.
- If you open-source a fork, regenerate any keys you used during development before sharing screenshots or logs that may contain request URLs.


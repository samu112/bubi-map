# Bubi Live — Budapest bike finder

A lightweight, real-time map of MOL Bubi bike-share stations. Filter by
electric / mechanical / both, hide empty stations, and jump to the nearest
bikes. Installable as a home-screen PWA; works on desktop too.

**Unofficial project.** Not affiliated with or endorsed by BKK, MOL or Inurba.
MOL Bubi and Bubi are trademarks of their respective owners.

Built to the `bubi-map-project-plan.md` spec. Uses **only the public GBFS v2.3
feed** — no login, no private API, no reverse-engineering. Reservations are
already excluded from the availability counts upstream, so "available" means
free to rent right now.

**Data source: BKK Zrt., CC BY 4.0.** BKK's
[open-data portal](https://opendata.bkk.hu/data-sources) publishes its CC BY 4.0
terms and the exact attribution wording used here; the MOL Bubi feed itself is
published via Urban Sharing's public GBFS endpoint,
`https://gbfs.urbansharing.com/molbubi.hu`. Map tiles via
[OpenFreeMap](https://openfreemap.org) — free vector tiles, no API key — built
from OpenStreetMap data (© OpenStreetMap contributors, ODbL).

---

## How it works

```
GBFS feeds (Urban Sharing)
   │  polled every 20s server-side, with a Client-Identifier header
   ▼
Node.js + Express (in-memory, no database)
   ├─ merges station_information + station_status + vehicle_types
   ├─ GET /snapshot  → current dataset (first page load)
   ├─ GET /stream    → Server-Sent Events, pushes each new poll
   └─ GET /healthz   → liveness probe
   │  SSE push, near-instant after each poll
   ▼
Static frontend (MapLibre GL JS + Supercluster, plain JS)
   └─ all filtering done client-side, installable PWA, map rotation supported
```

Only `station_status` is polled every 20s. The near-static feeds
(`station_information`, `vehicle_types`) refresh every 10 minutes. The 20s
cadence respects the CC BY 4.0 rate-limit guidance (refetch no more than once
every 15–30s). If an upstream poll fails, the last known-good snapshot keeps
being served.

## Layout

```
bubi-map/
├── server/            # Express: gbfs.js (fetch+merge), index.js (routes+SSE)
├── public/            # index.html, app.js, style.css, manifest.json, icons/
├── Dockerfile
└── docker-compose.yml
```

## Configuration (env vars, optional)

| Var                  | Default          | Meaning                                   |
|----------------------|------------------|-------------------------------------------|
| `PORT`               | `3000`           | Port the server listens on                |
| `CLIENT_IDENTIFIER`  | `bubi-live-map`  | Sent as the `Client-Identifier` header    |
| `STATUS_INTERVAL_MS` | `20000`          | Status poll cadence (keep 15000–30000)    |
| `STATIC_INTERVAL_MS` | `600000`         | Refresh cadence for station info / types  |
| `GBFS_BASE`          | live Urban Sharing URL | Override feed host (used for testing) |

## Run locally (without Docker)

```bash
cd server
npm install
npm start          # → http://localhost:3000
```

## Notes / possible next steps

- **Cluster counts:** a station cluster now shows the *total bikes* the
  clustered stations hold, not the number of stations — Supercluster's own
  `point_count` is "how many features got merged" which, for the stations
  layer, means station count, a different unit from every other number in
  the app (pins, popups, the tally are always bike counts). Zoomed all the
  way out, that used to show something like "197" (basically every station
  in the city) sitting right next to a "1,147 bikes" tally — technically
  correct for what it was counting, but an easy thing to misread as "only
  197 bikes total". Fixed by summing `countFor()` across the cluster's
  leaves instead. Bike clusters were already correct (each leaf is one
  bike, so point_count already was a bike count) and are unchanged.
- **Compass heading:** the location dot grows a small directional cone once a
  trustworthy compass reading exists — like Google Maps' "which way am I
  facing" indicator, distinct from GPS movement heading (which is null while
  standing still, exactly when you're checking the map). Uses the device's
  magnetometer via `DeviceOrientationEvent`, requested from the same "find
  me" tap since iOS requires that permission call to come directly from a
  user gesture. MapLibre's marker `rotation` + `rotationAlignment: 'map'`
  keeps the cone pointing the correct real-world direction automatically as
  the map itself rotates — no manual angle math needed on map rotate.
  Degrades silently: no magnetometer, permission declined, or a browser that
  only offers relative (non-absolute) orientation data all just mean the dot
  stays a plain dot rather than showing a direction that might be wrong.
- **Map style:** switched from the minimal "Positron" style to "Liberty" —
  OpenFreeMap's fullest-detail style (land use, POIs, fuller road hierarchy),
  closer to the original raster OSM look, still vector so rotation keeps
  labels upright. Same URL pattern, so switching again later is a one-line
  change (`/styles/positron`, `/styles/bright`, `/styles/liberty`).
- **Marker responsiveness:** clusters now split/merge progressively during a
  zoom or rotate gesture instead of all at once when it finishes — reconcile
  runs on `move` (throttled to at most once per animation frame via
  `requestAnimationFrame`), not just `moveend`.
- **Dark mode:** defaults to the OS's `prefers-color-scheme`, with a manual
  toggle in the settings panel that overrides it (saved to localStorage) —
  standard "auto, with an escape hatch" pattern. Two independent pieces:
  - **UI** (panels, popups, markers): every colour in the stylesheet is a CSS
    custom property with a dark-mode override, defined once in a
    `@media (prefers-color-scheme: dark)` block plus an identical
    `html[data-theme="dark"]` block for the explicit-override path (kept
    programmatically in sync — verified no drift between the two). Filled
    surfaces (station pins, clusters, solid buttons) use `--X`/`--on-X` pairs
    that literally swap values between modes, so "dark shape, light content"
    in light mode becomes "light shape, dark content" in dark mode with no
    separate logic — only the empty-station treatment needed genuinely new
    colours, since it's supposed to look muted *relative to its own mode*,
    not simply inverted. One exception worth knowing if this file gets
    touched again: the `.select` dropdown arrow is a data-URI SVG with a
    baked-in fill colour, so it can't read a CSS variable — it has its own
    explicit dark-mode override rather than inheriting automatically like
    everything else.
  - **Map**: Liberty (and every other OpenFreeMap style) has no dark variant
    worth using — OpenFreeMap's own maintainer flags Dark/Fiord as
    unfinished. Instead, a CSS `filter` (`invert(90%) hue-rotate(180deg)
    brightness(95%) contrast(105%)`) is applied to just the
    `.maplibregl-canvas` element in dark mode. Since that's a separate DOM
    layer from every marker/popup/panel, nothing else is affected by the
    filter — confirmed by checking MapLibre's actual DOM structure rather
    than assuming. Colours aren't art-directed (an invert is an invert), but
    it keeps Liberty's full detail level and needs no style reload.
- **Map rotation:** the map runs on MapLibre GL JS instead of Leaflet, specifically
  to support rotation — two-finger touch rotate is native, and the compass
  button (top-right, part of MapLibre's own zoom control) shows current
  bearing and resets to north on tap. Vector tiles from OpenFreeMap keep
  street labels upright as the map rotates, which raster tiles can't do.
  `maxPitch: 0` keeps it to flat 2D rotation — no accidental 3D tilt.
  Leaflet.markercluster doesn't have an equivalent under rotation, so
  clustering now runs on [Supercluster](https://github.com/mapbox/supercluster)
  directly (the same engine MapLibre uses internally) with our own custom HTML
  marker/cluster bubbles layered on top, reconciled by a stable key (station
  id / bike id) so an open popup survives a data refresh, a filter change, or
  a rotation rather than being torn down and recreated under it. One
  structural gotcha worth knowing if this code gets touched again: MapLibre
  positions a marker via a CSS `transform` on the *exact* element you hand
  it — the same property the station pin's 45° diamond rotation needs — so
  every marker's visual content lives one level *inside* a plain, unstyled
  host div rather than directly on the element MapLibre positions.
- Station counts come from `station_status` (authoritative). `free_bike_status`
  lists *every* rentable bike including docked ones, so bikes within
  `BIKE_MATCH_RADIUS_M` (120 m) of a station are dropped — the station's count
  already covers them. What's left are the **flex-parked ("loose") bikes**,
  both mechanical and electric, drawn at their own GPS point. Reserved and
  disabled (e.g. near-empty) bikes are excluded. Battery % is derived from
  `current_range_meters` with a reserve model calibrated to the official app —
  `20 + 80 × range/65000` (matches 55km→88%, 36km→64%, 3km→24%). Tune via
  `EBIKE_RESERVE_PCT` / `EBIKE_FULL_RANGE_M`. `GET /healthz` reports
  `loose_electric`, `loose_mechanical` and `docked_skipped`.
- **Marker language:** *shape* encodes identity (stations = teardrops, loose
  bikes = rounded squares), *glyph* encodes type (bolt = electric, bike =
  mechanical), and *colour* encodes only e-bike battery level. Stations use one
  near-black so green never means two things; loose bikes use slate. In "Any" mode a station pin
  carries the glyphs *beside* the count (bike left, bolt right) showing what's
  docked there — in the single-type views the filter already answers that, so
  they're hidden. E-bikes are battery-coloured tiles; mechanical
  bikes are slate (a colour that's nowhere on the battery ramp). The legend
  spells out every colour: station, empty station, loose bike, and the three
  battery bands. Loose-bike clusters are
  black rounded squares carrying the same glyphs (distinguished from the black
  station circles by shape), so a group of parked
  mechanical bikes never reads as a group of e-bikes.
- **Directions** is two split buttons side by side in each popup, same
  height: the maps button (main half opens the current app — labelled and
  truncating rather than wrapping; caret lists the others) and, next to it,
  the Browser/App mode button (icon only — globe/phone — with its own caret).
  Picking from either dropdown only *sets the default*, it never navigates —
  you go by tapping the maps name. Each dropdown floats over the map
  (`position: absolute`) rather than pushing the popup taller, so opening one
  never changes the popup's footprint. Both controls also live in the
  settings panel; all four stay in sync and the last pick is saved as the
  default. The mode option only appears when this device actually has an app
  for the chosen provider — phones always, Macs for Apple Maps, plain desktop
  never. Browser mode uses plain https links; App mode hands off to the
  native scheme (`comgooglemaps://`, `google.navigation:`, `maps://`,
  `waze://`) with no web fallback (a fallback timer is what previously opened
  both browser and app). If the app isn't installed the tap does nothing;
  switch back to Browser. Note: on iOS, `maps.apple.com` and `waze.com/ul`
  are registered *universal links* — iOS routes them to the app before Safari
  sees them and a web page cannot override that — so for those two the mode
  option is hidden on iPhone rather than offering a Browser choice the OS
  ignores. The **find-me** button live-tracks the user with an accuracy ring.
- **Known fix:** picking a maps app or Browser/App mode used to close the
  popup you were looking at — a side effect of Leaflet.markercluster dropping
  a marker's popup when its icon or cluster membership churns, triggered by
  the full `render()` we used to call. Preference changes now refresh only
  the open popup's own content in place; the popup stays open.
- **Bandwidth:** the live SSE connection pauses whenever the tab is
  hidden/backgrounded (Page Visibility API) instead of continuing to receive
  a push every ~20s for no reason. On resume it fetches `/snapshot` once
  immediately to catch up, then reopens the stream. A page that loads already
  hidden doesn't open a connection until someone actually looks at it.
- **Bandwidth:** gzip compression is enabled for all HTTP responses,
  including the SSE `/stream` — a realistic snapshot (~197 stations + ~80
  loose bikes) is ~49.5 KB raw but ~7.6 KB gzipped, roughly a 6.5x reduction.
  At the default 20s poll interval that's the difference between ~8.7 MB and
  ~1.3 MB per hour of the tab being open. SSE responses are flushed
  explicitly after every write (`res.flush()`), since gzip buffers output
  internally and an unflushed compressed stream would otherwise add latency
  to live pushes.
- **Known fix:** marker labels (station counts, bike battery %, cluster
  counts) are sized in fixed `px`, not `rem`, and the page opts out of
  automatic text-size adjustment (`text-size-adjust: 100%`). `rem` is
  relative to the root font-size, which some mobile browsers scale based on
  OS accessibility text-size settings or their own "boost small text"
  heuristics — invisible on desktop testing, but it could shrink a marker's
  number until it no longer fit the pin (and crowded out the side glyphs
  entirely). Marker labels are fixed-size UI chrome designed to fit an exact
  px container, so they now render at a constant size regardless of the
  device's text-scaling settings.
- **Known fix:** six strings (maps-app label, open-in label, the maps-chooser
  aria label, Browser/App option labels, and the loose-mechanical-bike
  labels) were accidentally defined inside the English object instead of the
  Hungarian one, so Hungarian silently fell back to English for those. Fixed;
  all three languages now carry the same key set (verified by diff).
- Out of scope for v1 (per the plan): renting/unlocking, accounts, history,
  other cities. The frontend `Directions` link deep-links into Google Maps to
  the station; wiring the official app's rent flow would need the authenticated
  private API + BLE, deliberately left out.

## Licence and attribution

- **Code:** MIT — see [LICENSE](LICENSE).
- **Data:** © BKK Zrt., CC BY 4.0. The licence requires the source to be
  indicated as **“Data source: BKK Zrt., CC BY 4.0”**, which the app shows in
  its map attribution and settings panel.
  [Licence deed](https://creativecommons.org/licenses/by/4.0/deed.en).
- **Map:** © OpenStreetMap contributors, ODbL. Tiles by
  [OpenFreeMap](https://openfreemap.org).
- **Trademarks:** MOL Bubi and Bubi belong to their respective owners. This is
  an unofficial project, not affiliated with or endorsed by BKK, MOL or Inurba.

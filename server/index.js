// index.js — Express app that polls the public GBFS feeds in memory and
// pushes each fresh snapshot to browsers over Server-Sent Events.
//
// Routes:
//   GET /snapshot  → latest normalized dataset (JSON) for first page load
//   GET /stream    → SSE; emits a `snapshot` event on every successful poll
//   GET /healthz   → liveness probe
//   /*             → static frontend from ../public

import express from 'express';
import compression from 'compression';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fetchFeed,
  FEEDS,
  indexVehicleTypes,
  indexStationInfo,
  listLooseBikes,
  mergeSnapshot,
} from './gbfs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const PORT = Number(process.env.PORT) || 3000;
// Respect the CC BY 4.0 rate-limit guidance: refetch no more than once
// every 15–30s. Default 20s. Static feeds refresh far less often.
const STATUS_INTERVAL_MS = Number(process.env.STATUS_INTERVAL_MS) || 20_000;
const STATIC_INTERVAL_MS = Number(process.env.STATIC_INTERVAL_MS) || 10 * 60_000;

// ---- in-memory state --------------------------------------------------------
let vehicleKind = {}; // { vehicle_type_id: 'electric' | 'mechanical' }
let stationInfo = {}; // { station_id: { id, name, lat, lon, capacity } }
let snapshot = { generated_at: null, station_count: 0, stations: [] };
let ebikeStats = { loose_electric: 0, loose_mechanical: 0, docked_skipped: 0 };
let lastError = null;

const clients = new Set(); // active SSE responses

// ---- polling ----------------------------------------------------------------
async function refreshStatic() {
  const [types, info] = await Promise.all([
    fetchFeed(FEEDS.vehicle_types),
    fetchFeed(FEEDS.station_information),
  ]);
  vehicleKind = indexVehicleTypes(types);
  stationInfo = indexStationInfo(info);
}

async function pollStatus() {
  // Bootstrap static data if we don't have it yet (e.g. it failed at start).
  if (!Object.keys(stationInfo).length) {
    await refreshStatic();
  }
  // Status is required; free_bike_status is best-effort enrichment (per-bike
  // battery). If the latter fails, we still ship counts from status.
  const [status, free] = await Promise.all([
    fetchFeed(FEEDS.station_status),
    fetchFeed(FEEDS.free_bike_status).catch((err) => {
      console.error(`[free_bike_status] ${err.message} — no battery detail this cycle`);
      return null;
    }),
  ]);
  const { loose, docked } = free
    ? listLooseBikes(free, vehicleKind, stationInfo)
    : { loose: [], docked: 0 };
  ebikeStats = {
    loose_electric: loose.filter((b) => b.kind === 'electric').length,
    loose_mechanical: loose.filter((b) => b.kind === 'mechanical').length,
    docked_skipped: docked,
  };

  snapshot = mergeSnapshot(status, stationInfo, vehicleKind);
  snapshot.bikes = loose; // flex-parked bikes not covered by a station count
  lastError = null;
  broadcast(snapshot);
}

async function safePoll() {
  try {
    await pollStatus();
  } catch (err) {
    // Keep serving the last known-good snapshot rather than erroring out.
    lastError = err.message;
    console.error(`[poll] ${err.message} — serving last good snapshot`);
  }
}

async function safeStaticRefresh() {
  try {
    await refreshStatic();
  } catch (err) {
    console.error(`[static] ${err.message} — keeping previous station list`);
  }
}

// ---- SSE --------------------------------------------------------------------
// gzip buffers output internally, so a compressed SSE connection needs an
// explicit flush() after every write — otherwise pushes can sit in the
// compressor's buffer instead of reaching the browser immediately, which
// would reintroduce the latency compression is supposed to have no cost for.
function broadcast(data) {
  const frame = `event: snapshot\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    res.write(frame);
    res.flush?.();
  }
}

// ---- app --------------------------------------------------------------------
const app = express();
app.disable('x-powered-by');
app.use(compression()); // cuts /snapshot and every SSE push roughly 6x on the wire

app.get('/healthz', (_req, res) => {
  res.json({
    ok: true,
    stations: snapshot.station_count,
    ...ebikeStats,
    generated_at: snapshot.generated_at,
    last_error: lastError,
  });
});

app.get('/snapshot', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(snapshot);
});

app.get('/stream', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // disable proxy buffering if present
  });
  res.flushHeaders?.();

  // Send the current snapshot immediately so a reconnecting client is fresh.
  res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);
  res.flush?.();

  // Heartbeat comment keeps intermediaries from closing an idle connection.
  const heartbeat = setInterval(() => {
    res.write(': keep-alive\n\n');
    res.flush?.();
  }, 25_000);

  clients.add(res);
  req.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(res);
  });
});

app.use(
  express.static(PUBLIC_DIR, {
    setHeaders(res, filePath) {
      if (filePath.endsWith('index.html')) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  }),
);

// ---- boot -------------------------------------------------------------------
async function start() {
  await safeStaticRefresh(); // best-effort; pollStatus will retry if it failed
  await safePoll();

  setInterval(safePoll, STATUS_INTERVAL_MS);
  setInterval(safeStaticRefresh, STATIC_INTERVAL_MS);

  app.listen(PORT, () => {
    console.log(`bubi-map listening on :${PORT}`);
    console.log(`  polling status every ${STATUS_INTERVAL_MS / 1000}s`);
    console.log(`  ${snapshot.station_count} stations loaded`);
  });
}

start();

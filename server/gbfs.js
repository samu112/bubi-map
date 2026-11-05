// gbfs.js — fetches and normalizes the public MOL Bubi GBFS v2.3 feeds.
//
// Data source: BKK Zrt., CC BY 4.0 (served via Urban Sharing).
// No auth, no reverse-engineered API — this is the public open-data feed.

const HOST =
  process.env.GBFS_BASE ||
  'https://gbfs.urbansharing.com/molbubi.hu';

const FEEDS = {
  vehicle_types: `${HOST}/vehicle_types.json`,
  station_information: `${HOST}/station_information.json`,
  station_status: `${HOST}/station_status.json`,
  free_bike_status: `${HOST}/free_bike_status.json`,
};

// The Urban Sharing gateway asks third parties to identify themselves.
const CLIENT_IDENTIFIER = process.env.CLIENT_IDENTIFIER || 'bubi-live-map';

// E-bike battery percentage.
// Calibrated to the official app: range maps onto the top 80% of the battery,
// with a ~20% reserve floor (which is also why near-empty bikes get disabled).
//   battery% = RESERVE + (100 - RESERVE) × range_m / FULL_RANGE_M
// Fits the app's readings (55km→88%, 51km→83%, 36km→64%, 28km→54%, 3km→24%).
const EBIKE_FULL_RANGE_M = Number(process.env.EBIKE_FULL_RANGE_M) || 65000;
const EBIKE_RESERVE_PCT = Number(process.env.EBIKE_RESERVE_PCT) || 20;

// How close (metres) a free-floating bike must be to a station to be counted
// as "at" it, when the feed doesn't give an explicit station_id.
const BIKE_MATCH_RADIUS_M = Number(process.env.BIKE_MATCH_RADIUS_M) || 120;

async function fetchFeed(url) {
  const res = await fetch(url, {
    headers: {
      'Client-Identifier': CLIENT_IDENTIFIER,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`GBFS ${url} returned HTTP ${res.status}`);
  return res.json();
}

function batteryPct(rangeM) {
  if (rangeM == null) return null;
  const pct = Math.round(
    EBIKE_RESERVE_PCT + (100 - EBIKE_RESERVE_PCT) * (rangeM / EBIKE_FULL_RANGE_M),
  );
  return Math.max(0, Math.min(100, pct));
}

// vehicle_types.json → { [vehicle_type_id]: 'electric' | 'mechanical' }
function indexVehicleTypes(payload) {
  const map = {};
  for (const vt of payload?.data?.vehicle_types ?? []) {
    const electric = vt.propulsion_type && vt.propulsion_type !== 'human';
    map[vt.vehicle_type_id] = electric ? 'electric' : 'mechanical';
  }
  return map;
}

// station_information.json → { [station_id]: { id, name, lat, lon, capacity } }
function indexStationInfo(payload) {
  const map = {};
  for (const s of payload?.data?.stations ?? []) {
    if (typeof s.lat !== 'number' || typeof s.lon !== 'number') continue;
    map[s.station_id] = {
      id: s.station_id,
      name: s.name ?? 'Bubi station',
      lat: s.lat,
      lon: s.lon,
      capacity: s.capacity ?? null,
    };
  }
  return map;
}

// Metres between two lat/lon points (haversine — accurate at city scale).
function distanceM(aLat, aLon, bLat, bLon) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function nearestStationId(lat, lon, stationList) {
  let best = null;
  let bestD = BIKE_MATCH_RADIUS_M;
  for (const s of stationList) {
    const d = distanceM(lat, lon, s.lat, s.lon);
    if (d <= bestD) {
      bestD = d;
      best = s.id;
    }
  }
  return best;
}

// free_bike_status.json lists *every* rentable bike — including ones sitting
// in a dock. Bikes at a station are already represented by that station's
// counts, so we drop them here and keep only the flex-parked ("loose") ones,
// which otherwise wouldn't appear on the map at all. Applies to both types:
// mechanical bikes get no battery (the feed reports no range for them).
// Reserved and disabled (e.g. near-empty) bikes are excluded — not rentable.
function listLooseBikes(payload, vehicleKind, stationInfo) {
  const loose = [];
  const stationList = Object.values(stationInfo);
  let docked = 0;
  for (const b of payload?.data?.bikes ?? []) {
    if (b.is_reserved || b.is_disabled) continue;
    if (typeof b.lat !== 'number' || typeof b.lon !== 'number') continue;

    // At a station → the station's own count already covers it.
    if (nearestStationId(b.lat, b.lon, stationList)) {
      docked += 1;
      continue;
    }

    const electric = vehicleKind[b.vehicle_type_id] === 'electric';
    loose.push({
      id: b.bike_id,
      lat: b.lat,
      lon: b.lon,
      kind: electric ? 'electric' : 'mechanical',
      battery: electric ? batteryPct(b.current_range_meters) : null,
      range_m: electric ? b.current_range_meters ?? null : null,
    });
  }
  // Electric first, best battery first — keeps the most useful pins on top.
  loose.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'electric' ? -1 : 1;
    return (b.battery ?? -1) - (a.battery ?? -1);
  });
  return { loose, docked };
}

// Merge status onto static info. Marker/headline counts come from
// station_status (authoritative). Per-bike e-bike battery detail is layered
// on from free_bike_status as best-effort enrichment.
function mergeSnapshot(statusPayload, stationInfo, vehicleKind) {
  const stations = [];
  for (const st of statusPayload?.data?.stations ?? []) {
    const info = stationInfo[st.station_id];
    if (!info) continue;

    let electric = 0;
    let mechanical = 0;
    for (const vt of st.vehicle_types_available ?? []) {
      const kind = vehicleKind[vt.vehicle_type_id];
      const count = vt.count ?? 0;
      if (kind === 'electric') electric += count;
      else mechanical += count;
    }

    stations.push({
      id: info.id,
      name: info.name,
      lat: info.lat,
      lon: info.lon,
      capacity: info.capacity,
      bikes_electric: electric,
      bikes_mechanical: mechanical,
      bikes_total: electric + mechanical,
      docks_available: st.num_docks_available ?? null,
      is_renting: st.is_renting !== false,
    });
  }
  return {
    generated_at: Date.now(),
    last_updated: (statusPayload?.last_updated ?? 0) * 1000 || null,
    station_count: stations.length,
    stations,
  };
}

export {
  fetchFeed,
  FEEDS,
  indexVehicleTypes,
  indexStationInfo,
  listLooseBikes,
  mergeSnapshot,
};

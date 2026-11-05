/* Bubi Live — client. Renders the live GBFS snapshot on a MapLibre GL map,
   keeps it fresh over Server-Sent Events, filters client-side, supports
   rotation (native two-finger touch rotate + compass reset), and is
   translatable (English / Magyar / Deutsch — add more below). */

(function () {
  'use strict';

  // Budapest, as [lat, lon] — the convention every other coordinate in this
  // file uses (matches the GBFS feed and reads naturally in comments).
  // MapLibre wants [lon, lat] everywhere; toLngLat() below does that one
  // conversion explicitly at the boundary, so it never has to be done ad hoc.
  const BUDAPEST = [47.4979, 19.0402];
  const toLngLat = (lat, lon) => [lon, lat];

  /* ---- i18n ----------------------------------------------------------------
     To add a language: copy an entry, translate the strings, give it a flag.
     `flag` is a function so each rendered instance can get unique SVG ids. */
  const LANGS = {
    en: {
      name: 'English',
      flag: () =>
        '<svg viewBox="0 0 60 30" preserveAspectRatio="xMidYMid slice"><path d="M0 0v30h60V0z" fill="#012169"/><path d="M0 0l60 30M60 0L0 30" stroke="#fff" stroke-width="6"/><path d="M30 0v30M0 15h60" stroke="#fff" stroke-width="10"/><path d="M30 0v30M0 15h60" stroke="#C8102E" stroke-width="6"/></svg>',
      strings: {
        stations: 'stations', bikes: 'bikes', show: 'Show',
        both: 'Any', electric: 'Electric', mechanical: 'Mechanical',
        hide_empty: 'Hide stations with none available',
        dark_mode: 'Dark mode',
        legend_station: 'Station', legend_empty: 'Empty station',
        legend_batt_hi: 'E-bike over 50%', legend_batt_mid: 'E-bike 20–50%', legend_batt_low: 'E-bike under 20%',
        loading: 'Loading live stations…',
        available: 'available', docks: 'docks', km: 'km', ebike: 'E-bike',
        maps_via: 'Open directions in',
        open_in: 'Open directions in',
        choose_maps_app: 'Choose maps app', opt_browser: 'Browser', opt_app: 'App (if installed)',
        bike: 'Bike', loose_bike: 'Parked outside a station', legend_bike: 'Bike, no station',
        directions: 'Directions', not_renting: 'Not renting right now',
        no_battery: 'No live battery data for these bikes',
        locate: 'Find bikes near me',
        geo_error: 'Could not get your location. Check location permissions and that the site is on HTTPS.',
        ios_pre: 'Add Bubi Live to your home screen: tap',
        ios_post: 'then “Add to Home Screen”.',
      },
    },
    hu: {
      name: 'Magyar',
      flag: () =>
        '<svg viewBox="0 0 6 4"><rect width="6" height="4" fill="#fff"/><rect width="6" height="1.334" fill="#ce2939"/><rect y="2.667" width="6" height="1.333" fill="#477050"/></svg>',
      strings: {
        stations: 'állomás', bikes: 'kerékpár', show: 'Mutasd',
        both: 'Mind', electric: 'Elektromos', mechanical: 'Hagyományos',
        hide_empty: 'Üres állomások elrejtése',
        dark_mode: 'Sötét mód',
        legend_station: 'Állomás', legend_empty: 'Üres állomás',
        legend_batt_hi: 'E-bike 50% felett', legend_batt_mid: 'E-bike 20–50%', legend_batt_low: 'E-bike 20% alatt',
        loading: 'Élő állomások betöltése…',
        available: 'elérhető', docks: 'dokkoló', km: 'km', ebike: 'E-bike',
        maps_via: 'Útvonaltervezés ebben:',
        open_in: 'Útvonal megnyitása:',
        choose_maps_app: 'Térképalkalmazás választása', opt_browser: 'Böngésző', opt_app: 'Alkalmazás (ha van)',
        bike: 'Kerékpár', loose_bike: 'Állomáson kívül parkolva', legend_bike: 'Kerékpár, állomáson kívül',
        directions: 'Útvonal', not_renting: 'Jelenleg nem kölcsönözhető',
        no_battery: 'Nincs élő akkumulátoradat ezekhez a kerékpárokhoz',
        locate: 'Kerékpárok a közelemben',
        geo_error: 'Nem sikerült meghatározni a helyzetedet. Ellenőrizd a helyhozzáférési engedélyt, és hogy az oldal HTTPS-en fut-e.',
        ios_pre: 'Add a Bubi Live-ot a kezdőképernyőhöz: koppints ide',
        ios_post: 'majd „Főképernyőhöz adás”.',
      },
    },
    de: {
      name: 'Deutsch',
      flag: () =>
        '<svg viewBox="0 0 5 3"><rect width="5" height="3" fill="#ffce00"/><rect width="5" height="2" fill="#dd0000"/><rect width="5" height="1" fill="#000"/></svg>',
      strings: {
        stations: 'Stationen', bikes: 'Räder', show: 'Anzeigen',
        both: 'Alle', electric: 'Elektrisch', mechanical: 'Mechanisch',
        hide_empty: 'Leere Stationen ausblenden',
        dark_mode: 'Dunkler Modus',
        legend_station: 'Station', legend_empty: 'Leere Station',
        legend_batt_hi: 'E-Bike über 50%', legend_batt_mid: 'E-Bike 20–50%', legend_batt_low: 'E-Bike unter 20%',
        loading: 'Live-Stationen werden geladen…',
        available: 'verfügbar', docks: 'Docks', km: 'km', ebike: 'E-Bike', maps_via: 'Route öffnen in',
        open_in: 'Route öffnen in',
        choose_maps_app: 'Karten-App wählen', opt_browser: 'Browser', opt_app: 'App (falls installiert)',
        bike: 'Fahrrad', loose_bike: 'Außerhalb einer Station geparkt', legend_bike: 'Fahrrad, ohne Station',
        directions: 'Route', not_renting: 'Derzeit nicht ausleihbar',
        no_battery: 'Keine Live-Akkudaten für diese Räder',
        locate: 'Räder in der Nähe',
        geo_error: 'Standort konnte nicht ermittelt werden. Prüfe die Standortfreigabe und ob die Seite über HTTPS läuft.',
        ios_pre: 'Bubi Live zum Home-Bildschirm hinzufügen: tippe auf',
        ios_post: 'dann „Zum Home-Bildschirm“.',
      },
    },
  };

  let lang = 'en';
  const t = (k) =>
    (LANGS[lang] && LANGS[lang].strings[k]) || LANGS.en.strings[k] || k;

  function detectLang() {
    try {
      const saved = localStorage.getItem('bubi-lang');
      if (saved && LANGS[saved]) return saved;
    } catch (_) {}
    const nav = (navigator.language || 'en').slice(0, 2).toLowerCase();
    return LANGS[nav] ? nav : 'en';
  }

  const state = {
    type: 'both', // 'both' | 'electric' | 'mechanical'
    hideEmpty: false,
    stations: [],
    bikes: [],
    mapsProvider: 'google', // google | apple | waze | osm
    openIn: 'browser', // 'browser' (reliable) | 'app' (native handoff)
  };

  // Build a directions URL for the chosen maps app. These are universal https
  // links: on a phone they open the native app when it's installed (Apple Maps
  // always on iOS; Waze if present) and fall back to the web page otherwise.
  // Google Maps is the exception — its https links often stay in the browser,
  // so for Google we additionally try a custom scheme first (see appUrl).
  function directionsUrl(lat, lon) {
    const d = `${lat},${lon}`;
    switch (state.mapsProvider) {
      case 'apple': return `https://maps.apple.com/?daddr=${d}`;
      case 'waze': return `https://waze.com/ul?ll=${d}&navigate=yes`;
      case 'osm': return `https://www.openstreetmap.org/directions?to=${d}`;
      case 'google':
      default: return `https://www.google.com/maps/dir/?api=1&destination=${d}&travelmode=bicycling`;
    }
  }

  const PROVIDERS = {
    google: 'Google Maps',
    apple: 'Apple Maps',
    waze: 'Waze',
    osm: 'OpenStreetMap',
  };

  const GLYPH_GLOBE =
    '<svg viewBox="0 0 24 24" aria-hidden="true" class="g-stroke"><circle cx="12" cy="12" r="9"/>' +
    '<path d="M3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18"/></svg>';
  const GLYPH_PHONE =
    '<svg viewBox="0 0 24 24" aria-hidden="true" class="g-stroke">' +
    '<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M10.5 18.5h3"/></svg>';
  const CHECK =
    '<svg viewBox="0 0 24 24" aria-hidden="true" class="g-stroke"><path d="M5 12l5 5 9-11"/></svg>';

  // Two split buttons, side by side, same height. Maps: main half navigates,
  // caret picks the app; its label truncates instead of forcing a second row.
  // Mode: a matching icon-only split for Browser/App — never navigates.
  // Each menu lives inside its own `dir-group` (position: relative) so it can
  // be `position: absolute` and float over the map instead of stretching the
  // popup — picking an item never changes the popup's footprint.
  function directionsHtml(lat, lon) {
    const providerItems = Object.entries(PROVIDERS)
      .map(
        ([id, name]) =>
          `<li role="none"><button role="menuitem" type="button" class="dir-item" data-menu="maps" data-provider="${id}">` +
          `<span class="dir-check">${id === state.mapsProvider ? CHECK : ''}</span>${name}</button></li>`,
      )
      .join('');

    let modeGroup = '';
    if (APP_CAPABLE && providerHasApp() && browserModeHonoured()) {
      const icon = state.openIn === 'app' ? GLYPH_PHONE : GLYPH_GLOBE;
      const label = state.openIn === 'app' ? t('opt_app') : t('opt_browser');
      modeGroup = `
        <div class="dir-group dir-group-mode">
          <div class="dir-split dir-split-mode">
            <button type="button" class="mode-main" data-menu="mode" aria-label="${label}" title="${label}">${icon}</button>
            <button type="button" class="dir-caret" data-menu="mode" aria-label="${t('open_in')}" aria-haspopup="true"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 4l4 4 4-4z"/></svg></button>
          </div>
          <ul class="dir-menu" data-menu="mode" role="menu" hidden>
            <li role="none"><button role="menuitem" type="button" class="dir-item" data-menu="mode" data-openin="browser"><span class="dir-check">${
              state.openIn === 'browser' ? CHECK : ''
            }</span>${GLYPH_GLOBE}<span>${t('opt_browser')}</span></button></li>
            <li role="none"><button role="menuitem" type="button" class="dir-item" data-menu="mode" data-openin="app"><span class="dir-check">${
              state.openIn === 'app' ? CHECK : ''
            }</span>${GLYPH_PHONE}<span>${t('opt_app')}</span></button></li>
          </ul>
        </div>`;
    }

    return `
      <div class="dir-row">
        <div class="dir-group dir-group-maps">
          <div class="dir-split">
            <a class="pop-dir" href="${directionsUrl(lat, lon)}" data-lat="${lat}" data-lon="${lon}" target="_blank" rel="noopener">${PROVIDERS[state.mapsProvider]}</a>
            <button type="button" class="dir-caret" data-menu="maps" aria-label="${t('choose_maps_app')}" aria-haspopup="true">
              <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 4l4 4 4-4z"/></svg>
            </button>
          </div>
          <ul class="dir-menu" data-menu="maps" role="menu" hidden>${providerItems}</ul>
        </div>
        ${modeGroup}
      </div>`;
  }

  const UA = navigator.userAgent;
  const IS_IOS = /iP(hone|ad|od)/.test(UA);
  const IS_ANDROID = /Android/.test(UA);
  const IS_MAC = /Macintosh/.test(UA) && !IS_IOS;
  // The Browser/App choice only makes sense where native map apps exist:
  // phones, and Macs (Apple Maps ships with macOS). Plain desktop → hide it.
  const APP_CAPABLE = IS_IOS || IS_ANDROID || IS_MAC;
  // Providers that actually have an app to hand off to on *this* device.
  function providerHasApp() {
    switch (state.mapsProvider) {
      case 'apple': return IS_IOS || IS_MAC;
      case 'waze': return IS_IOS || IS_ANDROID;
      case 'osm': return false;
      case 'google':
      default: return IS_IOS || IS_ANDROID; // no Google Maps desktop app
    }
  }

  // Whether "Browser" is actually achievable for this provider on this device.
  // On iOS, maps.apple.com and waze.com/ul are registered *universal links*:
  // iOS hands them to the app before Safari ever sees them, and a web page
  // cannot override that. So we don't pretend the choice exists there.
  function browserModeHonoured() {
    if (IS_IOS && (state.mapsProvider === 'apple' || state.mapsProvider === 'waze')) {
      return false;
    }
    return true;
  }

  // Native app scheme per provider, or null if there's no useful one here.
  function appUrl(lat, lon) {
    const d = `${lat},${lon}`;
    switch (state.mapsProvider) {
      case 'apple': return (IS_IOS || IS_MAC) ? `maps://?daddr=${d}` : null;
      case 'waze': return `waze://?ll=${d}&navigate=yes`;
      case 'osm': return null; // no app
      case 'google':
      default:
        return IS_IOS
          ? `comgooglemaps://?daddr=${d}&directionsmode=bicycling`
          : `google.navigation:q=${d}&mode=b`;
    }
  }

  function closeDirMenus(except) {
    document.querySelectorAll('.dir-menu').forEach((m) => {
      if (m !== except) m.hidden = true;
    });
  }

  document.addEventListener('click', (ev) => {
    // Caret or the mode split's icon → open that control's menu.
    const opener = ev.target.closest('.dir-caret, .mode-main');
    if (opener) {
      ev.preventDefault();
      ev.stopPropagation();
      const which = opener.dataset.menu;
      const menu = document.querySelector(`.dir-menu[data-menu="${which}"]`);
      if (menu) {
        const willOpen = menu.hidden;
        closeDirMenus(menu);
        menu.hidden = !willOpen;
      }
      return;
    }

    // Picking from a menu only changes the default — never navigates.
    const item = ev.target.closest('.dir-item');
    if (item) {
      ev.preventDefault();
      ev.stopPropagation();
      if (item.dataset.menu === 'maps') state.mapsProvider = item.dataset.provider;
      else state.openIn = item.dataset.openin;
      saveFilters();
      syncControlsToState();
      updateOpenInVisibility();
      closeDirMenus();
      refreshOpenPopup(); // update just this popup's content — a full
      // marker rebuild would close it
      return;
    }

    // Main half of the maps split button → go (in app or browser).
    const a = ev.target.closest('a.pop-dir');
    if (a) {
      if (state.openIn !== 'app') return; // browser mode: plain link is fine
      if (!providerHasApp()) return;
      const scheme = appUrl(a.dataset.lat, a.dataset.lon);
      if (!scheme) return;
      ev.preventDefault();
      window.location.href = scheme;
      return;
    }

    // Click anywhere else closes any open menu.
    closeDirMenus();
  });

  // ---- Map --------------------------------------------------------------
  // OpenFreeMap (openfreemap.org): free vector tiles, no API key, built for
  // MapLibre. "Liberty" is their fullest-detail style — closest to the
  // classic OSM look (land use, POIs, fuller road hierarchy) — still vector,
  // so labels stay upright as the map rotates, which raster tiles can't do.
  const map = new maplibregl.Map({
    container: 'map',
    style: 'https://tiles.openfreemap.org/styles/liberty',
    center: toLngLat(BUDAPEST[0], BUDAPEST[1]),
    zoom: 13,
    maxPitch: 0, // rotation only — no 3D tilt, keeps our flat marker design correct
    attributionControl: false,
  });

  // MapLibre reads the required OpenStreetMap/OpenFreeMap attribution out of
  // the style itself; customAttribution appends our own CC BY 4.0 notice
  // alongside it rather than replacing it.
  map.addControl(
    new maplibregl.AttributionControl({
      compact: true,
      customAttribution:
        '<a href="https://opendata.bkk.hu/data-sources" target="_blank" rel="noopener noreferrer">Data source: BKK Zrt., CC BY 4.0</a>',
    }),
    'top-left',
  );

  // Zoom buttons + compass: the compass shows current bearing and resets to
  // north on tap — this is the whole "rotation" feature's reset affordance,
  // built in rather than hand-rolled. Two-finger touch rotate is on by
  // default; nothing else to wire up for the core gesture.
  map.addControl(
    new maplibregl.NavigationControl({ showCompass: true, showZoom: true, visualizePitch: false }),
    'top-right',
  );

  // MapLibre positions a marker by setting a CSS transform directly on the
  // exact element it's given — the same property our own station pin uses
  // for its 45° diamond rotation. Setting our visual content one level
  // *inside* a plain, un-styled host div (rather than styling the host
  // itself) keeps the two transforms from colliding: MapLibre's positioning
  // transform lives on the host, ours lives on the child.
  function ensureChild(host) {
    let child = host.firstElementChild;
    if (!child) {
      child = document.createElement('div');
      host.appendChild(child);
    }
    return child;
  }

  // ---- Popup tracking ---------------------------------------------------
  // MapLibre has no single "any popup opened" map event like Leaflet did, so
  // each popup reports its own open/close to this shared tracker. The stored
  // refresh function reads marker._data fresh each call, so a preference
  // change (maps app, browser/app mode, language) can update just the open
  // popup's content in place without touching markers or clusters — which is
  // what was closing popups under the old system.
  let openPopup = null; // { key, popup, refresh }

  function bindPopup(marker, key, offset, refresh) {
    const popup = new maplibregl.Popup({ offset, closeButton: true, maxWidth: 'none' })
      .setHTML(refresh());
    popup.on('open', () => { openPopup = { key, popup, refresh }; });
    popup.on('close', () => { if (openPopup && openPopup.key === key) openPopup = null; });
    marker._popupRefresh = refresh; // used by refreshAllPopups() on language change
    marker.setPopup(popup);
  }

  function refreshOpenPopup() {
    if (!openPopup) return;
    openPopup.popup.setHTML(openPopup.refresh());
  }

  function refreshAllPopups() {
    for (const layer of [stationsLayer, bikesLayer]) {
      for (const entry of layer.markers.values()) {
        if (entry.kind === 'point' && entry.marker._popupRefresh) {
          entry.marker.getPopup()?.setHTML(entry.marker._popupRefresh());
        }
      }
    }
  }

  // ---- Marker visuals -----------------------------------------------------
  // Every apply*Visual function takes the marker's *host* element (MapLibre-
  // positioned; never styled directly) and mutates a child inside it. `host`
  // may be an existing host to update in place (preserves the MapLibre
  // Marker instance and its popup binding — this is how an open popup
  // survives a data refresh) or null to create a fresh one.

  function countFor(s) {
    if (state.type === 'electric') return s.bikes_electric;
    if (state.type === 'mechanical') return s.bikes_mechanical;
    return s.bikes_total;
  }

  const GLYPH_BOLT =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z"/></svg>';
  const GLYPH_BIKE =
    '<svg viewBox="0 0 24 24" class="g-stroke" aria-hidden="true">' +
    '<circle cx="5.5" cy="17.5" r="3.5"/><circle cx="18.5" cy="17.5" r="3.5"/>' +
    '<path d="M15 17.5h-6l5-9h-3"/><path d="M12 8.5h4"/></svg>';

  // Stations are always the same neutral colour: their identity is the
  // teardrop *shape*, and the number inside carries the count. Colour is
  // reserved exclusively for e-bike battery level (see applyBikeVisual), so
  // green never means two different things. In "Any" mode the count alone
  // can't say what's there, so tiny glyphs spell out the composition —
  // mechanical, electric, or both. In the other two modes the filter already
  // answers it.
  function applyStationVisual(host, s) {
    host = host || document.createElement('div');
    const el = ensureChild(host);
    const n = countFor(s);
    if (n <= 0) {
      el.className = 'pin pin-empty';
      el.innerHTML = '<span class="pin-inner"><span class="pin-num">0</span></span>';
      return host;
    }
    let left = '';
    let right = '';
    if (state.type === 'both') {
      if (s.bikes_mechanical > 0) left = GLYPH_BIKE;
      if (s.bikes_electric > 0) right = GLYPH_BOLT;
    }
    const hasGlyphs = Boolean(left || right);
    el.className = 'pin pin-station' + (hasGlyphs ? ' has-glyphs' : '');
    el.innerHTML = `<span class="pin-inner">${left}<span class="pin-num">${n}</span>${right}</span>`;
    return host;
  }

  function batteryColor(pct) {
    return pct > 50 ? '#1f9d57' : pct >= 20 ? '#f2a51c' : '#d64545';
  }

  function batteryChip(pct) {
    const col = batteryColor(pct);
    const w = Math.max(0, Math.min(17, (17 * pct) / 100)).toFixed(1);
    return (
      '<span class="batt"><svg class="batt-ico" viewBox="0 0 24 12" aria-hidden="true">' +
      '<rect x="0.75" y="1" width="19.5" height="10" rx="2" fill="none" stroke="#9aa7a0"/>' +
      '<rect x="21" y="4" width="2" height="4" rx="0.5" fill="#9aa7a0"/>' +
      `<rect x="2" y="2.5" width="${w}" height="7" rx="1" fill="${col}"/>` +
      `</svg>${pct}%</span>`
    );
  }

  // Station popup — plain counts. Individual e-bikes (with battery) live on
  // their own pins, so there's no per-station battery list here.
  function popupHtml(s) {
    const closed = s.is_renting ? '' : `<div class="pop-closed">${t('not_renting')}</div>`;
    const docks = s.docks_available != null ? ` · ${s.docks_available} ${t('docks')}` : '';
    return `
      <div class="pop">
        <p class="pop-name">${escapeHtml(s.name)}</p>
        <div class="pop-counts">
          <span class="pop-count mech"><b>${s.bikes_mechanical}</b><small>${t('mechanical')}</small></span>
          <span class="pop-count elec"><b>${s.bikes_electric}</b><small>${t('electric')}</small></span>
        </div>
        <div class="pop-meta">${s.bikes_total} ${t('available')}${docks}</div>
        ${closed}
        ${directionsHtml(s.lat, s.lon)}
      </div>`;
  }

  // Loose bikes are rounded squares — a different *shape* from the station
  // teardrops. The glyph says which type it is (bolt vs bike); colour is used
  // only for e-bike battery level. Mechanical bikes have no battery data, so
  // they stay neutral. The % sign is omitted here (it threw off the optical
  // centring); the popup spells it out.
  function applyBikeVisual(host, b) {
    host = host || document.createElement('div');
    const el = ensureChild(host);
    if (b.kind === 'electric') {
      el.className = 'bike-pin bike-pin-elec';
      el.style.background = batteryColor(b.battery);
      el.innerHTML =
        '<svg class="bike-glyph" viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z"/></svg>' +
        `<span class="bike-num">${b.battery}</span>`;
      return host;
    }
    el.className = 'bike-pin bike-pin-mech';
    el.style.background = '';
    el.innerHTML =
      '<svg class="bike-glyph-mech" viewBox="0 0 24 24" aria-hidden="true">' +
      '<circle cx="5.5" cy="17.5" r="3.5"/><circle cx="18.5" cy="17.5" r="3.5"/>' +
      '<path d="M15 17.5h-6l5-9h-3"/><path d="M12 8.5h4"/></svg>';
    return host;
  }

  function bikePopupHtml(b) {
    const link = directionsHtml(b.lat, b.lon);
    if (b.kind === 'electric') {
      return `
      <div class="pop">
        <p class="pop-name">${t('ebike')}</p>
        <div class="pop-ebike-row">${batteryChip(b.battery)}<span class="ebike-km">${Math.round(
          (b.range_m || 0) / 1000,
        )} ${t('km')}</span></div>
        <div class="pop-meta">${t('loose_bike')}</div>
        ${link}
      </div>`;
    }
    return `
      <div class="pop">
        <p class="pop-name">${t('bike')}</p>
        <div class="pop-meta">${t('loose_bike')}</div>
        ${link}
      </div>`;
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function applyClusterVisual(host, kind, count, mech, elec) {
    host = host || document.createElement('div');
    const el = ensureChild(host);
    const size = count < 10 ? 38 : count < 50 ? 46 : 54;
    // Host is absolutely positioned by MapLibre and shrink-wraps to its
    // child's size by default, but the size is already a JS value here, so
    // setting it on both costs nothing and removes any doubt about hit-testing.
    host.style.width = size + 'px';
    host.style.height = size + 'px';
    el.style.width = size + 'px';
    el.style.height = size + 'px';
    if (kind === 'station') {
      el.className = 'cluster';
      el.style.fontSize = count < 100 ? '0.95rem' : '0.82rem';
      el.textContent = String(count);
    } else {
      el.className = 'cluster cluster-bikes';
      el.style.fontSize = '';
      const glyphs = (mech ? GLYPH_BIKE : '') + (elec ? GLYPH_BOLT : '');
      el.innerHTML = `<span class="cluster-num">${count}</span><span class="cluster-glyphs">${glyphs}</span>`;
    }
    return host;
  }

  // ---- Generic point + cluster layer --------------------------------------
  // Leaflet.markercluster used to do all of this for us. MapLibre's own
  // built-in clustering is designed around GL circle/symbol layers, not
  // custom HTML bubbles with our glyph language, so this uses Supercluster
  // directly — the same clustering engine MapLibre uses internally — and
  // manages plain maplibregl.Marker DOM elements by hand.
  //
  // Markers are reconciled by a stable key rather than cleared and rebuilt
  // wholesale: an existing point marker has its position/visual/popup data
  // updated *in place*, which is what lets an open popup survive a data
  // refresh, a filter change, or a map rotation instead of being closed by
  // its own marker being torn down and recreated underneath it.
  function createClusterLayer({ radius, maxZoom, pointAnchor, popupOffset, applyVisual, buildPopupHtml, keyOf, clusterKind }) {
    let index = new Supercluster({ radius, maxZoom, extent: 512 });
    const markers = new Map(); // key -> { marker, kind: 'point'|'cluster', clusterId? }

    function setData(items) {
      const features = items.map((item) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: toLngLat(item.lat, item.lon) },
        properties: item,
      }));
      index = new Supercluster({ radius, maxZoom, extent: 512 });
      index.load(features);
    }

    function reconcile() {
      const b = map.getBounds();
      const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
      const zoom = Math.max(0, Math.min(20, Math.round(map.getZoom())));
      const results = index.getClusters(bbox, zoom);

      const seen = new Set();
      for (const f of results) {
        const [lon, lat] = f.geometry.coordinates;

        if (f.properties.cluster === true) {
          const clusterId = f.properties.cluster_id;
          const key = 'c:' + clusterId;
          seen.add(key);
          const entry = markers.get(key);
          if (entry && entry.kind === 'cluster' && entry.clusterId === clusterId) continue; // unchanged since last reconcile

          const leaves = index.getLeaves(clusterId, Infinity);
          let mech = false;
          let elec = false;
          let displayCount = f.properties.point_count;
          if (clusterKind === 'bike') {
            // Each leaf is one bike, so point_count already is a bike count.
            for (const lf of leaves) {
              if (lf.properties.kind === 'electric') elec = true; else mech = true;
              if (mech && elec) break;
            }
          } else {
            // point_count here is the number of *stations* clustered together
            // (nearly all of them, once zoomed out enough) — a different unit
            // from every other number on the map, which is always a bike
            // count. Sum the bikes those stations actually hold instead, so
            // a cluster never silently switches what it's counting.
            displayCount = leaves.reduce((sum, lf) => sum + countFor(lf.properties), 0);
          }
          if (entry) entry.marker.remove();
          const el = applyClusterVisual(null, clusterKind, displayCount, mech, elec);
          el.addEventListener('click', (ev) => {
            ev.stopPropagation();
            const exZoom = index.getClusterExpansionZoom(clusterId);
            map.flyTo({ center: [lon, lat], zoom: exZoom, duration: 500 });
          });
          const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
            .setLngLat([lon, lat]).addTo(map);
          markers.set(key, { marker, kind: 'cluster', clusterId });
        } else {
          const item = f.properties;
          const key = 'p:' + keyOf(item);
          seen.add(key);
          const entry = markers.get(key);
          if (entry && entry.kind === 'point') {
            entry.marker.setLngLat([lon, lat]);
            applyVisual(entry.marker.getElement(), item);
            entry.marker._data = item;
          } else {
            if (entry) entry.marker.remove();
            const el = applyVisual(null, item);
            const marker = new maplibregl.Marker({ element: el, anchor: pointAnchor })
              .setLngLat([lon, lat]).addTo(map);
            marker._data = item;
            bindPopup(marker, key, popupOffset, () => buildPopupHtml(marker._data));
            markers.set(key, { marker, kind: 'point' });
          }
        }
      }

      for (const [key, entry] of markers) {
        if (!seen.has(key)) {
          entry.marker.remove();
          markers.delete(key);
        }
      }
    }

    return { setData, reconcile, markers };
  }

  const stationsLayer = createClusterLayer({
    radius: 50, maxZoom: 18, pointAnchor: 'bottom', popupOffset: 42,
    applyVisual: applyStationVisual, buildPopupHtml: popupHtml,
    keyOf: (s) => s.id, clusterKind: 'station',
  });

  // Loose-bike clusters mirror the marker language: a rounded square (not the
  // stations' circle), neutral coloured so no bubble can be mistaken for a
  // battery level, with glyphs showing what's inside — bike, bolt, or both.
  const bikesLayer = createClusterLayer({
    radius: 45, maxZoom: 18, pointAnchor: 'center', popupOffset: 20,
    applyVisual: applyBikeVisual, buildPopupHtml: bikePopupHtml,
    keyOf: (b) => b.id, clusterKind: 'bike',
  });

  // Re-place markers on camera change — pan, zoom, *and rotation* all change
  // what's visible and where clusters should split, even though the
  // underlying data hasn't moved. Cheap: this only queries the already-built
  // Supercluster index, never rebuilds it. Bound to 'move' (fires
  // continuously through a gesture) rather than only 'moveend', so clusters
  // split/merge progressively as you zoom instead of all at once when the
  // gesture finishes — rAF-throttled so it runs at most once per rendered
  // frame regardless of how often 'move' itself fires.
  let reconcileScheduled = false;
  function scheduleReconcile() {
    if (reconcileScheduled) return;
    reconcileScheduled = true;
    requestAnimationFrame(() => {
      reconcileScheduled = false;
      stationsLayer.reconcile();
      bikesLayer.reconcile();
    });
  }
  map.on('move', scheduleReconcile);
  map.on('moveend', scheduleReconcile); // final precise pass once the gesture settles

  // ---- Reconcile markers with state ----------------------------------------
  function render() {
    const filtered = state.hideEmpty ? state.stations.filter((s) => countFor(s) > 0) : state.stations;
    stationsLayer.setData(filtered);
    stationsLayer.reconcile();
    renderBikes();
    updateTally();
  }

  // Show the kinds that match the current filter. Mechanical loose bikes
  // exist too, so "Mechanical" is no longer an empty case.
  function renderBikes() {
    const wanted = state.type === 'both' ? null : state.type;
    const list = (state.bikes || []).filter((b) => !wanted || b.kind === wanted);
    bikesLayer.setData(list);
    bikesLayer.reconcile();
  }

  function updateTally() {
    let stationCount = 0;
    let bikeCount = 0;
    for (const s of state.stations) {
      const n = countFor(s);
      if (state.hideEmpty && n <= 0) continue;
      stationCount += 1;
      bikeCount += n;
    }
    // Loose (flex-parked) bikes are rentable too — count the ones matching.
    const wanted = state.type === 'both' ? null : state.type;
    bikeCount += (state.bikes || []).filter((b) => !wanted || b.kind === wanted).length;
    document.getElementById('tally-stations').textContent = stationCount;
    document.getElementById('tally-bikes').textContent = bikeCount;
  }

  function applySnapshot(snap) {
    if (!snap || !Array.isArray(snap.stations)) return;
    state.stations = snap.stations;
    state.bikes = Array.isArray(snap.bikes) ? snap.bikes : [];
    render();
    hideVeil();
  }

  // ---- Data: initial load + live stream --------------------------------------
  // The SSE connection is paused whenever the tab is hidden/backgrounded (e.g.
  // phone screen locked, app switched away from) rather than left open to
  // keep receiving a push every ~20s for no reason. On resume we fetch once
  // immediately to catch up on anything missed, then reopen the stream.
  let es = null;

  function startStream() {
    if (es) return; // already connected
    es = new EventSource('stream');
    es.addEventListener('snapshot', (e) => {
      try { applySnapshot(JSON.parse(e.data)); } catch (_) {}
    });
    es.onerror = () => {}; // EventSource retries connection loss on its own
  }

  function stopStream() {
    if (!es) return;
    es.close();
    es = null;
  }

  function resumeLive() {
    fetch('snapshot').then((r) => r.json()).then(applySnapshot).catch(() => {});
    startStream();
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopStream();
    else resumeLive();
  });

  // Boot: always fetch once; only open the live connection if the tab is
  // actually visible right now (a page loading in a background tab shouldn't
  // start streaming until someone actually looks at it).
  fetch('snapshot').then((r) => r.json()).then(applySnapshot).catch(() => {});
  if (!document.hidden) startStream();

  setTimeout(hideVeil, 6000);
  function hideVeil() { document.getElementById('veil').classList.add('hidden'); }

  // ---- Language switcher ----------------------------------------------------
  function applyI18n() {
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = t(el.dataset.i18n);
    });
    const loc = document.getElementById('locate');
    loc.setAttribute('aria-label', t('locate'));
    loc.title = t('locate');
    document.documentElement.lang = lang;
    document.getElementById('lang-flag').innerHTML = LANGS[lang].flag('btn');
  }

  function buildLangMenu() {
    const menu = document.getElementById('lang-menu');
    menu.innerHTML = Object.entries(LANGS)
      .map(
        ([code, l]) =>
          `<li role="none"><button role="menuitem" data-lang="${code}" class="lang-item${
            code === lang ? ' is-active' : ''
          }"><span class="lang-flag">${l.flag(code)}</span>${l.name}</button></li>`,
      )
      .join('');
  }

  function applyLang(code) {
    lang = LANGS[code] ? code : 'en';
    try { localStorage.setItem('bubi-lang', lang); } catch (_) {}
    applyI18n();
    buildLangMenu();
    // Only popup text is language-dependent — markers, icons, and clusters
    // don't need rebuilding, so this stays light and never disturbs the map.
    refreshAllPopups();
  }

  const langBtn = document.getElementById('lang-btn');
  const langMenu = document.getElementById('lang-menu');
  function toggleLangMenu(force) {
    const open = force !== undefined ? force : langMenu.hidden;
    langMenu.hidden = !open;
    langBtn.setAttribute('aria-expanded', String(open));
  }
  langBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleLangMenu(); });
  langMenu.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-lang]');
    if (!btn) return;
    applyLang(btn.dataset.lang);
    toggleLangMenu(false);
  });
  document.addEventListener('click', () => toggleLangMenu(false));

  // ---- Dark mode --------------------------------------------------------
  // Defaults to the OS preference (prefers-color-scheme, handled in CSS); an
  // explicit choice from the toggle below overrides that via a data-theme
  // attribute and is remembered from then on. The map itself isn't restyled
  // (Liberty has no dark variant worth using — see the discussion that led
  // here) — instead a CSS filter inverts just the canvas element, leaving
  // our own markers/popups/panels untouched since they're separate DOM
  // layers the filter never reaches.
  const darkMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

  function systemPrefersDark() {
    return darkMediaQuery.matches;
  }

  function isDarkNow() {
    const explicit = document.documentElement.dataset.theme;
    if (explicit === 'dark') return true;
    if (explicit === 'light') return false;
    return systemPrefersDark();
  }

  // The user's own trick: invert just the map canvas rather than restyle it,
  // since it's a separate element from every marker/popup/panel we draw, so
  // nothing else on screen is affected by the filter.
  function applyMapFilter() {
    const canvas = document.querySelector('.maplibregl-canvas');
    if (!canvas) return false; // canvas doesn't exist yet — caller may retry
    canvas.style.filter = isDarkNow()
      ? 'invert(90%) hue-rotate(180deg) brightness(95%) contrast(105%)'
      : '';
    return true;
  }
  // The canvas element appears early in the map's lifecycle, but exactly
  // when isn't worth pinning to a specific MapLibre event (load/styledata
  // timing has known quirks across versions) — a few short, cheap retries is
  // simpler and correct regardless of exactly when the canvas shows up.
  (function ensureMapFilterApplied(attemptsLeft) {
    if (applyMapFilter() !== false || attemptsLeft <= 0) return;
    setTimeout(() => ensureMapFilterApplied(attemptsLeft - 1), 200);
  })(15);

  function applyTheme(explicit) {
    // explicit: 'dark' | 'light' | null (null = follow the OS preference)
    if (explicit) document.documentElement.dataset.theme = explicit;
    else delete document.documentElement.dataset.theme;
    applyMapFilter();
    const toggle = document.getElementById('dark-mode');
    if (toggle) toggle.checked = isDarkNow();
  }

  function loadTheme() {
    try {
      const saved = localStorage.getItem('bubi-theme');
      return saved === 'dark' || saved === 'light' ? saved : null;
    } catch (_) { return null; }
  }

  function saveTheme(explicit) {
    try {
      if (explicit) localStorage.setItem('bubi-theme', explicit);
      else localStorage.removeItem('bubi-theme');
    } catch (_) {}
  }

  document.getElementById('dark-mode').addEventListener('change', (e) => {
    const explicit = e.target.checked ? 'dark' : 'light';
    saveTheme(explicit);
    applyTheme(explicit);
  });

  // Live-follow the OS if the person hasn't made an explicit choice — e.g.
  // an automatic day/night switch on their phone should carry through here.
  darkMediaQuery.addEventListener('change', () => {
    if (!loadTheme()) applyTheme(null);
  });

  applyTheme(loadTheme());

  // ---- Filter persistence ---------------------------------------------------
  function saveFilters() {
    try {
      localStorage.setItem(
        'bubi-filters',
        JSON.stringify({
          type: state.type,
          hideEmpty: state.hideEmpty,
          mapsProvider: state.mapsProvider,
          openIn: state.openIn,
        }),
      );
    } catch (_) {}
  }
  function loadFilters() {
    try {
      const f = JSON.parse(localStorage.getItem('bubi-filters') || '{}');
      if (f.type) state.type = f.type;
      if (typeof f.hideEmpty === 'boolean') state.hideEmpty = f.hideEmpty;
      if (f.mapsProvider) state.mapsProvider = f.mapsProvider;
      if (f.openIn) state.openIn = f.openIn;
    } catch (_) {}
  }

  // The Browser/App choice is only shown when this device has an app for the
  // chosen provider AND "Browser" can actually be honoured — otherwise the
  // control would promise something the platform overrides.
  function updateOpenInVisibility() {
    const field = document.getElementById('open-in-field');
    const show = APP_CAPABLE && providerHasApp() && browserModeHonoured();
    field.style.display = show ? '' : 'none';
  }

  const mapsSelect = document.getElementById('maps-provider');
  mapsSelect.addEventListener('change', (e) => {
    state.mapsProvider = e.target.value;
    saveFilters();
    updateOpenInVisibility();
    refreshOpenPopup(); // relabel the open popup's buttons without closing it
  });

  const openInSelect = document.getElementById('open-in');
  openInSelect.addEventListener('change', (e) => {
    state.openIn = e.target.value;
    saveFilters();
    refreshOpenPopup(); // keep the popup mode split in sync, popup stays open
  });

  // ---- Filter controls ------------------------------------------------------
  const segs = Array.from(document.querySelectorAll('.seg'));
  segs.forEach((btn) => {
    btn.addEventListener('click', () => {
      segs.forEach((b) => {
        const active = b === btn;
        b.classList.toggle('is-active', active);
        b.setAttribute('aria-checked', String(active));
      });
      state.type = btn.dataset.type;
      saveFilters();
      render();
    });
  });
  document.getElementById('hide-empty').addEventListener('change', (e) => {
    state.hideEmpty = e.target.checked;
    saveFilters();
    render();
  });

  // Restore saved filters and force the controls to match state (fixes the
  // browser "remembering" a checkbox visual that disagrees with actual state).
  function syncControlsToState() {
    document.getElementById('hide-empty').checked = state.hideEmpty;
    document.getElementById('maps-provider').value = state.mapsProvider;
    document.getElementById('open-in').value = state.openIn;
    updateOpenInVisibility();
    segs.forEach((b) => {
      const active = b.dataset.type === state.type;
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-checked', String(active));
    });
  }
  loadFilters();
  syncControlsToState();

  // ---- Bottom sheet expand/collapse ----------------------------------------
  const sheet = document.getElementById('sheet');
  const handle = document.getElementById('handle');

  // On desktop the settings panel floats beside the map, so the locate
  // button needs to track its top edge to stay sensibly placed next to it —
  // flush against it, not floating in a gap above it. On phone the expanded
  // sheet covers roughly half the screen anyway (nothing left to usefully
  // locate yourself against), and it has a higher z-index than the button,
  // so it naturally slides up and over the button when expanded — nothing
  // to compute there, the button just stays at its default (collapsed)
  // position and lets itself be covered.
  //
  // The position is *measured*, not predicted from the sheet's CSS
  // transform math — that math (bottom-anchor offset + the collapsed-state
  // translateY, which differ between the mobile and desktop rules) is easy
  // to get subtly wrong by hand, and it did in fact produce the wrong
  // number once already. Instead: briefly disable the sheet's own
  // transition, read its real on-screen position with
  // getBoundingClientRect(), then re-enable the transition — all within the
  // same synchronous pass before the browser paints anything, so nothing
  // visibly flashes and the number is simply correct by construction.
  const DESKTOP_BREAKPOINT = '(min-width: 640px)';
  function syncLocateBtnPosition() {
    const isDesktop = window.matchMedia(DESKTOP_BREAKPOINT).matches;
    if (!isDesktop) {
      locateBtn.style.bottom = ''; // falls back to the CSS default (collapsed height)
      return;
    }
    const prevTransition = sheet.style.transition;
    sheet.style.transition = 'none';
    sheet.getBoundingClientRect(); // force layout with the transition off
    const top = sheet.getBoundingClientRect().top;
    sheet.style.transition = prevTransition;

    // Align the button's *top* edge with the panel's top edge (not its
    // bottom edge, which is what a plain "bottom: viewportHeight - top"
    // would give you) — subtract the button's own height so the two line
    // up at the same height instead of the button floating entirely above.
    const btnHeight = locateBtn.offsetHeight;
    locateBtn.style.bottom = `${Math.round(window.innerHeight - top - btnHeight)}px`;
  }

  function toggleSheet(force) {
    const collapsed = force !== undefined ? force : !sheet.classList.contains('collapsed');
    sheet.classList.toggle('collapsed', collapsed);
    handle.setAttribute('aria-expanded', String(!collapsed));
    syncLocateBtnPosition();
  }
  window.addEventListener('resize', syncLocateBtnPosition); // orientation change / breakpoint crossing
  handle.addEventListener('click', () => toggleSheet());
  let startY = null;
  handle.addEventListener('touchstart', (e) => { startY = e.touches[0].clientY; }, { passive: true });
  handle.addEventListener('touchend', (e) => {
    if (startY === null) return;
    const dy = e.changedTouches[0].clientY - startY;
    if (dy < -24) toggleSheet(false);
    else if (dy > 24) toggleSheet(true);
    startY = null;
  }, { passive: true });

  // ---- Geolocation (live) ---------------------------------------------------
  const locateBtn = document.getElementById('locate');
  let userMarker = null;
  let watchId = null;
  let lastFix = null; // { lat, lon, acc } — kept so the accuracy ring can be
  // recomputed in pixels whenever the zoom level changes.
  let accuracyLayerReady = false;

  // MapLibre's circle layers size `circle-radius` in screen pixels, not
  // metres, so a real-world accuracy radius has to be converted by hand and
  // re-converted on every zoom change (metres-per-pixel changes with both
  // zoom and latitude — the standard Web Mercator scale factor).
  function metersToPixels(meters, lat, zoom) {
    return meters / ((156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom));
  }

  function ensureAccuracyLayer() {
    if (accuracyLayerReady) return;
    if (!map.isStyleLoaded()) { map.once('load', ensureAccuracyLayer); return; }
    map.addSource('user-accuracy', {
      type: 'geojson',
      data: { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} },
    });
    map.addLayer({
      id: 'user-accuracy',
      type: 'circle',
      source: 'user-accuracy',
      paint: { 'circle-radius': 0, 'circle-color': '#2b6fe0', 'circle-opacity': 0.12 },
    });
    accuracyLayerReady = true;
    if (lastFix) updateAccuracyCircle();
  }

  function updateAccuracyCircle() {
    if (!accuracyLayerReady || !lastFix) return;
    map.getSource('user-accuracy').setData({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: toLngLat(lastFix.lat, lastFix.lon) },
      properties: {},
    });
    map.setPaintProperty(
      'user-accuracy', 'circle-radius',
      metersToPixels(lastFix.acc, lastFix.lat, map.getZoom()),
    );
  }
  map.on('zoom', updateAccuracyCircle);

  // ---- Compass heading (the "which way am I facing" arrow) ------------------
  // Two unrelated sensors are in play: the Geolocation API's `coords.heading`
  // (derived from GPS movement — null while standing still, which is exactly
  // when someone's checking the map) and the device's own magnetometer via
  // DeviceOrientationEvent (works standing still — what we actually want).
  //
  // MapLibre markers have a built-in `rotation` + `rotationAlignment: 'map'`
  // mechanism made for exactly this: the rotation is interpreted as a
  // true-north bearing, and MapLibre keeps it visually correct on screen as
  // the *map itself* rotates — no manual recompute needed on map rotate.
  let smoothedHeading = null; // degrees, 0–360 clockwise from true north

  function angleDelta(from, to) {
    let d = to - from;
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    return d;
  }

  function applyHeading(headingDeg) {
    smoothedHeading = smoothedHeading == null
      ? headingDeg
      : (smoothedHeading + angleDelta(smoothedHeading, headingDeg) * 0.25 + 360) % 360;
    if (!userMarker) return; // heading can arrive before the first GPS fix
    userMarker.setRotation(smoothedHeading);
    userMarker.getElement().classList.add('has-heading');
  }

  function onDeviceOrientation(e) {
    let heading = null;
    if (typeof e.webkitCompassHeading === 'number' && !Number.isNaN(e.webkitCompassHeading)) {
      heading = e.webkitCompassHeading; // iOS Safari: already true-north referenced
    } else if (e.absolute === true && e.alpha != null) {
      heading = (360 - e.alpha) % 360; // alpha is CCW; this converts to CW-from-north
    }
    // Anything else (relative-only orientation, unsupported) is not trustworthy
    // enough to show as a compass direction — silently skip rather than show
    // a heading that might be wrong. The dot just stays a plain dot.
    if (heading == null || Number.isNaN(heading)) return;
    applyHeading(heading);
  }

  function requestHeadingPermission() {
    // iOS 13+ requires this to be called synchronously from a real user
    // gesture — bundled into the same "find me" tap rather than a separate
    // control. If the person declines, or the device/browser has no
    // magnetometer at all, the dot just never grows an arrow.
    if (typeof DeviceOrientationEvent !== 'undefined'
        && typeof DeviceOrientationEvent.requestPermission === 'function') {
      DeviceOrientationEvent.requestPermission()
        .then((state) => {
          if (state === 'granted') window.addEventListener('deviceorientation', onDeviceOrientation);
        })
        .catch(() => {});
    } else if ('ondeviceorientationabsolute' in window) {
      window.addEventListener('deviceorientationabsolute', onDeviceOrientation);
    } else if (typeof DeviceOrientationEvent !== 'undefined') {
      window.addEventListener('deviceorientation', onDeviceOrientation);
    }
  }

  function onPosition(pos) {
    locateBtn.classList.remove('locating');
    locateBtn.classList.add('located');
    const lat = pos.coords.latitude;
    const lon = pos.coords.longitude;
    lastFix = { lat, lon, acc: pos.coords.accuracy || 0 };
    ensureAccuracyLayer();
    updateAccuracyCircle();
    if (!userMarker) {
      const host = document.createElement('div');
      const child = ensureChild(host);
      child.className = 'user-dot-wrap';
      child.innerHTML = '<div class="user-heading"></div><div class="user-dot"></div>';
      userMarker = new maplibregl.Marker({ element: host, anchor: 'center', rotationAlignment: 'map' })
        .setLngLat(toLngLat(lat, lon)).addTo(map);
      if (smoothedHeading != null) applyHeading(smoothedHeading); // a reading may have arrived first
      map.flyTo({ center: toLngLat(lat, lon), zoom: 16, duration: 800 });
    } else {
      userMarker.setLngLat(toLngLat(lat, lon));
    }
  }

  locateBtn.addEventListener('click', () => {
    if (!navigator.geolocation) return;
    // Already tracking with a fix → just recenter on the user.
    if (userMarker) {
      map.flyTo({ center: userMarker.getLngLat(), zoom: 16, duration: 800 });
      return;
    }
    requestHeadingPermission(); // must be called directly from this gesture (iOS)
    locateBtn.classList.add('locating');
    // watchPosition keeps the dot live as you move, so you can see which
    // stations/bikes are actually closest.
    watchId = navigator.geolocation.watchPosition(
      onPosition,
      () => { locateBtn.classList.remove('locating'); if (!userMarker) alert(t('geo_error')); },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 10000 },
    );
  });

  // ---- iOS home-screen hint (browser only; never in the installed app) -----
  (function iosHint() {
    const isIOS = /iP(hone|ad|od)/.test(window.navigator.userAgent);
    const standalone = window.navigator.standalone === true ||
      window.matchMedia('(display-mode: standalone)').matches;
    let dismissed = false;
    try { dismissed = localStorage.getItem('bubi-ios-hint') === '1'; } catch (_) {}
    if (isIOS && !standalone && !dismissed) {
      const hint = document.getElementById('ios-hint');
      hint.hidden = false;
      document.getElementById('ios-hint-close').addEventListener('click', () => {
        hint.hidden = true;
        try { localStorage.setItem('bubi-ios-hint', '1'); } catch (_) {}
      });
    }
  })();

  // ---- Boot -----------------------------------------------------------------
  lang = detectLang();
  applyI18n();
  buildLangMenu();
  syncLocateBtnPosition();
})();

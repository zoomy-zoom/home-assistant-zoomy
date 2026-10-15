/* Zoomy trip map (zoomy-route-map-card): the car's trips as a list, and the chosen trip's route on Home Assistant's
   own map (the ha-map element, so the map pictures come the same way as on every other map in Home Assistant).

   Ported from the HOME-styled zoomy-trip-map.js (card version 6, 15 Oct 2026). The look and the words are as
   there. What changed: the line of a trip is ONLY the car's own recorded route, kept by this integration
   (zoomy/route_keys for the list, zoomy/route for one trip's points); the car maker's cloud tracker and Home Assistant's
   history are not used at all. The trip's facts (km, minutes, consumption, battery) come from zoomy/trips. The
   lists are read again when the car's subscription says its routes or trips changed (no sensor is watched).
   Home Assistant 2026.10 draws its map with a new engine (no Leaflet, no "layers"): there the route is drawn with
   "paths" only (thinned to 400 points; start and end as one-point paths). An older map (Leaflet) is drawn as before.

   PRIVACY: a route is where the owner lives and goes. Coordinates are held only for the trip on screen (inside the
   line on the map); no route is cached, and nothing is logged, stored or sent anywhere. The card loads nothing from
   anywhere else and holds no secrets. */

import { ZoomyCard, registerCard } from './core.js';

const CSS = `
  .wrap { min-width: 300px; color: #f0f7ff; }
  .page { display: flex; flex-direction: column; box-sizing: border-box; height: var(--zoomy-h, calc(100vh - 56px)); min-height: 420px;
          padding: 14px 18px 16px; gap: 12px; }
  .page > .zcars { margin: 0; }
  .head { display: flex; flex-wrap: wrap; gap: 6px 20px; align-items: flex-end; flex: none; }
  /* HOME's page heading, same sizes and colours as the HOME page */
  .titles { min-width: 0; }
  .facts { color: #9db6c9; font-size: 13px; font-variant-numeric: tabular-nums; }
  .body { display: flex; gap: 16px; flex: 1; min-height: 0; }
  .side { display: flex; flex-direction: column; gap: 8px; flex: none; width: 300px; min-height: 0; }
  .body.left .side { order: -1; }
  .count { flex: none; font-size: 12px; color: #9db6c9; padding: 0 2px; }
  .trips { display: flex; flex-direction: column; gap: 8px; flex: 1; min-height: 0; overflow-y: auto; padding: 1px 4px 1px 1px;
           scrollbar-width: thin; scrollbar-color: #294252 transparent; }
  /* a trip is a HOME row; the chosen one is lit in HOME's car pink (border, wash, glow) */
  .trips button { flex: none; display: flex; flex-direction: column; gap: 3px; width: 100%; min-height: 36px; box-sizing: border-box; text-align: left;
                  font: inherit; font-size: 13px; color: #f0f7ff; background: #132e3c55; border: 1px solid #34526366;
                  border-radius: 10px; padding: 9px 12px; cursor: pointer; transition: border-color .2s; }
  .trips button:hover { border-color: #4b88a5; }
  .trips button:focus-visible { outline: 2px solid #ffc267; outline-offset: -3px; }
  .trips button[aria-pressed="true"] { border-color: #a44f83; box-shadow: inset 0 0 0 1px #a44f83, inset 0 0 22px #db559f14;
                                       background: radial-gradient(ellipse at 0% 0%, #6b1f4a55, transparent 70%), #151829; color: #f0f7ff; }
  .trips button[aria-pressed="true"] .l2 { color: #9db6c9; }
  .trips button[aria-pressed="true"]:hover { border-color: #d06aa8; }
  .l1 { display: flex; justify-content: space-between; gap: 10px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .l1 .km { flex: none; }
  .trips button[aria-pressed="true"] .km { color: #ff86c8; }
  .l2 { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; color: #9db6c9; font-size: 12px; font-variant-numeric: tabular-nums; }
  .l2 > span:first-child { min-width: 0; }
  .tag { font-size: 10px; font-weight: 700; letter-spacing: .5px; text-transform: uppercase; padding: 1px 7px; border-radius: 20px;
         border: 1px solid #2f6f8a; background: #12364b; color: #9fdcf7; margin-left: 6px; vertical-align: 1px; }
  /* the map in a HOME card frame (fixed corners and shadow: a panel view sets the card radius to 0) */
  .map { position: relative; flex: 1; min-width: 0; min-height: 320px; border: 1px solid #294858; border-radius: 14px; overflow: hidden;
         background: #0b1d2b; box-shadow: 0 8px 22px #0003; }
  ha-map { display: block; position: absolute; inset: 0; width: 100%; height: 100%; }
  /* the notice sits on the map in a box of its own (HOME's dark glass panel, light words), so it reads over any map picture */
  .msg { position: absolute; left: 50%; top: 44%; transform: translate(-50%, -50%); box-sizing: border-box; width: max-content; max-width: calc(100% - 32px);
         text-align: center; font-size: 13px; color: #f0f7ff; background: #0c2335f0; background: linear-gradient(115deg, #0c2335f0, #112f46e6);
         border: 1px solid #39627c; border-radius: 14px; padding: 9px 16px; box-shadow: inset 0 1px 12px #5acaff12, 0 8px 35px #0005;
         backdrop-filter: blur(8px); z-index: 1000; pointer-events: none; }
  /* a short window (a laptop): HOME's smaller heading leaves more room for the map, as on the other pages */
  @media (max-height: 816px) { .head .hs-kicker { margin-bottom: 6px; } .head .hs-title { font-size: 29px; } .head .hs-sub { margin-top: 4px; } }
  @container zoomy (max-width: 760px) {
    .page { height: auto; }
    .body { flex-direction: column; flex: none; }
    .body.left .side { order: 0; }
    .map { flex: none; height: 58vh; }
    .side { width: auto; }
    .trips { overflow-y: visible; flex: none; padding: 1px; }
  }
  @media (prefers-reduced-motion: reduce) { .trips button { transition: none; } }
`;

var DRAW_MAX = 3000;        // a route with more points than this is thinned, for drawing only (older map)
var NEW_DRAW_MAX = 400;     // the new map puts a small dot on every point of a path: keep a route to this many
var SETTLE_MS = 3000;       // the car's posts come in a burst: read the lists this long after a change is seen
var LIST_WAIT_MS = 15000;   // give up on the store's lists after this long
var LOAD_WAIT_MS = 30000;   // give up on one trip's points after this long
var MAP_WAIT_MS = 15000;
var MAP_SLOW_MS = 20000;    // the map's own code has not arrived after this long: say so (and keep waiting)
var RETRY_MS = 30000;       // the lists could not be read: ask again this much later
var FIT = { zoom: 17, pad: 0.15 };
var BLUE = '#4aa3ff', GREEN = '#3ecf8e', RED = '#ff7b72', INK = '#0b1220';
var DOT = ' · ', ARROW = ' → ', DOTS = '…';
var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
var WHY = { gone: 'The car\'s route for this trip is no longer stored.',
            empty: 'The car\'s route for this trip has no usable points.',
            failed: 'The car\'s route for this trip could not be read just now.' };

function esc(s) {
  return s === null || s === undefined ? '' : String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]; });
}
function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
function ms(x) { if (typeof x !== 'string' || !x) return null; var t = new Date(x).getTime(); return isNaN(t) ? null : t; }
// dates are written by hand, as on the charts page (the browser's own tables give "Sept" and "July"): Wed, 14 Oct
function day(d, year) { return DOW[d.getDay()] + ', ' + d.getDate() + ' ' + MON[d.getMonth()] + (year ? ' ' + d.getFullYear() : ''); }
function hm(d) { return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
function dur(m) { return m >= 60 ? Math.floor(m / 60) + ' h ' + (m % 60) + ' min' : m + ' min'; }   // whole minutes, as on the charts page
function count(n, one, many) { return n.toLocaleString('en-AU') + ' ' + (n === 1 ? one : many); }
function waitFor(test, wait) {
  return new Promise(function (res, rej) {
    var t0 = Date.now();
    (function again() {
      if (test()) return res();
      if (Date.now() - t0 > wait) return rej(new Error('the map did not get ready'));
      setTimeout(again, 150);
    })();
  });
}
/* Home Assistant 2026.10 replaced the map element's Leaflet with a new engine: no "Leaflet", no "leafletMap", no
   "layers". Such a map is drawn with "paths" only. An older map still declares "layers". */
export function newMap(map) {
  var props = map && map.constructor && map.constructor.elementProperties;
  return !(props && props.has && props.has('layers'));
}
// a one-point path: the new map draws it as a single coloured dot with a tooltip (the start and end markers)
function dotPath(p, color, name, t) { return { points: [{ point: p, timestamp: t }], color: color, name: name, fullDatetime: false }; }

// ----- the list ---------------------------------------------------------------------------------------------

/* One row. id = the trip's start in milliseconds (how a route and its trip are matched, and how a row is found
   again); key = the store's own text for the start, needed to ask for the route. t = the trip's facts (may be
   missing), r = what the store's route list says. */
function entry(id, key, t, r) {
  t = t || {}; r = r || {};
  var end = ms(t.end); if (end === null) end = ms(r.trip_end);
  if (end !== null && end < id) end = null;
  // the car's own minutes when it gives them (the charts page shows the same number), otherwise from start and end
  var min = num(t.minutes);
  if (min !== null && min < 0) min = null;
  if (min === null && end !== null) min = (end - id) / 60000;
  return { id: id, key: key, a: new Date(id), b: end === null ? null : new Date(end),
           min: min === null ? null : Math.max(0, Math.round(min)),
           km: num(t.km) !== null ? t.km : num(r.km), eff: num(t.kwh_per_100km), s0: num(t.soc_start), s1: num(t.soc_end), n: num(r.n) };
}
/* The list, newest first: one row per stored route, with the facts of its trip when the store has them.
   routes = the answer of zoomy/route_keys, rows = the rows of zoomy/trips (or null). */
export function buildList(routes, rows) {
  var facts = {}, seen = {}, out = [];
  (Array.isArray(rows) ? rows : []).forEach(function (t) {
    var id = t && typeof t === 'object' ? ms(t.start) : null;
    if (id !== null && !facts[id]) facts[id] = t;
  });
  (Array.isArray(routes) ? routes : []).forEach(function (r) {
    var id = r && typeof r === 'object' ? ms(r.trip_start) : null;
    if (id === null || seen[id]) return;
    seen[id] = true;
    out.push(entry(id, r.trip_start, facts[id], r));
  });
  out.sort(function (p, q) { return q.id - p.id; });
  return out;
}
function spansYears(list) { return list.length > 1 && list[0].a.getFullYear() !== list[list.length - 1].a.getFullYear(); }
function rowHtml(e, i, year) {
  var bits = [];
  if (e.min !== null) bits.push(dur(e.min));
  if (e.eff !== null) bits.push(e.eff.toFixed(1) + ' kWh/100 km');
  if (e.s0 !== null && e.s1 !== null) bits.push(e.s0.toFixed(0) + ARROW + e.s1.toFixed(0) + '%');
  return '<button type="button" data-k="' + esc(e.id) + '" aria-pressed="false">' +
         '<span class="l1"><span>' + esc(day(e.a, year) + DOT + hm(e.a)) + (i === 0 ? '<span class="tag">last</span>' : '') + '</span>' +
         '<span class="km">' + (e.km !== null ? esc(e.km.toFixed(1) + ' km') : '') + '</span></span>' +
         '<span class="l2"><span>' + esc(bits.join(DOT)) + '</span></span></button>';
}
/* The line above the list, e.g. "45 trips with the car's route, newest first". failed: the store did not answer
   the latest time it was asked (the list is the one from its last answer). off: route storage is turned off. */
export function countLine(list, failed, off) {
  return count(list.length, 'trip', 'trips') + ' with the car\'s route' + (list.length > 1 ? ', newest first' : '') +
         (off ? ' (new routes are not kept: Keep GPS routes is off)' : '') +
         (failed ? ' (the list of routes could not be refreshed just now)' : '');
}
function pointsText(n) { return (n === 0 ? 'no points' : count(n, 'point', 'points')) + ' from the car'; }
// the line beside the title; n = how many points the line has (null while loading)
function factsText(e, n, year) {
  var bits = [day(e.a, year) + ' ' + hm(e.a)];
  if (e.km !== null) bits.push(e.km.toFixed(1) + ' km');
  if (e.min !== null) bits.push(dur(e.min));
  if (e.eff !== null) bits.push(e.eff.toFixed(1) + ' kWh/100 km');
  if (e.s0 !== null && e.s1 !== null) bits.push('battery ' + e.s0.toFixed(0) + ARROW + e.s1.toFixed(0) + '%');
  if (n !== null) bits.push(pointsText(n));
  return bits.join(DOT);
}

// ----- points (examples in tests use made-up places only) -------------------------------------------------------

// a usable position: two real numbers, on the globe, and not the 0, 0 a GPS gives before it has a fix
function okPoint(la, lo) {
  return typeof la === 'number' && typeof lo === 'number' && isFinite(la) && isFinite(lo) &&
         la >= -90 && la <= 90 && lo >= -180 && lo <= 180 && !(la === 0 && lo === 0);
}
// the usable [lat, lon] pairs of a stored route, in order
export function cleanPoints(raw) {
  var out = [];
  if (!Array.isArray(raw)) return out;
  for (var i = 0; i < raw.length; i++) {
    var p = raw[i];
    if (Array.isArray(p) && okPoint(p[0], p[1])) out.push([p[0], p[1]]);
  }
  return out;
}
// two opposite corners of the box around the points, for fitting the map
export function bounds(pts) {
  var a = 90, b = 180, c = -90, d = -180;
  for (var i = 0; i < pts.length; i++) {
    var p = pts[i];
    if (p[0] < a) a = p[0]; if (p[0] > c) c = p[0];
    if (p[1] < b) b = p[1]; if (p[1] > d) d = p[1];
  }
  return [[a, b], [c, d]];
}
// every step-th point, and always the last one
function every(pts, step) {
  var out = [];
  for (var i = 0; i < pts.length - 1; i += step) out.push(pts[i]);
  out.push(pts[pts.length - 1]);
  return out;
}
/* Drop the points that sit within "metres" of the straight line between their neighbours that stay
   (Douglas-Peucker, without recursion). The first and the last point always stay. Gives null for an odd shape
   that would take too long to work through: 150 looks per point are allowed, a road-like route needs 10 to 30. */
function simplify(pts, metres) {
  var n = pts.length;
  if (n < 3) return pts;
  var k = Math.cos(pts[0][0] * Math.PI / 180);          // a degree of longitude is this much shorter than one of latitude
  var tol = metres / 111320, tol2 = tol * tol;          // in degrees of latitude
  var keep = new Uint8Array(n), stack = [0, n - 1], allowance = 150 * n;
  keep[0] = keep[n - 1] = 1;
  while (stack.length) {
    var hi = stack.pop(), lo = stack.pop();
    if (hi - lo < 2) continue;
    allowance -= hi - lo;
    if (allowance < 0) return null;
    var ax = pts[lo][1] * k, ay = pts[lo][0], dx = pts[hi][1] * k - ax, dy = pts[hi][0] - ay, len2 = dx * dx + dy * dy;
    var best = -1, at = -1;
    for (var i = lo + 1; i < hi; i++) {
      var px = pts[i][1] * k - ax, py = pts[i][0] - ay, t = len2 > 0 ? (px * dx + py * dy) / len2 : 0;
      if (t < 0) t = 0; else if (t > 1) t = 1;
      var ex = px - t * dx, ey = py - t * dy, d2 = ex * ex + ey * ey;
      if (d2 > best) { best = d2; at = i; }
    }
    if (best > tol2) { keep[at] = 1; stack.push(lo, at, at, hi); }
  }
  var out = [];
  for (var j = 0; j < n; j++) if (keep[j]) out.push(pts[j]);
  return out;
}
/* For drawing only: a route of more than "max" points is thinned so that its shape stays. Straight runs lose
   their points first: at most 3 m off the line, then 6 m, 12 m ... until few enough are left. An odd shape
   that this cannot handle is cut evenly instead. The first and the last point always stay. */
export function thin(pts, max) {
  if (pts.length <= max) return pts;
  for (var metres = 3, i = 0; i < 14; i++, metres *= 2) {
    var cut = simplify(pts, metres);
    if (!cut) break;
    if (cut.length <= max) return cut;
  }
  return every(pts, Math.ceil((pts.length - 1) / (max - 1)));
}

/* Layout: the map on the left, the trips as
   a list down the right, scrolling by itself; the page is one screen high. On a narrow card (a phone) the list goes
   under the map and the page scrolls. Card option  list_side: left  swaps the two. */
function makeTripMapPage(io) {
  'use strict';
  var left = io.config && io.config.list_side === 'left';
  io.box.innerHTML = '<div class="page"><div class="zcars" hidden></div><div class="head">' +
    '<div class="titles"><p class="hs-kicker" id="kick">' + esc('Zoomy · ' + io.title()) + '</p><h1 class="hs-title">ZOOMY <em>— Trip map</em></h1>' +
    '<p class="hs-sub">Pick a trip to see its route on the map</p></div>' +
    '<span class="facts" id="facts"></span></div><div class="body' + (left ? ' left' : '') + '" id="body">' +
    '<div class="map" id="mapbox"><div class="msg" id="msg">Loading the map' + DOTS + '</div></div>' +
    '<div class="side"><div class="count" id="count"></div>' +
    '<div class="trips" id="trips" role="group" aria-label="Choose a trip"></div></div></div></div>';

  var S = {
    dead: false,
    map: null,
    ready: false,   // is the code of Home Assistant's map element loaded?
    list: [],       // the rows on screen (see entry())
    failed: false,  // the store did not answer the latest time (the list is the one from its last answer)
    off: false,     // route storage is turned off for this car
    year: false,    // do the rows span more than one year?
    html: null,     // the list as last written to the page
    sel: null,      // id of the chosen trip
    shown: null,    // what the map shows or is loading: { id, n }, n = points in the line, null while loading
    box: null,      // corners of the trip on screen, to put it back in view (see again)
    lmap: null,     // the (older, Leaflet) map the trip on screen was drawn on
    sig: null, timer: null, retry: null,
    good: null,     // the last answer in which the store gave its list of routes
    listNo: 0, loadNo: 0   // counters that drop the answers to questions that are no longer wanted
  };
  function $(id) { return io.root.getElementById(id); }
  function say(t) { var m = $('msg'); if (m) { m.textContent = t; m.hidden = !t; } }
  function find(id) { for (var i = 0; i < S.list.length; i++) if (S.list[i].id === id) return S.list[i]; return null; }
  function describe(e, n) { $('facts').textContent = factsText(e, n, S.year); }

  $('trips').addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('button') : null; if (!b) return;
    var t = find(Number(b.dataset.k));
    if (t) { load(t); reveal(); }
  });

  // Home Assistant only loads its map element when a map card is first wanted: ask for one, then wait for it.
  // On a slow connection the map's code can take long: say so after a while, and carry on when it does arrive.
  var slow = io.later(function () { say('The map is taking a long time to load. If it does not appear, reload the page.'); }, MAP_SLOW_MS);
  var ready;
  try { ready = window.loadCardHelpers ? Promise.resolve(window.loadCardHelpers()) : Promise.reject(new Error('this Home Assistant cannot load its map here')); }
  catch (e) { ready = Promise.reject(e); }
  ready.then(function (helpers) {
    try { helpers.createCardElement({ type: 'map', entities: ['zone.home'] }); } catch (e) { /* only wanted for loading the map code */ }
    return customElements.whenDefined('ha-map');
  }).then(function () {
    if (S.dead) return;
    io.clear(slow);
    S.ready = true; makeMap(); check();
  }).catch(function (e) {
    if (S.dead) return;
    io.clear(slow);
    say('Could not load the map: ' + (e && e.message ? e.message : 'something went wrong'));
  });

  /* The map element is given hass, as an older Home Assistant's own map card gave it (newer ones read it from the
     page); where the element does not need it, or does not take it, this changes nothing. */
  function give(h) { try { if (S.map && h) S.map.hass = h; } catch (e) { /* not needed */ } }
  // make Home Assistant's map element, once its code is loaded
  function makeMap() {
    if (S.map || !S.ready || S.dead) return;
    try {
      var map = document.createElement('ha-map');
      map.autoFit = false; map.fitZones = false; map.zoom = 14; map.entities = []; map.paths = []; map.themeMode = 'dark';
      S.map = map; give(io.hass());
      $('mapbox').appendChild(map);
      S.sig = null; say('');
    } catch (e) {
      S.map = null;
      S.ready = false;   // not tried again on every look
      say('Could not load the map: ' + (e && e.message ? e.message : 'something went wrong'));
    }
  }

  // ----- the list -------------------------------------------------------------------------------------------

  /* The store's two lists (no coordinates in either). Never fails: routes is null when Zoomy is not loaded
     (why: 'absent') or did not answer properly (why: 'failed'); rows is null when the trips could not be read. */
  function readStore() {
    var out = { routes: null, rows: null, why: null, off: false };
    var a = io.ask('route_keys', null, LIST_WAIT_MS).then(function (r) {
      if (r && Array.isArray(r.routes)) { out.routes = r.routes; out.off = r.store_routes === false; } else out.why = 'failed';
    }, function (e) { out.why = e && e.code === 'unknown_command' ? 'absent' : 'failed'; });
    var b = io.ask('trips', null, LIST_WAIT_MS).then(function (r) {
      if (r && Array.isArray(r.rows)) out.rows = r.rows;
    }, function () { /* the rows then have only the route's own km */ });
    return Promise.all([a, b]).then(function () { return out; });
  }

  // a look (every few seconds, and when the car's subscription says something changed): anything new from the car?
  function check() {
    if (!S.map || S.dead) return;
    var sig = io.sig(['routes', 'trips']);
    if (sig === S.sig) return;
    var first = S.sig === null;
    S.sig = sig;
    io.clear(S.timer); S.timer = null;
    if (first) rebuild();
    else S.timer = io.later(function () { S.timer = null; rebuild(); }, SETTLE_MS);
  }

  function rebuild() {
    if (!S.map || S.dead) return;
    var no = ++S.listNo;
    io.clear(S.retry); S.retry = null;
    if (S.html === null) $('count').textContent = 'Loading the trips' + DOTS;
    readStore().then(function (st) { if (no === S.listNo && !S.dead) render(st); })
      .catch(function (e) { if (no === S.listNo && !S.dead) $('count').textContent = 'Could not list the trips: ' + (e && e.message ? e.message : 'something went wrong'); });
  }

  function render(st) {
    var store = Array.isArray(st.routes), failed = false;
    /* The store answered earlier and does not now (Home Assistant is restarting, or was slow): keep the list of its
       last answer (no coordinates in it) rather than lose the chosen trip. It is asked again a while later. */
    if (store) S.good = st;
    else if (S.good) { st = S.good; store = true; failed = true; }
    if (!store || failed) S.retry = io.later(function () { S.retry = null; rebuild(); }, RETRY_MS);
    if (!store) {
      S.list = []; S.sel = null; S.failed = false; paint();
      clear(st.why === 'absent' ? 'Zoomy is not loaded in Home Assistant, so there are no routes to show.'
                                : 'Could not read the routes from Home Assistant. It will be tried again shortly.');
      return;
    }
    S.list = buildList(st.routes, st.rows);
    S.failed = failed; S.off = !!st.off;
    S.year = spansYears(S.list);
    if (!S.list.length) {
      S.sel = null; paint();
      clear(S.off ? 'GPS routes are turned off for this car. To keep them, turn on Keep GPS routes: Settings > Devices & services > Zoomy > Configure.'
                  : 'No route yet. The car sends each trip\'s route when it is home on the Wi-Fi.');
      return;
    }
    var keep = find(S.sel) || S.list[0], sh = S.shown;
    S.sel = keep.id; paint();
    // the chosen trip is on the map (or on its way): leave the map alone
    if (sh && sh.id === keep.id) { describe(keep, sh.n); return; }
    load(keep);
  }

  // write the list and the line above it (only touches the page when something changed)
  function paint() {
    var box = $('trips'), list = S.list, year = S.year;
    var html = list.map(function (e, i) { return rowHtml(e, i, year); }).join('');
    if (html !== S.html) {
      var y = box.scrollTop, was = io.root.activeElement, k = was && was.dataset ? was.dataset.k : null;
      box.innerHTML = html; S.html = html; box.scrollTop = y;
      if (k) Array.prototype.forEach.call(box.querySelectorAll('button'), function (b) { if (b.dataset.k === k && b.focus) b.focus({ preventScroll: true }); });
    }
    $('count').textContent = list.length ? countLine(list, S.failed, S.off) : '';
    press();
  }
  function press() {
    var k = S.sel === null ? '' : String(S.sel);
    Array.prototype.forEach.call($('trips').querySelectorAll('button'), function (b) { b.setAttribute('aria-pressed', b.dataset.k === k ? 'true' : 'false'); });
  }
  function clear(why) {
    var map = S.map;
    ++S.loadNo; S.shown = null; S.box = null;
    if (map) { map.paths = []; if (!newMap(map)) map.layers = []; }
    $('facts').textContent = ''; say(why);
  }

  // ----- the map --------------------------------------------------------------------------------------------

  // show trip e: the car's own route, read from the store when it is chosen
  function load(e) {
    var map = S.map; if (!map || S.dead) return;
    var mine = ++S.loadNo;
    S.sel = e.id; press();
    S.shown = { id: e.id, n: null };
    say('Loading the car\'s route' + DOTS);
    describe(e, null);
    var done = io.ask('route', { trip_start: e.key }, LOAD_WAIT_MS).then(function (r) {
      if (mine !== S.loadNo || S.dead) return;
      var pts = cleanPoints(r && r.points);
      return pts.length < 2 ? noRoute(e, mine, 'empty') : drawCar(e, pts, mine);
    }, function (err) {
      if (mine !== S.loadNo || S.dead) return;
      return noRoute(e, mine, err && err.code === 'not_found' ? 'gone' : 'failed');
    });
    Promise.resolve(done).catch(function (err) {
      if (mine !== S.loadNo || S.dead) return;
      // nothing of this trip was drawn: the line of the trip shown before must not stay under the notice
      S.box = null; map.paths = []; if (!newMap(map)) map.layers = [];
      S.shown = null;   // nothing sure is on the map: the next change, or a tap, tries again
      say('Could not show this trip: ' + (err && err.message ? err.message : 'no answer from Home Assistant'));
    });
  }

  // the car's route cannot be had: say why, with nothing drawn
  function noRoute(e, mine, why) {
    var map = S.map;
    S.box = null; map.paths = []; if (!newMap(map)) map.layers = [];
    S.shown = why === 'failed' ? null : { id: e.id, n: 0 };   // a read that failed is tried again by a tap or the next change
    describe(find(e.id) || e, null);
    say(WHY[why]);
  }

  /* On a narrow card the list is under the map and the page scrolls: after a tap on a trip far down the list,
     bring the map back into view (only when less than half of it can be seen). */
  function reveal() {
    try {
      var box = $('mapbox'), r = box.getBoundingClientRect(), high = window.innerHeight || 0;
      var seen = Math.min(r.bottom, high) - Math.max(r.top, 0);
      if (high > 0 && r.height > 0 && seen < Math.min(r.height, high) / 2 && box.scrollIntoView) box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) { /* cosmetic only */ }
  }

  function mark(L, p, fill, label, dir) {
    return L.circleMarker(p, { radius: 8, color: INK, weight: 2, fillColor: fill, fillOpacity: 1 })
            .bindTooltip(label, { permanent: true, direction: dir, offset: [dir === 'right' ? 10 : -10, 0] });
  }

  // the car's own route: one line through all its points, with the start and the end marked
  function drawCar(e, pts, mine) {
    var map = S.map, n = pts.length, first = pts[0], last = pts[n - 1];
    var box = bounds(pts), line = thin(pts, newMap(map) ? NEW_DRAW_MAX : DRAW_MAX);
    if (newMap(map)) {
      var now0 = find(e.id) || e, a0 = now0.a ? now0.a.getTime() : e.id, b0 = now0.b ? now0.b.getTime() : a0, k = line.length;
      // the route has no time for each point: the dots get times spread evenly between the trip's start and end
      map.paths = [{ points: line.map(function (q, i) { return { point: q, timestamp: new Date(k > 1 ? a0 + (b0 - a0) * i / (k - 1) : a0) }; }),
                     color: BLUE, name: 'Route', fullDatetime: false },
                   dotPath(first, GREEN, 'Start', new Date(a0)),
                   dotPath(last, RED, 'End', new Date(b0))];
      S.shown = { id: e.id, n: n }; S.box = box; S.lmap = null;
      describe(now0, n); say('');
      pts = null;
      return Promise.resolve(map.updateComplete).then(function () {
        if (mine === S.loadNo && !S.dead) map.fitBounds(box, FIT);
      });
    }
    pts = null;
    return waitFor(function () { return map.Leaflet && map.leafletMap; }, MAP_WAIT_MS).then(function () {
      if (mine !== S.loadNo || S.dead) return;
      var L = map.Leaflet, now = find(e.id) || e;
      // the route has no time for each point: the markers carry the trip's own start and end
      map.paths = [];
      map.layers = [L.polyline(line, { color: BLUE, weight: 4, opacity: 0.9, interactive: false }),
                    mark(L, first, GREEN, 'Start ' + hm(now.a), 'right'),
                    mark(L, last, RED, now.b ? 'End ' + hm(now.b) : 'End', 'left')];
      S.shown = { id: e.id, n: n }; S.box = box; S.lmap = map.leafletMap;
      describe(now, n); say('');
      return Promise.resolve(map.updateComplete).then(function () {
        if (mine === S.loadNo && !S.dead) map.fitBounds(box, FIT);
      });
    });
  }

  /* Home Assistant keeps the cards of a tab when another tab is opened and puts them back later; its map element
     then starts afresh. Put the chosen trip back in view. Nothing is read again, unless the trip had not finished
     loading when the tab was left. */
  function again() {
    var map = S.map, sh = S.shown, old = S.lmap;
    if (!map || S.dead) return;
    if (!sh || sh.n === null) { var e = find(S.sel); if (e) load(e); return; }
    var mine = S.loadNo;
    if (newMap(map)) {
      map.paths = (map.paths || []).slice();
      Promise.resolve(map.updateComplete).then(function () {
        if (mine === S.loadNo && S.box && !S.dead) map.fitBounds(S.box, FIT);
      });
      return;
    }
    waitFor(function () { return map.Leaflet && map.leafletMap && map.leafletMap !== old; }, MAP_WAIT_MS).then(function () {
      if (mine !== S.loadNo || S.dead) return;
      S.lmap = map.leafletMap;
      map.layers = (map.layers || []).slice(); map.paths = (map.paths || []).slice();
      return Promise.resolve(map.updateComplete).then(function () {
        if (mine === S.loadNo && S.box && !S.dead) map.fitBounds(S.box, FIT);
      });
    }).catch(function () { /* still the same map, or none: there is nothing to put back */ });
  }

  io.every(check, 5000);

  return {
    changed: function () { check(); },
    hass: function (h) { give(h); },
    shown: function () { again(); check(); },
    carChanged: function () { var k = $('kick'); if (k) k.textContent = 'Zoomy · ' + io.title(); },
    destroy: function () {
      S.dead = true;
      // the route on screen goes with the page
      try { if (S.map) { S.map.paths = []; if (!newMap(S.map)) S.map.layers = []; } } catch (e) { /* gone anyway */ }
      S.map = null;
    }
  };
}

class ZoomyTripMapCard extends ZoomyCard {
  static get css() { return CSS; }
  static get pageTitle() { return 'Trip map'; }
  setConfig(config) {
    if (config && config.list_side !== undefined && config.list_side !== 'left' && config.list_side !== 'right') {
      throw new Error('Zoomy: list_side must be left or right.');
    }
    super.setConfig(config);
    var body = this.shadowRoot && this.shadowRoot.getElementById('body');
    if (body && body.classList) body.classList.toggle('left', this._config.list_side === 'left');
  }
  makePage(io) { return makeTripMapPage(io); }
}

registerCard('zoomy-route-map-card', ZoomyTripMapCard, 'Zoomy trip map',
  'The trips of a Zoomy car and each trip\'s route on the map, from the car\'s own recorded route.');

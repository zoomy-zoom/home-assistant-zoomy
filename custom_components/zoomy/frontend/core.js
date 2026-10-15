/* Zoomy for Home Assistant: what every Zoomy card shares.

   * the HOME look (colour tokens, the heading, chips and tabs) as CSS text;
   * the list of cars (zoomy/cars), the car the viewer picked (kept in this browser only), and the car picker;
   * one live subscription per car (zoomy/subscribe), with a slow zoomy/status check as a safety net, so every page
     knows when the car has sent something without watching any sensor;
   * ZoomyCard: the base element of every card (config, hass, the car, the page inside it, timers, sizes).

   Everything is read over Home Assistant's own signed-in websocket. Nothing here holds a secret, logs anything,
   stores anything but the picked car's entry id, or loads anything from another host. */

export const BASE = new URL('./', import.meta.url).pathname;                       // /zoomy_static/<version>/
export const VERSION = (/\/zoomy_static\/([^/]+)\//.exec(BASE) || [])[1] || 'dev';

const CARS_TTL = 60000;          // the list of cars is asked for again after this long (or when the registry changes)
const POLL_MS = 60000;           // the safety-net look at zoomy/status, per watched car
const IDLE_MS = 30000;           // a car's subscription stays this long after its last card has gone (tab switches)
const RETRY_MS = [3000, 10000, 30000, 60000];
const PICK_KEY = 'zoomy.car';    // localStorage: the car this viewer picked (an entry id, not a secret)

// ---------------------------------------------------------------------------------------------------------------
// The HOME look. Dark only, like HOME: the cards paint their own page, so they look the same in any theme.
// Values from home-style.css (HOME overview page, 14 Oct 2026); only the parts the cards use.
// ---------------------------------------------------------------------------------------------------------------

export const HS_CSS = `
:host {
  display: block;
  color-scheme: dark;
  --hs-bg: #050e17; --hs-text: #f0f7ff; --hs-muted: #9db6c9; --hs-dim: #7f9db4; --hs-line: #294252;
  --hs-teal: #45ceff; --hs-gold: #ffc267; --hs-green: #65e7ae; --hs-blue: #51c9ff; --hs-violet: #c191ff;
  --hs-warm: #ffa257; --hs-pink: #ff86c8; --hs-radius: 14px;
  --hs-font: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --hs-page-bg: radial-gradient(ellipse at 70% 0%, #162b46 0, transparent 55%), #050e17;
  --hs-card-bg: linear-gradient(135deg, #0f2535eb, #071724ee);
  --hs-card-border: #294858;
  --hs-card-shadow: inset 0 1px 0 #92d9ff0b, 0 8px 22px #0003;
  --hs-rule: #31526788;
}
.hs-accent-car { --hs-accent: #ff86c8; --hs-accent-hi: #ffbde2; --hs-accent-soft: #ff86c81f; --hs-accent-glow: #ff86c83d; --hs-accent-border: #a44f83; --hs-accent-wash: #6b1f4a55; --hs-accent-base: #151829; --hs-accent-halo: #db559f14; }
.hs-accent-teal { --hs-accent: #45ceff; --hs-accent-hi: #95e3ff; --hs-accent-soft: #45ceff1f; --hs-accent-glow: #45ceff3d; --hs-accent-border: #3182a0; --hs-accent-wash: #10506b55; --hs-accent-base: #081b27; --hs-accent-halo: #28b2ed14; }
.hs-accent-gold { --hs-accent: #ffc267; --hs-accent-hi: #ffdca8; --hs-accent-soft: #ffc2671f; --hs-accent-glow: #ffc2673d; --hs-accent-border: #a8834a; --hs-accent-wash: #6b4f1455; --hs-accent-base: #17191f; --hs-accent-halo: #dba44514; }
.hs-accent-solar { --hs-accent: #65e7ae; --hs-accent-hi: #a6f2d1; --hs-accent-soft: #65e7ae1f; --hs-accent-glow: #65e7ae3d; --hs-accent-border: #33a875; --hs-accent-wash: #12654955; --hs-accent-base: #091d22; --hs-accent-halo: #22c07b14; }
.hs-accent-house { --hs-accent: #51c9ff; --hs-accent-hi: #9adfff; --hs-accent-soft: #51c9ff1f; --hs-accent-glow: #51c9ff3d; --hs-accent-border: #3280ac; --hs-accent-wash: #16497155; --hs-accent-base: #091a29; --hs-accent-halo: #299cdb14; }
.hs-accent-export { --hs-accent: #c191ff; --hs-accent-hi: #dcc2ff; --hs-accent-soft: #c191ff1f; --hs-accent-glow: #c191ff3d; --hs-accent-border: #7354ac; --hs-accent-wash: #47247855; --hs-accent-base: #111a2c; --hs-accent-halo: #8b55db14; }
.hs-accent-import { --hs-accent: #ffa257; --hs-accent-hi: #ffc99c; --hs-accent-soft: #ffa2571f; --hs-accent-glow: #ffa2573d; --hs-accent-border: #a8662f; --hs-accent-wash: #6b3a1455; --hs-accent-base: #171a22; --hs-accent-halo: #db7f2914; }
[hidden] { display: none !important; }
/* the page the card paints: HOME's page background, at least as tall as the room under Home Assistant's bar */
.wrap { container: zoomy / inline-size; box-sizing: border-box; min-width: 0; min-height: var(--zoomy-h, calc(100vh - 56px));
        background: var(--hs-page-bg); background-attachment: fixed; color: var(--hs-text); font: 15px/1.35 var(--hs-font);
        -webkit-text-size-adjust: 100%; overflow-wrap: anywhere; }
.hs-kicker { margin: 0 0 10px; color: #9dbdd4; font-size: 11px; letter-spacing: 3px; text-transform: uppercase; }
.hs-title { margin: 0; color: var(--hs-text); font-size: 36px; font-weight: 730; letter-spacing: -1.1px; line-height: 1.15; }
.hs-title em { font-style: normal; font-weight: 500; color: #50ccff; }
.hs-sub { margin: 7px 0 0; color: #a9c3d8; font-size: 13px; }
.hs-chips { display: flex; flex-wrap: wrap; justify-content: flex-end; align-items: center; gap: 10px 14px; font-size: 13px; }
.hs-chip { display: inline-flex; align-items: center; gap: 7px; padding: 7px 12px; border: 1px solid var(--hs-line); border-radius: 24px; white-space: nowrap; }
.hs-chip.is-status { background: #061522b3; color: #b5cad8; font-size: 12px; }
/* the car picker (two or more cars): HOME tabs */
.zcars { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; margin: 0 0 14px; }
.zcars .lbl { color: #9dbdd4; font-size: 11px; letter-spacing: 2px; text-transform: uppercase; }
.zcars .tabs { display: inline-flex; flex-wrap: wrap; gap: 4px; max-width: 100%; padding: 3px; border: 1px solid #2c4b5e; border-radius: 12px; background: #0b2030cc; }
.zcars button { min-height: 34px; padding: 7px 12px; border: 1px solid transparent; border-radius: 9px; background: none; color: var(--hs-muted);
                font: inherit; font-size: 12px; cursor: pointer; overflow-wrap: anywhere; transition: background .2s, color .2s; }
.zcars button:hover { background: #ffffff08; color: #fff; }
.zcars button[aria-pressed="true"] { border-color: #2e728c; background: #143849; color: var(--hs-teal); box-shadow: 0 0 22px #28b2ed18, inset 0 1px #6ad4ff23; }
.zcars button:focus-visible { outline: 3px solid var(--hs-gold); outline-offset: 3px; }
/* a whole-card message: no car yet, cannot read the cars */
.zsay { box-sizing: border-box; max-width: 760px; margin: 0 auto; padding: 48px 20px; color: var(--hs-muted); font-size: 14px; line-height: 1.55; }
.zsay h1 { margin: 0 0 10px; color: var(--hs-text); font-size: 26px; font-weight: 700; letter-spacing: -.6px; }
.zsay h1 em { font-style: normal; font-weight: 500; color: #50ccff; }
@container zoomy (max-width: 800px) {
  .hs-title { font-size: 29px; }
  .hs-chips { justify-content: flex-start; font-size: 12px; }
}
@container zoomy (max-width: 480px) { .hs-kicker { letter-spacing: 2px; } .hs-title { font-size: 26px; } }
@media (pointer: coarse) { .zcars button { min-height: 42px; padding: 10px 14px; font-size: 13px; } }
@media (prefers-reduced-motion: reduce) { .zcars button { transition: none !important; } }
`;

// ---------------------------------------------------------------------------------------------------------------
// Small helpers every card uses
// ---------------------------------------------------------------------------------------------------------------

export function esc(s) {
  return s === null || s === undefined ? '' : String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

/* One question to Home Assistant: it always ends, with the answer or with the reason there is none
   ({code, message}, as Home Assistant's own errors are). */
export function callWS(hass, msg, wait) {
  return new Promise(function (res, rej) {
    var over = false, t = null;
    var end = function (f, v) { if (!over) { over = true; clearTimeout(t); f(v); } };
    t = setTimeout(function () { end(rej, { code: 'timeout', message: 'no answer from Home Assistant' }); }, wait || 30000);
    if (!hass || typeof hass.callWS !== 'function') { end(rej, { code: 'not_ready', message: 'Home Assistant is not ready' }); return; }
    try { Promise.resolve(hass.callWS(msg)).then(function (v) { end(res, v); }, function (e) { end(rej, e); }); }
    catch (e) { end(rej, e); }
  });
}

/* The currency sign for money on the pages: Home Assistant's currency (Settings > System > General). "$" for the
   dollar currencies and when it cannot be worked out. */
export function moneySign(hass) {
  var c = hass && hass.config && typeof hass.config.currency === 'string' ? hass.config.currency : '';
  if (!/^[A-Z]{3}$/.test(c)) return '$';
  try {
    var part = new Intl.NumberFormat('en', { style: 'currency', currency: c, currencyDisplay: 'narrowSymbol' })
      .formatToParts(1).filter(function (p) { return p.type === 'currency'; })[0];
    return part && part.value ? part.value : '$';
  } catch (e) { return '$'; }
}

// ---------------------------------------------------------------------------------------------------------------
// The cars
// ---------------------------------------------------------------------------------------------------------------

let carsPromise = null, carsAt = 0, carsConn = null;

function okCar(c) {
  return !!c && typeof c === 'object' && typeof c.entry_id === 'string' && c.entry_id !== '' &&
         c.entities !== null && typeof c.entities === 'object';
}

/* The cars this user may read: [{entry_id, title, entities: {sensor key: entity id}, store_routes, counts, ...}]. */
export function getCars(hass, force) {
  var now = Date.now(), conn = hass ? hass.connection : null;
  if (!force && carsPromise && carsConn === conn && now - carsAt < CARS_TTL) return carsPromise;
  carsConn = conn; carsAt = now;
  var p = callWS(hass, { type: 'zoomy/cars' }, 15000).then(function (r) {
    var list = r && Array.isArray(r.cars) ? r.cars.filter(okCar) : [];
    list.forEach(function (c) { if (typeof c.title !== 'string' || !c.title.trim()) c.title = 'Zoomy car'; });
    return list;
  });
  carsPromise = p;
  p.catch(function () { if (carsPromise === p) carsPromise = null; });
  return p;
}

let picked = null;
try { picked = window.localStorage.getItem(PICK_KEY); } catch (e) { picked = null; }

export function pickedCar() { return picked; }

export function pickCar(id) {
  picked = id;
  try { window.localStorage.setItem(PICK_KEY, id); } catch (e) { /* remembered for this page only */ }
  window.dispatchEvent(new CustomEvent('zoomy-car-picked', { detail: { entry_id: id } }));
}

/* Which car a card shows: the one its config names, else the one this viewer picked, else the first. */
export function carFor(cars, fixed) {
  if (!Array.isArray(cars) || !cars.length) return null;
  if (fixed) return cars.filter(function (c) { return c.entry_id === fixed; })[0] || null;
  return cars.filter(function (c) { return c.entry_id === picked; })[0] || cars[0];
}

// ---------------------------------------------------------------------------------------------------------------
// Live changes: one subscription per car, shared by every card that shows that car
// ---------------------------------------------------------------------------------------------------------------

const watches = new Map();       // entry id -> Watch
const STATUS_NAMES = ['snapshot', 'trips', 'charges', 'dyno', 'curves', 'routes', 'runs'];

/* What zoomy/status says about each kind of data, as one text per name (no payload, no coordinates): how many
   posts of that kind came and how much is held. A name whose text moves has changed. */
export function statusMarks(r) {
  var p = r && r.posts && typeof r.posts === 'object' ? r.posts : {}, c = r && r.counts && typeof r.counts === 'object' ? r.counts : {};
  var j = function (a) { return a.map(function (v) { return typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean' ? v : ''; }).join('|'); };
  return {
    started: j([r && r.started]),
    snapshot: j([p.snapshot, r && r.snapshot_received, r && r.app_version]),
    trips: j([p.trips, c.trips]),
    charges: j([p.charges, c.charges]),
    dyno: j([p.dyno, c.dyno_pulls]),
    curves: j([p.charge_curve, c.charge_curves]),
    routes: j([p.route, c.routes, r && r.store_routes]),
    runs: j([p.runs, c.runs])
  };
}

class Watch {
  constructor(entryId, hass) {
    this.id = entryId; this.hass = hass; this.fns = new Set();
    this.n = Object.create(null); this.epoch = 0;
    this.unsub = null; this.live = false; this.busy = false; this.tries = 0;
    this.retry = null; this.idle = null; this.poll = null; this.marks = null; this.conn = null;
    var self = this;
    /* The websocket came back. A subscription made with resubscribe: false is gone with the old socket, and its
       unsubscribe must NOT be called now: command ids start again from 1 on the new socket, so it would end
       somebody else's subscription. It is forgotten, and a new one is made. */
    this.onReady = function () { self.live = false; self.unsub = null; self._subscribe(true); };
  }
  add(fn) {
    clearTimeout(this.idle); this.idle = null;
    this.fns.add(fn);
    if (this.fns.size === 1 && !this.live && !this.busy) this._start();
    var self = this;
    return function () { self.remove(fn); };
  }
  remove(fn) {
    this.fns.delete(fn);
    if (this.fns.size) return;
    var self = this;
    clearTimeout(this.idle);
    this.idle = setTimeout(function () { if (!self.fns.size) self._stop(); }, IDLE_MS);
  }
  sig(names) {
    var n = this.n;
    return (names || STATUS_NAMES).map(function (k) { return n[k] || 0; }).join('.') + ':' + this.epoch;
  }
  _tell(names) {
    var self = this;
    names.forEach(function (k) { self.n[k] = (self.n[k] || 0) + 1; });
    this.fns.forEach(function (fn) { try { fn(names); } catch (e) { /* one card must not stop the others */ } });
  }
  _start() {
    var conn = this.hass && this.hass.connection;
    if (conn && conn !== this.conn && typeof conn.addEventListener === 'function') {
      if (this.conn && typeof this.conn.removeEventListener === 'function') this.conn.removeEventListener('ready', this.onReady);
      this.conn = conn;
      conn.addEventListener('ready', this.onReady);
    }
    this._subscribe(false);
    this._schedulePoll();
  }
  _stop() {
    clearTimeout(this.retry); clearTimeout(this.poll); clearTimeout(this.idle);
    this.retry = this.poll = this.idle = null;
    if (this.conn && typeof this.conn.removeEventListener === 'function') this.conn.removeEventListener('ready', this.onReady);
    this.conn = null;
    this.ticket = null;
    this._drop();
    this.live = false; this.busy = false; this.marks = null;
    watches.delete(this.id);
  }
  _drop() {
    var u = this.unsub;
    this.unsub = null;
    if (typeof u === 'function') { try { Promise.resolve(u()).catch(function () {}); } catch (e) { /* already gone */ } }
  }
  /* again: a new subscription after a lost one; the pages then read everything again (epoch) */
  _subscribe(again) {
    var self = this, conn = this.hass && this.hass.connection;
    clearTimeout(this.retry); this.retry = null;
    if (!conn || typeof conn.subscribeMessage !== 'function') { this._later(again); return; }
    this.busy = true;
    var mine = {};
    this.ticket = mine;
    conn.subscribeMessage(function (ev) { if (self.ticket === mine) self._event(ev); },
                          { type: 'zoomy/subscribe', entry_id: this.id }, { resubscribe: false })
      .then(function (unsub) {
        if (self.ticket !== mine || !self.fns.size && !self.idle) { try { unsub(); } catch (e) { /* gone */ } return; }
        self.busy = false; self.live = true; self.tries = 0; self.unsub = unsub;
        if (again) { self.epoch++; self._tell(['all']); }
      }, function () {
        if (self.ticket !== mine) return;
        self.busy = false; self.live = false;
        self._later(again);
      });
  }
  _later(again) {
    var self = this, ms = RETRY_MS[Math.min(this.tries, RETRY_MS.length - 1)];
    this.tries++;
    clearTimeout(this.retry);
    this.retry = setTimeout(function () { if (self.fns.size || self.idle) self._subscribe(again || self.tries > 1); }, ms);
  }
  _event(ev) {
    var names = ev && Array.isArray(ev.changed) ? ev.changed.filter(function (x) { return typeof x === 'string'; }) : [];
    if (names.indexOf('unloaded') >= 0) {
      // the car's entry was reloaded (options changed, or Home Assistant is stopping): its old subscription is dead
      this.live = false; this.ticket = null; this._drop(); this.tries = 0;
      this._later(true);
      return;
    }
    if (names.length) this._tell(names);
  }
  _schedulePoll() {
    var self = this;
    clearTimeout(this.poll);
    this.poll = setTimeout(function () { self._poll(); }, POLL_MS);
  }
  /* The safety net: an event can be missed (a reconnect at the wrong moment). A look at the counters a minute
     apart catches anything that changed meanwhile. */
  _poll() {
    var self = this;
    if (!this.fns.size && !this.idle) return;
    callWS(this.hass, { type: 'zoomy/status', entry_id: this.id }, 15000).then(function (r) {
      var m = statusMarks(r), was = self.marks;
      self.marks = m;
      if (!was) return;
      if (m.started !== was.started) { self.epoch++; self._tell(['all']); return; }
      var moved = STATUS_NAMES.filter(function (k) { return m[k] !== was[k]; });
      if (moved.length) self._tell(moved);
      if (!self.live && !self.busy) self._subscribe(true);
    }, function () { /* the next look tries again */ }).then(function () {
      if (self.fns.size || self.idle) self._schedulePoll();
    });
  }
}

export function watchCar(entryId, hass, fn) {
  var w = watches.get(entryId);
  if (!w) { w = new Watch(entryId, hass); watches.set(entryId, w); }
  if (hass) w.hass = hass;
  return { off: w.add(fn), watch: w };
}

export function carSig(entryId, names) {
  var w = watches.get(entryId);
  return w ? w.sig(names) : (names || STATUS_NAMES).map(function () { return 0; }).join('.') + ':0';
}

// ---------------------------------------------------------------------------------------------------------------
// Dates, written by hand (not by the browser's locale tables, which say "Sept" and "June" in some browsers), so
// they read the same everywhere: Wed, 14 Oct
// ---------------------------------------------------------------------------------------------------------------

export const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function day(d, year) { return DOW[d.getDay()] + ', ' + d.getDate() + ' ' + MON[d.getMonth()] + (year ? ' ' + d.getFullYear() : ''); }
export function hm(d) { return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }

/* "Car last sent Wed, 14 Oct 07:45 · Zoomy 4.18.20" from the car's Last update and App version sensors. */
export function lastSentText(hass, car) {
  var ids = car && car.entities ? car.entities : {}, st = hass && hass.states ? hass.states : {};
  var u = ids.last_update ? st[ids.last_update] : null, v = ids.app_version ? st[ids.app_version] : null;
  var at = u && typeof u.state === 'string' && /^\d{4}-\d\d-\d\d/.test(u.state) ? new Date(u.state) : null;
  if (at && isNaN(at.getTime())) at = null;
  var ver = v && typeof v.state === 'string' && v.state && v.state !== 'unknown' && v.state !== 'unavailable' ? v.state.replace(/\s+/g, ' ').trim().slice(0, 40) : '';
  if (!at) return 'No upload from the car yet';
  return 'Car last sent ' + day(at, at.getFullYear() !== new Date().getFullYear()) + ' ' + hm(at) + (ver ? ' · Zoomy ' + ver : '');
}

// ---------------------------------------------------------------------------------------------------------------
// ZoomyCard: the base of every Zoomy card
// ---------------------------------------------------------------------------------------------------------------

/* A subclass gives:
     static css         its own CSS (after HS_CSS)
     makePage(io)       builds its page inside io.box and returns { destroy, changed(names), hass(h), shown(), resized() }
                        (every part optional but destroy)
   The page reaches Home Assistant only through io (see _io). */
export class ZoomyCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = {};
    this._hass = null;
    this._built = false;
    this._cars = null;
    this._car = null;
    this._page = null;
    this._io = null;
    this._watch = null;
    this._carsFail = 0;
    this._entities = null;
    this._carsTimer = null;
    var self = this;
    this._onPicked = function () { if (!self._config.entry_id) self._pick(); };
    this._onResize = function () { self._size(); };
  }

  static getStubConfig() { return {}; }

  setConfig(config) {
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Zoomy: the card needs its settings.');
    var id = config.entry_id;
    if (id !== undefined && id !== null && (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id))) {
      throw new Error('Zoomy: entry_id must be the id of a Zoomy car (leave it out to show a car picker).');
    }
    var was = this._config.entry_id || null;
    this._config = Object.assign({}, config);
    if (this._built && was !== (this._config.entry_id || null)) this._pick();
    else if (this._page && this._page.configChanged) { try { this._page.configChanged(); } catch (e) { /* the next look */ } }
  }

  set hass(h) {
    this._hass = h;
    if (!h) return;
    if (this._watch) this._watch.hass = h;
    if (!this._built) { if (this.isConnected) this._build(); return; }
    if (this._entities !== null && h.entities !== this._entities) {
      // the entity registry changed (a car added, removed or renamed): ask for the cars again, once it settles
      this._entities = h.entities;
      var self = this;
      clearTimeout(this._carsTimer);
      this._carsTimer = setTimeout(function () { self._loadCars(true); }, 2000);
    }
    if (this._page && this._page.hass) { try { this._page.hass(h); } catch (e) { /* the page's next look tries again */ } }
  }
  get hass() { return this._hass; }

  connectedCallback() {
    window.addEventListener('zoomy-car-picked', this._onPicked);
    window.addEventListener('resize', this._onResize);
    if (!this._built) { if (this._hass) this._build(); return; }
    // another tab may have picked a different car while this one was not on screen
    if (this._cars && !this._config.entry_id && this._car && this._car.entry_id !== (carFor(this._cars, null) || {}).entry_id) this._pick();
    if (this._io) this._io._wake();
    if (this._car && !this._watch) this._watchCar();
    this._size();
    if (this._page && this._page.shown) { try { this._page.shown(); } catch (e) { /* cosmetic */ } }
  }

  disconnectedCallback() {
    window.removeEventListener('zoomy-car-picked', this._onPicked);
    window.removeEventListener('resize', this._onResize);
    if (this._watch) { this._watch.off(); this._watch = null; }
  }

  getCardSize() { return 12; }
  getGridOptions() { return { columns: 'full', rows: 'auto', min_columns: 12 }; }

  _build() {
    this._built = true;
    this._entities = this._hass ? this._hass.entities : null;
    var css = this.constructor.css || '';
    this.shadowRoot.innerHTML = '<style>' + HS_CSS + css + '</style><div class="wrap" id="zwrap"><div class="zsay">Loading Zoomy…</div></div>';
    this._wrap = this.shadowRoot.getElementById('zwrap');
    var self = this;
    try { if (window.ResizeObserver) { this._ro = new window.ResizeObserver(function () { self._size(); }); this._ro.observe(this._wrap); } } catch (e) { /* resize events are enough */ }
    this._size();
    this._loadCars(false);
  }

  _loadCars(force) {
    var self = this;
    getCars(this._hass, force).then(function (cars) {
      self._carsFail = 0;
      self._cars = cars;
      self._pick();
    }, function (e) {
      self._carsFail++;
      if (!self._page) {
        self._say('Could not read the Zoomy cars from Home Assistant (' + (e && e.message ? e.message : 'no answer') + '). It will be tried again shortly.');
      }
      clearTimeout(self._carsTimer);
      self._carsTimer = setTimeout(function () { self._loadCars(true); }, Math.min(60000, 5000 * self._carsFail));
    });
  }

  _say(text, title) {
    this._end();
    this._wrap.innerHTML = '<div class="zsay">' + (title ? '<h1>ZOOMY <em>— ' + esc(title) + '</em></h1>' : '') + '<p>' + esc(text) + '</p></div>';
  }

  /* The car to show has (maybe) changed: start the page again for it. */
  _pick() {
    if (!this._built || !this._cars) return;
    var fixed = this._config.entry_id || null, car = carFor(this._cars, fixed);
    if (!car) {
      this._car = null;
      if (fixed) this._say('The Zoomy car this card was set up for is not in Home Assistant any more. Edit the card, or remove its entry_id to show a car picker.', this.constructor.pageTitle);
      else this._say('No Zoomy car yet. Add one: Settings > Devices & services > Add integration > Zoomy. The car sends its trips and charges when it is home on the Wi-Fi.', this.constructor.pageTitle);
      return;
    }
    var same = this._car && this._car.entry_id === car.entry_id && this._page;
    this._car = car;
    if (same) { this._picker(); if (this._page.carChanged) this._page.carChanged(car); return; }
    this._end();
    this._wrap.innerHTML = '';
    this._io = this._makeIo(car);
    this._watchCar();                  // before the page: its first look already sees the car's change counters
    try { this._page = this.makePage(this._io) || null; }
    catch (e) {
      this._page = null;
      this._say('Could not show this page: ' + (e && e.message ? e.message : e), this.constructor.pageTitle);
      return;
    }
    this._picker();
    this._size();
  }

  _watchCar() {
    var self = this, car = this._car;
    if (!car || !this.isConnected) return;
    if (this._watch) this._watch.off();
    var w = watchCar(car.entry_id, this._hass, function (names) {
      // the car object is replaced when the list of cars is read again: the same car is the same entry id
      if (self._page && self._page.changed && self._car && self._car.entry_id === car.entry_id) {
        try { self._page.changed(names); } catch (e) { /* the next look tries again */ }
      }
    });
    this._watch = { off: w.off, watch: w.watch, set hass(h) { w.watch.hass = h; } };
  }

  _end() {
    if (this._page && this._page.destroy) { try { this._page.destroy(); } catch (e) { /* gone anyway */ } }
    this._page = null;
    if (this._io) this._io._kill();
    this._io = null;
    if (this._watch) { this._watch.off(); this._watch = null; }
  }

  /* The car picker, in the page's slot for it (an element with class "zcars"), when there are two or more cars and
     the card is not set to one car. */
  _picker() {
    var slot = this.shadowRoot.querySelector('.zcars');
    if (!slot) return;
    var cars = this._cars || [], show = !this._config.entry_id && cars.length > 1, cur = this._car ? this._car.entry_id : null;
    slot.hidden = !show;
    if (!show) { slot.innerHTML = ''; return; }
    var html = '<span class="lbl">Car</span><span class="tabs" role="group" aria-label="Pick a car">' + cars.map(function (c) {
      return '<button type="button" data-car="' + esc(c.entry_id) + '" aria-pressed="' + (c.entry_id === cur ? 'true' : 'false') + '">' + esc(c.title) + '</button>';
    }).join('') + '</span>';
    if (slot.__html !== html) {
      slot.innerHTML = html; slot.__html = html;
      if (!slot.__wired) {
        slot.__wired = true;
        slot.addEventListener('click', function (ev) {
          var b = ev.target && ev.target.closest ? ev.target.closest('button[data-car]') : null;
          if (b) pickCar(b.getAttribute('data-car'));
        });
      }
    }
  }

  /* The room under Home Assistant's bar, for the pages that are one screen high. */
  _size() {
    if (!this._wrap) return;
    var h = 0;
    try {
      var r = this.getBoundingClientRect(), top = Math.max(0, r.top + (window.scrollY || 0));
      h = Math.round((window.innerHeight || 800) - Math.min(top, 160));
    } catch (e) { h = 0; }
    if (h > 0) { this._room = Math.max(420, h); this._wrap.style.setProperty('--zoomy-h', this._room + 'px'); }
    if (this._page && this._page.resized) { try { this._page.resized(); } catch (e) { /* the next look tries again */ } }
  }

  /* What a page may use. Timers made here stop when the page goes, and the repeating ones skip their turn while
     the card is not on screen (another tab of the dashboard is open); they run once as soon as it is back. */
  _makeIo(car) {
    var self = this, timers = new Set(), every = [], dead = false;
    var io = {
      // the car as last listed (its title and entity ids follow renames)
      get car() { return self._car && self._car.entry_id === car.entry_id ? self._car : car; },
      box: this._wrap,
      root: this.shadowRoot,
      get config() { return self._config; },
      hass: function () { return self._hass; },
      sign: function () { return moneySign(self._hass); },
      ask: function (type, extra, wait) {
        var msg = Object.assign({ type: 'zoomy/' + type, entry_id: car.entry_id }, extra || {});
        return callWS(self._hass, msg, wait);
      },
      sig: function (names) { return carSig(car.entry_id, names); },
      sent: function () { return lastSentText(self._hass, io.car); },
      title: function () { return io.car.title; },
      onScreen: function () { return self.isConnected; },
      // the height of the room under Home Assistant's bar (what the window was for the iframe pages)
      room: function () { return self._room || Math.max(420, (window.innerHeight || 720) - 56); },
      narrow: function (px) { var w = self._wrap ? self._wrap.clientWidth : 0; return w > 0 ? w <= (px || 760) : (window.innerWidth || 1000) <= (px || 760); },
      later: function (fn, ms) {
        if (dead) return null;
        var t = setTimeout(function () { timers.delete(t); if (!dead) fn(); }, ms);
        timers.add(t);
        return t;
      },
      clear: function (t) { if (t !== null && t !== undefined) { clearTimeout(t); timers.delete(t); } },
      every: function (fn, ms) {
        if (dead) return;
        var job = { fn: fn, missed: false };
        every.push(job);
        var t = setInterval(function () {
          if (dead) return;
          if (!self.isConnected) { job.missed = true; return; }
          fn();
        }, ms);
        timers.add(t);
      },
      moreInfo: function (entityId) {
        if (!entityId) return;
        self.dispatchEvent(new CustomEvent('hass-more-info', { detail: { entityId: entityId }, bubbles: true, composed: true }));
      },
      navigate: function (path) {
        try {
          window.history.pushState(null, '', path);
          window.dispatchEvent(new CustomEvent('location-changed', { detail: { replace: false } }));
        } catch (e) { /* stays here */ }
      },
      _wake: function () {
        every.forEach(function (j) { if (j.missed) { j.missed = false; try { j.fn(); } catch (e) { /* the next turn */ } } });
      },
      _kill: function () {
        dead = true;
        timers.forEach(function (t) { clearTimeout(t); clearInterval(t); });
        timers.clear(); every = [];
      }
    };
    return io;
  }
}

export function registerCard(tag, cls, name, description) {
  if (!customElements.get(tag)) customElements.define(tag, cls);
  window.customCards = window.customCards || [];
  if (!window.customCards.some(function (c) { return c && c.type === tag; })) {
    window.customCards.push({ type: tag, name: name, description: description, preview: false });
  }
}

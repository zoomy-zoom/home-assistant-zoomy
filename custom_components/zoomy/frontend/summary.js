/* Zoomy summary (zoomy-summary-card): the car's last trip, last charge, this month, last month and battery, as HOME
   tiles. Made from the Summary tab of the first ZOOMY dashboard (four sections of tiles: last trip, last charge,
   this month, last month, and a link to the trip on the map), drawn in the HOME look like the other Zoomy pages so
   the whole dashboard looks the same in any theme.

   Every number is a sensor of this integration (the entity ids come from zoomy/cars, so renamed entities still
   work) and is written by Home Assistant's own formatter, in the units and precision the sensor has; a tap on a
   tile opens the sensor's own dialog (history, settings). Nothing is read but the sensors' states. */

import { ZoomyCard, registerCard, esc, lastSentText } from './core.js';

const CSS = `
  .wrap { min-width: 300px; }
  .page { box-sizing: border-box; max-width: 1500px; margin: 0 auto; padding: 26px 16px 50px; }
  .head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-start; gap: 14px 20px; margin: 0 0 18px; }
  .head .title { flex: 1 1 auto; min-width: 0; }
  .head .hs-chips { min-width: 0; max-width: 100%; }
  .head .hs-chip { white-space: normal; overflow-wrap: anywhere; }
  button.hs-chip { font: inherit; font-size: 12px; cursor: pointer; }
  .hs-chip.is-car { border-color: #a44f8399; background: #15182999; color: #ffbde2; }
  .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; align-items: start; }
  .card { position: relative; min-width: 0; box-sizing: border-box; padding: 20px 22px; border: 1px solid var(--hs-card-border);
          border-radius: var(--hs-radius); background: var(--hs-card-bg); box-shadow: var(--hs-card-shadow); }
  .card.hs-accent-car, .card.hs-accent-teal, .card.hs-accent-gold, .card.hs-accent-solar { border-color: var(--hs-accent-border);
          background: radial-gradient(ellipse at 10% 0%, var(--hs-accent-wash), transparent 75%), var(--hs-accent-base);
          box-shadow: inset 0 0 22px var(--hs-accent-halo), 0 0 20px var(--hs-accent-halo); }
  .ch { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 8px 12px; margin-bottom: 14px; padding-bottom: 12px;
        border-bottom: 1px solid var(--hs-rule); }
  .ch h2 { margin: 0; color: #d3e3ef; font-size: 13px; font-weight: 650; letter-spacing: 1px; line-height: 1.5; text-transform: uppercase; }
  .ch .when { color: var(--hs-muted); font-size: 12px; font-variant-numeric: tabular-nums; }
  .ch .go { min-height: 30px; padding: 5px 11px; border: 1px solid #326b88; border-radius: 6px; background: #12364b; color: var(--hs-text);
            font: inherit; font-size: 12px; cursor: pointer; transition: background .2s, transform .2s; }
  .ch .go:hover { background: #1c4a63; transform: translateY(-1px); }
  .ch .right { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; }
  .tiles { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .tile { display: flex; flex-direction: column; justify-content: flex-start; align-items: stretch; min-width: 0; box-sizing: border-box; margin: 0;
          padding: 12px 14px; border: 1px solid #34526366; border-radius: 10px; background: #132e3c55;
          color: inherit; font: inherit; text-align: left; cursor: pointer; transition: border-color .2s; }
  .tile:hover { border-color: #4b88a5; }
  .tile.wide { grid-column: 1 / -1; }
  .tile .k { margin: 0 0 4px; color: #c4d7e5; font-size: 11px; font-weight: 600; letter-spacing: 1.1px; line-height: 1.4; text-transform: uppercase; }
  .tile .n { color: var(--hs-accent, #64d6fa); font-size: 26px; font-weight: 740; letter-spacing: -.8px; line-height: 1.2;
             font-variant-numeric: tabular-nums; overflow-wrap: anywhere; text-shadow: 0 0 24px var(--hs-accent-glow, transparent); }
  .tile .n small { font-size: .55em; font-weight: 550; letter-spacing: 0; opacity: .85; }
  .tile[disabled] { cursor: default; }
  .tile .n.text { font-size: 18px; letter-spacing: -.2px; }
  .tile .n.none { color: var(--hs-dim); text-shadow: none; }
  .tile .d { margin-top: 2px; color: var(--hs-muted); font-size: 12px; line-height: 1.45; overflow-wrap: anywhere; }
  .tile:focus-visible, .ch .go:focus-visible, button.hs-chip:focus-visible { outline: 3px solid var(--hs-gold); outline-offset: 3px; }
  .note { margin: 0 0 16px; padding: 10px 14px; border: 1px solid #dba44555; border-radius: 10px; background: #dba44512; color: var(--hs-gold); font-size: 13px; }
  @container zoomy (max-width: 900px) { .grid { grid-template-columns: minmax(0, 1fr); } }
  @container zoomy (max-width: 800px) {
    .page { padding-top: 16px; padding-bottom: 40px; }
    .card { padding: 16px 18px; }
    .tile .n { font-size: 22px; }
  }
  @container zoomy (max-width: 360px) { .tiles { grid-template-columns: minmax(0, 1fr); } }
  @media (pointer: coarse) { .ch .go { min-height: 42px; padding: 10px 14px; font-size: 13px; } }
  @media (prefers-reduced-motion: reduce) { .tile, .ch .go { transition: none !important; } }
`;

var DASH = '–', TO = ' → ';
var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function known(so) { return !!so && typeof so.state === 'string' && so.state !== 'unknown' && so.state !== 'unavailable' && so.state !== ''; }
function numOf(so) { if (!known(so)) return null; var v = Number(so.state); return isFinite(v) ? v : null; }
function fx(v, d) { if (v === null) return DASH; var s = v.toFixed(d); return Number(s) === 0 ? (0).toFixed(d) : s; }
function dur(m) {
  if (m === null) return DASH;
  m = Math.max(0, Math.round(m));
  return m >= 60 ? Math.floor(m / 60) + ' h ' + (m % 60) + ' min' : m + ' min';
}
function stamp(so) {
  if (!known(so)) return '';
  var d = new Date(so.state);
  if (isNaN(d.getTime())) return '';
  return DOW[d.getDay()] + ', ' + d.getDate() + ' ' + MON[d.getMonth()] + (d.getFullYear() !== new Date().getFullYear() ? ' ' + d.getFullYear() : '') +
         ' ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
}
function monthName(so) {
  var m = so && so.attributes ? so.attributes.month : null;
  if (typeof m !== 'string' || !/^\d{4}-\d\d$/.test(m)) return '';
  var i = Number(m.slice(5)) - 1;
  return i >= 0 && i < 12 ? MON[i] + ' ' + m.slice(0, 4) : '';
}

/* A sensor's value as Home Assistant writes it (its units, precision, number and currency format), as parts in
   order: {type: value | literal | unit, value}. Money comes as [unit "$", value "4.80"], the rest as [value, " ", unit]. */
function parts(hass, so) {
  if (!known(so)) return null;
  try {
    if (typeof hass.formatEntityStateToParts === 'function') {
      var p = hass.formatEntityStateToParts(so);
      if (Array.isArray(p) && p.length) return p.map(function (x) { return { type: x.type, value: String(x.value) }; });
    }
    if (typeof hass.formatEntityState === 'function') return [{ type: 'value', value: String(hass.formatEntityState(so)) }];
  } catch (e) { /* the plain state below */ }
  var unit = so.attributes && so.attributes.unit_of_measurement ? so.attributes.unit_of_measurement : '';
  return unit ? [{ type: 'value', value: so.state }, { type: 'literal', value: ' ' }, { type: 'unit', value: unit }] : [{ type: 'value', value: so.state }];
}
function plain(p) { return p ? p.map(function (x) { return x.value; }).join('').trim() : ''; }
// the parts as the big number: the units smaller
function bigHtml(p) {
  return p.map(function (x) { return x.type === 'unit' ? '<small>' + esc(x.value) + '</small>' : esc(x.value); }).join('');
}

function makeSummaryPage(io, card) {
  'use strict';
  var dead = false, last = null;
  io.box.innerHTML = '<div class="page"><div class="zcars" hidden></div><div id="body"></div></div>';
  var body = io.root.getElementById('body');
  var ids = function () { return (io.car && io.car.entities) || {}; };

  function st(key) { var h = io.hass(), id = ids()[key]; return id && h && h.states ? h.states[id] || null : null; }

  // one tile: a label, a value, a small line; tap = the sensor's own dialog
  function tile(label, key, opt) {
    opt = opt || {};
    var h = io.hass(), so = st(key), id = ids()[key] || '', value, cls = 'n';
    if (opt.value !== undefined) value = opt.value === null ? null : esc(opt.value);
    else {
      var p = parts(h, so);
      if (p === null) value = null;
      else if (opt.text) { value = esc(plain(p)); cls += ' text'; }
      else value = bigHtml(p);
    }
    if (value === null) { value = DASH; cls += ' none'; }
    else if (opt.text && cls.indexOf('text') < 0) cls += ' text';
    return '<button type="button" class="tile' + (opt.wide ? ' wide' : '') + '"' + (id ? ' data-e="' + esc(id) + '"' : ' disabled') +
           ' aria-label="' + esc(label) + '"><p class="k">' + esc(label) + '</p><div class="' + cls + '">' + value + '</div>' +
           (opt.detail ? '<div class="d">' + esc(opt.detail) + '</div>' : '') + '</button>';
  }
  function fromTo(a, b) {
    var x = numOf(st(a)), y = numOf(st(b));
    return x === null && y === null ? null : fx(x, 0) + '%' + TO + fx(y, 0) + '%';
  }
  function minutes(key) {
    var so = st(key), u = so && so.attributes ? so.attributes.unit_of_measurement : null;
    if (!known(so)) return null;
    if (u && u !== 'min') return plain(parts(io.hass(), so)) || null;
    return dur(numOf(so));
  }
  function section(title, accent, right, tiles) {
    return '<section class="card ' + accent + '"><div class="ch"><h2>' + esc(title) + '</h2><div class="right">' + right + '</div></div>' +
           '<div class="tiles">' + tiles.join('') + '</div></section>';
  }
  function monthCard(title, p) {
    var label = monthName(st(p + '_distance')), unpriced = numOf(st(p + '_charges_without_price'));
    return section(title, 'hs-accent-teal', label ? '<span class="when">' + esc(label) + '</span>' : '', [
      tile('Distance', p + '_distance'),
      tile('Charging cost', p + '_cost', { detail: unpriced ? unpriced + (unpriced === 1 ? ' charge' : ' charges') + ' without a price' : '' }),
      tile('Average consumption', p + '_consumption', { wide: true }),
      tile('Trips', p + '_trips'),
      tile('Charges', p + '_charges'),
      tile('Home charging', p + '_energy_home'),
      tile('Public charging', p + '_energy_public')
    ]);
  }

  function render() {
    var h = io.hass();
    if (!h || dead) return;
    var title = io.title(), mapView = typeof io.config.map_view === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(io.config.map_view) ? io.config.map_view : '';
    var tripAt = stamp(st('last_trip_start')), chargeAt = stamp(st('last_charge_start')), sent = lastSentText(h, io.car);
    var battery = parts(h, st('battery'));
    var html = '<div class="head"><div class="title"><p class="hs-kicker">' + esc('Zoomy · ' + title) + '</p>' +
      '<h1 class="hs-title">ZOOMY <em>&mdash; Summary</em></h1>' +
      '<p class="hs-sub">' + esc(title + ': last trip, last charge, this month and last month') + '</p></div>' +
      '<div class="hs-chips">' +
        (battery ? '<button type="button" class="hs-chip is-status is-car" data-e="' + esc(ids().battery || '') + '">Battery ' + esc(plain(battery)) + '</button>' : '') +
        '<button type="button" class="hs-chip is-status" data-e="' + esc(ids().last_update || '') + '">' + esc(sent) + '</button>' +
      '</div></div>';
    if (!known(st('last_update'))) {
      html += '<p class="note">' + esc('Nothing from the car yet. The Zoomy app sends its trips and charges when the car is home on the Wi-Fi.') + '</p>';
    }
    html += '<div class="grid">' +
      section('Last trip', 'hs-accent-car', (tripAt ? '<span class="when">' + esc(tripAt) + '</span>' : '') +
              (mapView ? '<button type="button" class="go" data-go="' + esc(mapView) + '">Show on the map</button>' : ''), [
        tile('Distance', 'last_trip_distance'),
        tile('Net energy', 'last_trip_energy'),
        tile('Consumption', 'last_trip_consumption', { wide: true }),
        tile('Regen', 'last_trip_regen'),
        tile('Battery', 'last_trip_battery_end', { value: fromTo('last_trip_battery_start', 'last_trip_battery_end') }),
        tile('Duration', 'last_trip_duration', { value: minutes('last_trip_duration') }),
        tile('Outside', 'last_trip_outside_temperature')
      ]) +
      section('Last charge', 'hs-accent-car', chargeAt ? '<span class="when">' + esc(chargeAt) + '</span>' : '', [
        tile('Energy added', 'last_charge_energy'),
        tile('Cost', 'last_charge_cost'),
        tile('Price', 'last_charge_price'),
        tile('Off-peak', 'last_charge_off_peak'),
        tile('Battery', 'last_charge_battery_end', { value: fromTo('last_charge_battery_start', 'last_charge_battery_end') }),
        tile('Duration', 'last_charge_duration', { value: minutes('last_charge_duration') }),
        tile('Charger', 'last_charge_charger', { text: true }),
        tile('Power', 'last_charge_average_power', { detail: 'average' })
      ]) +
      monthCard('This month', 'this_month') +
      monthCard('Last month', 'last_month') +
      section('Battery', 'hs-accent-solar', '', [
        tile('Last known level', 'battery', { wide: true, detail: 'from the car\'s last trip or charge' }),
        tile('Health', 'battery_health'),
        tile('Usable energy', 'battery_usable_energy')
      ]) +
    '</div>';
    if (html !== last) {
      var act = io.root.activeElement, keep = act && act.getAttribute ? (act.getAttribute('data-e') || act.getAttribute('data-go')) : null;
      body.innerHTML = html; last = html;
      if (keep) {
        Array.prototype.forEach.call(body.querySelectorAll('button'), function (b) {
          if (b.getAttribute('data-e') === keep || b.getAttribute('data-go') === keep) { try { b.focus({ preventScroll: true }); } catch (e) { /* cosmetic */ } }
        });
      }
    }
  }

  function onClick(ev) {
    var b = ev.target && ev.target.closest ? ev.target.closest('button') : null;
    if (!b) return;
    var go = b.getAttribute('data-go'), e = b.getAttribute('data-e');
    if (go) {
      var dash = (window.location.pathname.split('/')[1] || '');
      if (dash) io.navigate('/' + dash + '/' + go);
      return;
    }
    if (e) io.moreInfo(e);
  }
  body.addEventListener('click', onClick);

  // the states this page shows: drawn again only when one of them has changed
  var seen = null;
  function maybe() {
    var h = io.hass();
    if (!h || !h.states) return;
    var map = ids(), now = Object.keys(map).map(function (k) { return h.states[map[k]]; });
    now.push(h.config ? h.config.currency : '');
    if (seen && seen.length === now.length && seen.every(function (x, i) { return x === now[i]; })) return;
    seen = now;
    render();
  }
  render();
  io.every(function () { seen = null; maybe(); }, 60000);   // the dates ("this year or not") move on

  return {
    hass: function () { maybe(); },
    changed: function () { /* the sensors bring the news */ },
    carChanged: function () { seen = null; maybe(); },
    configChanged: function () { last = null; render(); },
    destroy: function () { dead = true; body.removeEventListener('click', onClick); }
  };
}

class ZoomySummaryCard extends ZoomyCard {
  static get css() { return CSS; }
  static get pageTitle() { return 'Summary'; }
  makePage(io) { return makeSummaryPage(io, this); }
}

registerCard('zoomy-summary-card', ZoomySummaryCard, 'Zoomy summary',
  'The last trip, the last charge, this month and last month of a Zoomy car.');

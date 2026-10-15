/* Zoomy performance (zoomy-performance-card): the car's power as measured on the road by the Zoomy app. A chart of
   power against speed (the best ever seen at each speed, the best regen braking, and the chosen pull drawn over
   them), the list of pulls, the app's timed acceleration runs and its battery health figure.

   Ported from the HOME-styled dyno.html ("ZOOMY - Performance", 15 Oct 2026; an iframe page). The look, the words,
   the numbers and the maths are as there. What changed: it is a card (shadow DOM, no iframe); the pulls come from
   zoomy/dyno and the timed runs and battery health from the car's latest snapshot (zoomy/snapshot), both for the car
   it shows; they are read again when the car's subscription says the dyno or the snapshot changed (no sensor is
   watched); the car's name replaces the fixed car name; the screen-size rules follow the card's width and the room
   under Home Assistant's bar, as they followed the iframe's.
   It loads nothing from anywhere, stores nothing and logs nothing. */

import { ZoomyCard, registerCard } from './core.js';

const CSS = `
  /* The page's own look, in HOME's colours (dark only, like HOME). Kept as the script counts on them: the 12 px gap
     between the blocks of the page (GAP) and the 760 px width under which the list goes below the chart (NARROW).
     The widths are as on the iframe page (the page's side padding 16 px and its 1800 px width, the chart card's side
     padding 14 px). The chart's height is fitted to the room under Home Assistant's bar (measure). */
  :host { --fg: #f0f7ff; --muted: #9db6c9; --grid: #22353f; --card: #0c2232; --page: #050e17; --blue: #51c9ff; --green: #65e7ae; --amber: #ffc267; }
  .wrap { min-width: 300px; overflow-x: hidden; color: var(--fg); }
  .page { display: flex; flex-direction: column; gap: 12px; box-sizing: border-box; max-width: 1800px; margin: 0 auto; padding: 26px 16px 30px; }
  .page > .zcars { margin: 0; }

  /* the heading: kicker, title and subtitle on the left, the car's last upload as a chip on the right, the totals under them */
  .head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-start; gap: 14px 20px; margin: 0 0 6px; }
  .head .title { order: 1; flex: 1 1 auto; min-width: 0; }
  .head .hs-chips { order: 2; min-width: 0; max-width: 100%; }
  .head .hs-chip { white-space: normal; overflow-wrap: anywhere; }
  .head .hs-chip:empty { display: none; }
  .head .facts { order: 3; flex: 1 1 100%; min-width: 0; margin: 0; padding: 14px 18px; border: 1px solid var(--hs-accent-border);
                 border-radius: var(--hs-radius); background: radial-gradient(ellipse at 10% 0%, var(--hs-accent-wash), transparent 75%), var(--hs-accent-base);
                 box-shadow: inset 0 0 22px var(--hs-accent-halo), 0 0 20px var(--hs-accent-halo);
                 color: var(--hs-text); font-size: 15px; font-weight: 650; line-height: 1.45; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
  .head .facts:empty { display: none; }
  h2 { margin: 0 0 8px; padding-bottom: 10px; border-bottom: 1px solid var(--hs-rule); color: #d3e3ef;
       font-size: 13px; font-weight: 650; letter-spacing: 1px; line-height: 1.5; text-transform: uppercase; }
  /* a warning as HOME's gold note */
  .warn { padding: 8px 12px; border: 1px solid #dba44555; border-radius: 10px; background: #dba44512; color: var(--hs-gold);
          font-size: 13px; overflow-wrap: anywhere; }
  .sub { margin: 0 0 8px; color: var(--hs-muted); font-size: 12px; line-height: 1.5; }
  .note { padding: 28px 8px; color: var(--hs-muted); overflow-wrap: anywhere; }
  /* the chart, the timed runs and the battery health as HOME's glass cards; the battery health as a HOME tile (car colour) */
  .chart, .tablecard { position: relative; min-width: 0; box-sizing: border-box; padding: 20px 22px; border: 1px solid var(--hs-card-border);
                       border-radius: var(--hs-radius); background: var(--hs-card-bg); box-shadow: var(--hs-card-shadow); }
  /* the chart card keeps its side padding of 14 px (the chart's width); its words sit 22 px in, as on HOME */
  .chart { padding: 18px 14px; }
  .chart > h2, .chart > .sub, .chart > .readout, .chart > .legend { margin-left: 8px; margin-right: 8px; }
  .tablecard.hs-accent-car { border-color: var(--hs-accent-border);
                             background: radial-gradient(ellipse at 10% 0%, var(--hs-accent-wash), transparent 75%), var(--hs-accent-base);
                             box-shadow: inset 0 0 22px var(--hs-accent-halo), 0 0 20px var(--hs-accent-halo); }

  /* the chart on the left, the pulls down the right */
  .body { display: flex; gap: 12px; min-width: 0; }
  .chart { flex: 1 1 0; align-self: flex-start; }
  .holder { position: relative; }
  svg { width: 100%; height: auto; display: block; }
  svg text { fill: var(--hs-dim); font-size: 11px; }
  svg text.v { fill: var(--fg); }
  .hair { position: absolute; width: 0; border-left: 1px solid var(--muted); pointer-events: none; }
  .mark { position: absolute; width: 14px; height: 14px; margin: -7px 0 0 -7px; box-sizing: border-box; border: 2px solid var(--fg);
          border-radius: 50%; pointer-events: none; box-shadow: 0 0 8px #0009; }
  .readout { display: flex; flex-wrap: wrap; gap: 2px 14px; align-items: baseline; min-height: 36px; margin-top: 8px; font-size: 12px;
             color: var(--hs-muted); font-variant-numeric: tabular-nums; }
  .readout strong { color: var(--hs-text); font-size: 14px; font-weight: 700; }
  .readout span { color: var(--fg); }
  .legend { display: flex; gap: 4px 16px; flex-wrap: wrap; color: var(--hs-muted); font-size: 12px; margin-top: 4px; }
  .sw { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 6px; }
  .key { display: inline-block; width: 14px; height: 0; border-top: 3px solid var(--fg); margin-right: 6px; vertical-align: middle; }
  .key.dash { border-top-style: dashed; }

  .side { flex: none; width: 300px; min-height: 280px; display: flex; flex-direction: column; gap: 8px; }
  /* the drive modes as HOME tabs; Compare as a HOME button (green when on) */
  .filters { display: flex; flex-wrap: wrap; gap: 4px; flex: none; align-self: flex-start; box-sizing: border-box; max-width: 100%; padding: 3px;
             border: 1px solid #2c4b5e; border-radius: 12px; background: #0b2030cc; }
  .bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex: none; min-height: 34px; }
  .count { color: var(--hs-muted); font-size: 12px; padding: 0 2px; }
  .pill { min-height: 34px; padding: 7px 13px; border: 1px solid #326b88; border-radius: 6px; background: #12364b; color: var(--hs-text);
          font: inherit; font-size: 12px; cursor: pointer; overflow-wrap: anywhere; transition: background .2s, transform .2s; }
  .pill:hover { background: #1c4a63; transform: translateY(-1px); }
  .pill[aria-pressed="true"] { border-color: #348968; background: #16413688; color: #60eab0; }
  .filters .pill { padding: 7px 12px; border-color: transparent; border-radius: 9px; background: none; color: var(--hs-muted);
                   transition: background .2s, color .2s; }
  .filters .pill:hover { background: #ffffff08; color: #fff; transform: none; }
  .filters .pill[aria-pressed="true"] { border-color: #2e728c; background: #143849; color: var(--hs-teal);
                                        box-shadow: 0 0 22px #28b2ed18, inset 0 1px #6ad4ff23; }
  .pill:focus-visible { outline: 3px solid var(--hs-gold); outline-offset: 3px; }
  /* the list scrolls by itself: it fills the height the chart gives the row and adds none of its own.
     A pull is a HOME row; the one on the chart is lit in its line colour, the compared one has a dashed edge. */
  .listbox { position: relative; flex: 1 1 0; min-height: 160px; }
  .list { position: absolute; top: 0; right: 0; bottom: 0; left: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 6px;
          padding: 1px 4px 1px 1px; scrollbar-width: thin; scrollbar-color: var(--hs-line) transparent; }
  .list button { flex: none; display: flex; flex-direction: column; gap: 3px; width: 100%; box-sizing: border-box; text-align: left;
                 font: inherit; font-size: 13px; color: var(--hs-text); background: #132e3c55; border: 1px solid #34526366;
                 border-radius: 10px; padding: 9px 12px; cursor: pointer; overflow-wrap: anywhere; transition: border-color .2s, background .2s; }
  .list button:hover { border-color: #4b88a5; }
  .list button:focus-visible { outline: 2px solid var(--hs-text); outline-offset: -2px; }
  .list button[aria-pressed="true"] { border-color: var(--amber); box-shadow: inset 0 0 0 1px var(--amber), 0 0 16px #dba44522;
                                      background: radial-gradient(ellipse at 10% 0%, #6b4f1455, transparent 75%), #17191f; }
  .list button[data-role="other"] { border-color: var(--fg); border-style: dashed; box-shadow: none; background: #ffffff0d; }
  .l1 { display: flex; justify-content: space-between; gap: 10px; font-weight: 650; font-variant-numeric: tabular-nums; }
  .l1 .kw { flex: none; }
  .l2 { color: var(--hs-muted); font-size: 12px; font-variant-numeric: tabular-nums; }
  .tag { display: inline-block; margin-left: 6px; padding: 0 7px; border: 1px solid #2f6f8a; border-radius: 20px; background: #12364b;
         color: #9fdcf7; font-size: 11px; font-weight: 600; line-height: 1.5; vertical-align: 1px; }

  /* under them: the timed runs, and the battery health below the list */
  .below { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 12px; align-items: start; }
  .scroll { overflow-x: auto; scrollbar-width: thin; scrollbar-color: var(--hs-line) transparent; }
  table { border-collapse: collapse; width: 100%; margin-top: 4px; font-size: 13px; font-variant-numeric: tabular-nums; }
  th, td { padding: 7px 10px; text-align: right; white-space: nowrap; border-bottom: 1px solid #31526755; overflow-wrap: normal; }
  th { border-bottom: 0; background: #0c2232; box-shadow: inset 0 -1px 0 var(--hs-rule); color: #c4d7e5; font-weight: 600; font-size: 12px; }
  th:first-child, td:first-child, th:nth-child(2), td:nth-child(2) { text-align: left; }
  tbody tr:hover td { background: #ffffff08; }
  td.day { font-weight: 600; }
  td.best { font-weight: 700; }
  td.best span, .sub .star { color: var(--green); }
  tr:last-child td { border-bottom: 0; }
  /* the battery health: HOME's tile label above a big number with a small unit */
  .stats { display: flex; flex-wrap: wrap; gap: 12px 28px; margin: 4px 0 12px; }
  .stats > div { display: flex; flex-direction: column-reverse; }
  .big { color: var(--hs-accent, #64d6fa); font-size: 34px; font-weight: 740; letter-spacing: -1.2px; line-height: 1.15;
         font-variant-numeric: tabular-nums; white-space: nowrap; text-shadow: 0 0 24px var(--hs-accent-glow, transparent); }
  .big small { font-size: .5em; font-weight: 550; letter-spacing: 0; opacity: .8; }
  .lbl { margin-bottom: 6px; color: #c4d7e5; font-size: 11px; font-weight: 600; letter-spacing: 1.1px; line-height: 1.4; text-transform: uppercase; }
  .tablecard th .sorter { background: none; border: 0; padding: 0; margin: 0; font: inherit; color: inherit; text-align: inherit; cursor: pointer; letter-spacing: inherit; text-transform: inherit; }
  .tablecard th .sorter[aria-pressed="true"] { color: var(--hs-text, #f0f7ff); font-weight: 700; }
  .tablecard th .sorter:focus-visible { outline: 2px solid var(--hs-teal, #45ceff); outline-offset: 2px; border-radius: 4px; }

  /* a wide card: the totals beside the title (more height left for the chart), the chip still at the top right */
  @container zoomy (min-width: 1151px) {
    .head .title { flex: 0 1 auto; }
    .head .facts { order: 2; flex: 1 1 360px; align-self: center; }
    .head .hs-chips { order: 3; }
  }
  /* HOME's screen sizes (top and bottom room only: the side room stays as before, see above) */
  @container zoomy (min-width: 1600px) { .page { padding-top: 28px; padding-bottom: 32px; } }
  @container zoomy (max-width: 1150px) { .page { padding-top: 22px; padding-bottom: 26px; } }
  @container zoomy (max-width: 800px) {
    .page { padding-top: 16px; padding-bottom: 22px; }
    .head .title { flex-basis: 100%; }
    .head .hs-chips { justify-content: flex-start; margin-top: 0; }
    .head .facts { padding: 12px 14px; font-size: 14px; }
    .tablecard { padding: 16px 18px; }
    .chart { padding: 16px 14px; }
    .chart > h2, .chart > .sub, .chart > .readout, .chart > .legend { margin-left: 4px; margin-right: 4px; }
    .pill { min-height: 42px; padding: 10px 14px; font-size: 13px; }
    .big { font-size: 30px; }
  }
  /* a phone: the list goes below the chart and the page scrolls */
  @container zoomy (max-width: 760px) {
    .body { flex-direction: column; }
    .chart { flex: none; align-self: stretch; }
    .side { width: auto; min-height: 0; }
    .listbox { position: static; flex: none; min-height: 0; }
    .list { position: static; overflow-y: visible; padding: 1px; }
    .below { grid-template-columns: minmax(0, 1fr); }
  }
  /* a short window (a laptop, under Home Assistant's own bars): HOME's smaller sizes, so the chart (fitted to the
     room) keeps more of the screen. The 12 px gap between the blocks stays (GAP). */
  @media (max-height: 816px) {
    @container zoomy (min-width: 761px) {
      .page { padding-top: 16px; padding-bottom: 16px; }
      .head { margin-bottom: 0; }
      .head .hs-kicker { margin-bottom: 6px; }
      .head .hs-title { font-size: 29px; }
      .head .hs-sub { margin-top: 4px; }
      .head .facts { padding: 10px 16px; font-size: 14px; }
      .chart { padding-top: 14px; padding-bottom: 14px; }
      h2 { margin-bottom: 6px; padding-bottom: 8px; }
      .sub { margin-bottom: 4px; }
    }
  }
  @container zoomy (max-width: 480px) { .big { font-size: 28px; } }
  @media (pointer: coarse) { .pill { min-height: 42px; padding: 10px 14px; font-size: 13px; } }
  @media (prefers-reduced-motion: reduce) { .pill, .list button { transition: none !important; } }
`;

function skeleton(car) {
  var e = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  return '<div class="page" id="root">' +
    '<div class="zcars" hidden></div>' +
    '<div class="head"><div class="title">' +
      '<p class="hs-kicker">' + e('Zoomy · ' + car) + '</p>' +
      '<h1 class="hs-title">ZOOMY <em>&mdash; Performance</em></h1>' +
      '<p class="hs-sub" id="hsub">' + e(car + ' power on the road, timed runs and battery health') + '</p>' +
    '</div>' +
    '<p class="facts hs-accent-car" id="facts"></p>' +
    '<div class="hs-chips"><span class="hs-chip is-status" id="sent"></span></div></div>' +
    '<div class="warn" id="warn" hidden></div>' +
    '<div class="note" id="gone" hidden></div>' +
    '<div class="body" id="body">' +
      '<div class="chart" id="card">' +
        '<h2>Power on the road</h2>' +
        '<div class="sub">Power in kW at each speed, measured by the app while driving. A pull is one hard acceleration. Above zero is driving, below zero is regen braking.</div>' +
        '<div class="holder" id="holder">' +
          '<div id="plot"><div class="note">Loading the pulls&hellip;</div></div>' +
          '<div class="hair" id="hair" hidden></div>' +
          '<div class="mark" id="m0" hidden></div><div class="mark" id="m1" hidden></div><div class="mark" id="m2" hidden></div><div class="mark" id="m3" hidden></div>' +
        '</div>' +
        '<div class="readout" id="readout"></div>' +
        '<div class="legend" id="legend"></div>' +
      '</div>' +
      '<div class="side" id="side" hidden>' +
        '<div class="filters" id="filters" role="group" aria-label="Show the pulls of one drive mode"></div>' +
        '<div class="bar"><span class="count" id="count"></span><button type="button" class="pill" id="cmp" aria-pressed="false" title="Show a second pull on the chart" hidden>Compare</button></div>' +
        '<div class="listbox"><div class="list" id="list" role="group" aria-label="Choose a pull"></div></div>' +
      '</div>' +
    '</div>' +
    '<div class="below" id="below" hidden>' +
      '<div class="tablecard" id="runs"></div>' +
      '<div class="tablecard hs-accent-car" id="health"></div>' +
    '</div>' +
  '</div>';
}

function makePerformancePage(io) {
  'use strict';
  io.box.innerHTML = skeleton(io.title());
  var dead = false;
  var DASH = '–', DOT = ' · ', ARROW = '→', NB = ' ', DEG = '°', STAR = '★', DOTS = '…';
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var GAP = 12;                          // the space between the blocks of the page, as in the style sheet above
  var NARROW = 760;                      // at this card width and under, the list goes below the chart, as in the style sheet above
  var SETTLE = 3000;                     // the car's posts come in a burst (the snapshot first, the rest after it): the
                                         // store is read this long after a change is seen
  var HINT = 'Point at the chart, or tap it, to read the power at a speed.';
  var BLUE = 'var(--blue)', GREEN = 'var(--green)', AMBER = 'var(--amber)', INK = 'var(--fg)';
  var NOTHING = 'They appear here after the app measures a hard acceleration.';

  function el(id) { return io.root.getElementById(id); }
  var root = el('root'), factsEl = el('facts'), sentEl = el('sent'), warnEl = el('warn'), goneEl = el('gone'), bodyEl = el('body'),
      cardEl = el('card'), holder = el('holder'), plotEl = el('plot'), hairEl = el('hair'), readEl = el('readout'), legendEl = el('legend'),
      sideEl = el('side'), filtersEl = el('filters'), countEl = el('count'), cmpEl = el('cmp'), listEl = el('list'),
      belowEl = el('below'), runsEl = el('runs'), healthEl = el('health');
  var marks = [el('m0'), el('m1'), el('m2'), el('m3')];

  // ---- small helpers ----
  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
  function rng(v, lo, hi) { v = num(v); return v !== null && v >= lo && v <= hi ? v : null; }       // a number in a believable range, or null
  function text(v) {                     // free text from the app: one line, not endless (escaped where it is used), or null
    if (typeof v !== 'string') return null;
    v = v.replace(/\s+/g, ' ').trim();
    return !v ? null : v.length > 40 ? v.slice(0, 39) + DOTS : v;
  }
  function obj(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : null; }
  function esc(s) {
    return s === null || s === undefined ? '' : String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function fx(v, d) {                    // a number with d decimals, or a dash when it is missing
    if (num(v) === null) return DASH;
    var s = v.toFixed(d);
    return /^-0(\.0+)?$/.test(s) ? s.slice(1) : s;
  }
  function sp(v) { var s = fx(v, 1); return s.slice(-2) === '.0' ? s.slice(0, -2) : s; }       // a speed: 65 or 64.6
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function each(list, f) { Array.prototype.forEach.call(list || [], f); }
  function when(x) {                     // a time as the app writes it: 2026-10-14T11:19:31+11:00
    if (typeof x !== 'string' || !/^\d{4}-\d\d-\d\d/.test(x)) return null;
    var d = new Date(x);
    return isNaN(d.getTime()) ? null : d;
  }
  // dates are written by hand (not by the browser's locale tables, which say "Sept" and "June" in some browsers), so
  // they read the same everywhere and the same as on the other Zoomy pages: Wed, 14 Oct
  function day(d, year) { return DOW[d.getDay()] + ', ' + d.getDate() + ' ' + MON[d.getMonth()] + (year ? ' ' + d.getFullYear() : ''); }
  function hm(d) { return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
  function manyYears(rows) {             // do these rows span more than one year? Then the dates say the year
    var first = null, many = false;
    rows.forEach(function (r) { if (!r.at) return; var y = r.at.getFullYear(); if (first === null) first = y; else if (y !== first) many = true; });
    return many;
  }
  function newest(a, b) {                // newest first; rows without a date go last
    var x = a.at ? a.at.getTime() : null, y = b.at ? b.at.getTime() : null;
    return x === null ? (y === null ? 0 : 1) : y === null ? -1 : y - x;
  }

  // ---- tidying what the store sends: every value may be missing ----
  // [[speed, power], ...]: rows with a real speed from 0 to 400 km/h; a missing or absurd power stays null
  function pairs(a) {
    var out = [];
    (Array.isArray(a) ? a : []).forEach(function (p) {
      if (!Array.isArray(p)) return;
      var v = num(p[0]), w = num(p[1]);
      if (w !== null && Math.abs(w) > 2000) w = null;
      if (v !== null && v >= 0 && v <= 400) out.push([v, w]);
    });
    return out;
  }
  // a best-at-each-speed line, in speed order. The fast end the car has never reached (sent as 0 or as nothing) is
  // left off, so the line stops at the last speed with a measurement and does not fall back to zero.
  function envelope(a) {
    var e = pairs(a).map(function (p) { return [p[0], p[1] === null ? null : Math.abs(p[1])]; }).sort(function (p, q) { return p[0] - q[0]; });
    while (e.length && !(e[e.length - 1][1] > 0)) e.pop();
    return e;
  }
  function pull(p, i) {
    var pts = pairs(p.points).filter(function (q) { return q[1] !== null; });
    var peak = rng(p.peak_kw, -2000, 2000), peakAt = rng(p.peak_at_kmh, 0, 400);
    if (peak === null && pts.length) {
      var top = pts.reduce(function (a, q) { return q[1] > a[1] ? q : a; }, pts[0]);
      peak = top[1]; peakAt = top[0];
    }
    return { key: typeof p.when === 'string' && p.when ? p.when : 'pull ' + i, at: when(p.when), mode: text(p.mode), soc: rng(p.soc, 0, 110),
             peak: peak, peakAt: peakAt, v0: rng(p.start_kmh, 0, 400), v1: rng(p.end_kmh, 0, 400), secs: rng(p.secs, 0, 3600), out: rng(p.outside_c, -60, 70), pts: pts };
  }
  function tidy(r) {
    r = obj(r) || {};
    var best = obj(r.best), sag = obj(r.sag), seen = Object.create(null), modes = [], order = ['Eco', 'Normal', 'Sport'];
    var pulls = (Array.isArray(r.pulls) ? r.pulls : []).filter(obj).map(pull);
    pulls.forEach(function (p, i) { if (seen[p.key]) p.key += ' #' + i; seen[p.key] = true; });
    pulls.sort(newest);
    pulls.forEach(function (p) { if (p.mode && modes.indexOf(p.mode) < 0) modes.push(p.mode); });
    modes.sort(function (a, b) {
      var i = order.indexOf(a), j = order.indexOf(b);
      return (i < 0 ? 9 : i) - (j < 0 ? 9 : j) || (a < b ? -1 : a > b ? 1 : 0);
    });
    return { env: envelope(r.envelope), regen: envelope(r.regen_envelope),
             best: best && rng(best.kw, -2000, 2000) !== null ? { kw: best.kw, kmh: rng(best.kmh, 0, 400) } : null,
             sag: sag && rng(sag.volts, 0, 2000) !== null ? { volts: sag.volts, kw: rng(sag.at_kw, -2000, 2000) } : null,
             pulls: pulls, modes: modes, years: manyYears(pulls) };
  }
  function tidyRuns(a) {
    var pos = function (v, hi) { v = rng(v, 0, hi); return v !== null && v > 0 ? v : null; };
    return (Array.isArray(a) ? a : []).filter(obj).map(function (x) {
      return { at: when(x.when), t60: pos(x.s_0_60, 3600), t80: pos(x.s_0_80, 3600), t100: pos(x.s_0_100, 3600), q: pos(x.s_400m, 3600), trap: pos(x.trap_kmh, 500), g: rng(x.peak_g, -10, 10) };
    }).filter(function (x) {
      return x.at || x.t60 !== null || x.t80 !== null || x.t100 !== null || x.q !== null || x.trap !== null || x.g !== null;
    }).sort(newest);
  }

  // ---- the chart ----
  // the power axis: a round step, zero on a line
  function yAxis(lo, hi, lines) {
    if (!(hi > 0)) hi = 100;
    if (!(lo < 0)) lo = 0;
    var raw = (hi - lo) / Math.max(2, lines), p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p;
    var step = (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
    return { step: step, lo: Math.floor(lo / step + 1e-9) * step, hi: Math.ceil(hi / step - 1e-9) * step };
  }
  // unbroken stretches of a line: a missing value makes a gap
  function runs(pts) {
    var out = [], cur = [];
    pts.forEach(function (p) { if (p[1] === null) { if (cur.length) out.push(cur); cur = []; } else cur.push(p); });
    if (cur.length) out.push(cur);
    return out;
  }
  // d: the tidied dyno data; lines: the pulls to draw over it [{ pull, color, name, tip, second }]; W x H: the size on
  // screen in pixels. Gives the picture and, for the readout under the pointer, where every drawn point is.
  function chart(d, lines, W, H) {
    var L = 46, R = 14, T = 22, B = 36, iw = W - L - R, ih = H - T - B;
    var xmax = 120, top = 0, bot = 0;
    function see(kmh, kw) { if (kmh > xmax) xmax = kmh; if (kw > top) top = kw; if (kw < bot) bot = kw; }
    d.env.forEach(function (p) { if (p[1] !== null) see(p[0], p[1]); });
    d.regen.forEach(function (p) { if (p[1] !== null) see(p[0], -p[1]); });
    d.pulls.forEach(function (pl) { pl.pts.forEach(function (p) { see(p[0], p[1]); }); });      // every pull, so the axis stays put from pull to pull
    if (d.best) see(d.best.kmh === null ? 0 : d.best.kmh, d.best.kw);
    xmax = Math.ceil(xmax / 20 - 1e-9) * 20;
    var deep = null;                                                  // the strongest regen
    d.regen.forEach(function (p) { if (p[1] !== null && (deep === null || p[1] > deep[1])) deep = p; });
    var ax = yAxis(bot, top, clamp(Math.floor(ih / 34), 3, 10));
    // room for the words "Best ... kW" above the highest point, and for "Regen" under its line when its fill is too thin to hold the word
    if ((ax.hi - top) / (ax.hi - ax.lo) * ih < 18) ax.hi += ax.step;
    if (deep && deep[1] / (ax.hi - ax.lo) * ih < 20 && (-deep[1] - ax.lo) / (ax.hi - ax.lo) * ih < 18) ax.lo -= ax.step;
    var X = function (v) { return L + v / xmax * iw; }, Y = function (v) { return T + (ax.hi - v) / (ax.hi - ax.lo) * ih; };
    var n1 = function (v) { return String(Math.round(v * 10) / 10); };
    var series = [];

    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Power in kW against speed in km/h">';
    var dec = clamp(-Math.floor(Math.log10(ax.step) + 1e-9), 0, 3);       // 50 -> 0 decimals, 0.5 -> 1, 0.02 -> 2
    for (var i = Math.round(ax.lo / ax.step); i <= Math.round(ax.hi / ax.step); i++) {
      var gy = Y(i * ax.step);
      s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + n1(gy) + '" y2="' + n1(gy) + '" stroke="var(--' + (i === 0 ? 'muted' : 'grid') + ')" stroke-width="1"/>' +
           '<text x="' + (L - 6) + '" y="' + n1(gy + 4) + '" text-anchor="end">' + fx(i * ax.step, dec) + '</text>';
    }
    for (var v = 0, xs = xmax > 160 ? 40 : 20; v <= xmax; v += xs) {
      var gx = n1(X(v));
      s += '<line x1="' + gx + '" x2="' + gx + '" y1="' + T + '" y2="' + (T + ih) + '" stroke="var(--grid)" stroke-width="1"/>' +
           '<text x="' + gx + '" y="' + (T + ih + 16) + '" text-anchor="middle">' + v + '</text>';
    }
    s += '<text x="' + (L - 6) + '" y="12" text-anchor="end">kW</text>' +
         '<text x="' + (W - R) + '" y="' + (H - 5) + '" text-anchor="end">Speed, km/h</text>';

    // a best-at-each-speed line with a soft fill down (or up) to zero
    function band(pts, sign, color, name, tip, rank) {
      var y0 = n1(Y(0)), all = [];
      runs(pts).forEach(function (r) {
        var q = r.map(function (p) { return [X(p[0]), Y(sign * p[1]), p[0], p[1]]; });
        var line = q.map(function (c) { return n1(c[0]) + ',' + n1(c[1]); }).join(' ');
        if (q.length > 1) {
          s += '<polygon points="' + n1(q[0][0]) + ',' + y0 + ' ' + line + ' ' + n1(q[q.length - 1][0]) + ',' + y0 + '" fill="' + color + '" fill-opacity="0.12"/>' +
               '<polyline points="' + line + '" fill="none" stroke="' + color + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
        } else s += '<circle cx="' + n1(q[0][0]) + '" cy="' + n1(q[0][1]) + '" r="3" fill="' + color + '"/>';
        all = all.concat(q);
      });
      if (all.length) series.push({ name: name, tip: tip, color: color, pts: all, rank: rank, far: 6, second: false });
    }
    band(d.env, 1, BLUE, 'best ever', 'Best ever', 2);
    band(d.regen, -1, GREEN, 'best regen', 'Best regen', 3);

    if (d.best && d.best.kmh !== null) {
      var bx = X(d.best.kmh), by = Y(d.best.kw);
      s += '<circle cx="' + n1(bx) + '" cy="' + n1(by) + '" r="4" fill="var(--card)" stroke="' + BLUE + '" stroke-width="2"/>' +
           '<text class="v" x="' + n1(clamp(bx, L + 42, W - R - 42)) + '" y="' + n1(Math.max(12, by - 9)) + '" text-anchor="middle">Best ' + fx(d.best.kw, 1) + ' kW</text>';
    }
    if (deep) {                                                       // the word Regen: in the middle of the widest part of its fill
      var wide = d.regen.filter(function (p) { return p[1] !== null && p[1] >= 0.9 * deep[1]; });
      var rx = (X(wide[0][0]) + X(wide[wide.length - 1][0])) / 2, thick = Y(-deep[1]) - Y(0);
      s += '<text class="v" x="' + n1(clamp(rx, L + 22, W - R - 22)) + '" y="' + n1(thick >= 20 ? Y(-deep[1] / 2) + 4 : Math.min(T + ih - 4, Y(-deep[1]) + 15)) +
           '" text-anchor="middle">Regen</text>';
    }

    // the chosen pull (and the one it is compared with): a brighter line with a dot at every measurement
    lines.forEach(function (ln) {
      var q = ln.pull.pts.map(function (p) { return [X(p[0]), Y(p[1]), p[0], p[1]]; });
      if (!q.length) return;
      if (q.length > 1) {
        s += '<polyline points="' + q.map(function (c) { return n1(c[0]) + ',' + n1(c[1]); }).join(' ') + '" fill="none" stroke="' + ln.color +
             '" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"' + (ln.second ? ' stroke-dasharray="5 4"' : '') + '/>';
      }
      var apart = q.length > 1 ? Math.abs(q[q.length - 1][0] - q[0][0]) / (q.length - 1) : 99;      // pixels from one dot to the next
      var r = apart >= 9 ? 3 : apart >= 5 ? 2.2 : 1.6;
      q.forEach(function (c) {
        s += '<circle cx="' + n1(c[0]) + '" cy="' + n1(c[1]) + '" r="' + r + '" fill="' + (ln.second ? 'var(--card)' : ln.color) +
             '" stroke="' + (ln.second ? ln.color : 'var(--card)') + '" stroke-width="' + (ln.second ? 1.5 : r > 2 ? 1 : 0) + '"/>';
      });
      series.push({ name: ln.name, tip: ln.tip, color: ln.color, pts: q, rank: ln.second ? 1 : 0, far: 0, second: ln.second });
    });

    // a wide unseen target on every point, so resting the pointer near one names its speed and power
    series.forEach(function (se) {
      se.pts.forEach(function (c) {
        s += '<circle cx="' + n1(c[0]) + '" cy="' + n1(c[1]) + '" r="9" fill="none" pointer-events="all"><title>' +
             esc(se.tip + ': ' + sp(c[2]) + ' km/h, ' + fx(c[3], 1) + ' kW') + '</title></circle>';
      });
    });
    series.sort(function (a, b) { return a.rank - b.rank; });
    return { svg: s + '</svg>', series: series, W: W, H: H, T: T, ih: ih };
  }

  // what to read out at the pointer: the nearest drawn point across the chart (a pull's own points win over the
  // best-ever lines), then every other line's value at about that speed
  function readAt(series, px) {
    var lead = null, at = null, gap = Infinity;
    series.forEach(function (se) {
      se.pts.forEach(function (c) { var g = Math.abs(c[0] - px) + se.far; if (g < gap) { gap = g; lead = se; at = c; } });
    });
    if (!lead) return null;
    var rows = [];
    series.forEach(function (se) {
      if (se === lead) { rows.push({ se: se, c: at, same: true }); return; }
      var near = null;
      se.pts.forEach(function (c) { if (near === null || Math.abs(c[2] - at[2]) < Math.abs(near[2] - at[2])) near = c; });
      if (near && Math.abs(near[2] - at[2]) <= 2.6) rows.push({ se: se, c: near, same: Math.abs(near[2] - at[2]) < 0.05 });
    });
    return { kmh: at[2], x: at[0], rows: rows };
  }
  function readout(r) {
    var h = '<strong>' + esc(sp(r.kmh)) + ' km/h</strong>';
    r.rows.forEach(function (w) {
      h += '<span><span class="key' + (w.se.second ? ' dash' : '') + '" style="border-color:' + w.se.color + '"></span>' +
           esc(fx(w.c[3], 1) + ' kW ' + w.se.name + (w.same ? '' : ' at ' + sp(w.c[2]) + ' km/h')) + '</span>';
    });
    return h;
  }

  // ---- the words on the page ----
  function stamp(p) { return p.at ? day(p.at, data.years) + ' ' + hm(p.at) : 'date not known'; }
  // a pull in full words: for the legend and for the hint on each row of the list
  function words(p) {
    var b = [stamp(p)];
    if (p.mode) b.push(p.mode + ' mode');
    if (p.peak !== null) b.push('peak ' + fx(p.peak, 1) + ' kW' + (p.peakAt !== null ? ' at ' + fx(p.peakAt, 0) + ' km/h' : ''));
    if (p.v0 !== null && p.v1 !== null) b.push(fx(p.v0, 0) + ' ' + ARROW + ' ' + fx(p.v1, 0) + ' km/h' + (p.secs !== null ? ' in ' + fx(p.secs, 1) + ' s' : ''));
    else if (p.secs !== null) b.push(fx(p.secs, 1) + ' s');
    if (p.soc !== null) b.push('battery ' + fx(p.soc, 0) + '%');
    if (p.out !== null) b.push(fx(p.out, 0) + ' ' + DEG + 'C outside');
    return b.join(DOT);
  }
  // the second line of a row: mode, battery %, speed range, seconds, outside temperature
  function bits(p) {
    var b = [];
    if (p.mode) b.push(p.mode);
    if (p.soc !== null) b.push(fx(p.soc, 0) + '%');
    if (p.v0 !== null && p.v1 !== null) b.push(fx(p.v0, 0) + NB + ARROW + NB + fx(p.v1, 0) + NB + 'km/h');
    if (p.secs !== null) b.push(fx(p.secs, 1) + NB + 's');
    if (p.out !== null) b.push(fx(p.out, 0) + NB + DEG + 'C');
    return b;
  }
  function factsText(d) {
    var b = [], first = d.pulls.filter(function (p) { return p.at; })[0];
    if (d.best) b.push('Best ' + fx(d.best.kw, 1) + ' kW' + (d.best.kmh !== null ? ' at ' + fx(d.best.kmh, 0) + ' km/h' : ''));
    if (d.sag) b.push('Battery sagged to ' + fx(d.sag.volts, 1) + ' V' + (d.sag.kw !== null ? ' at ' + fx(d.sag.kw, 1) + ' kW' : ''));
    b.push(d.pulls.length ? d.pulls.length + (d.pulls.length === 1 ? ' pull' : ' pulls') : 'No pulls yet');
    if (first) b.push('Newest ' + day(first.at, d.years) + ' ' + hm(first.at));
    return b.join(DOT);
  }
  function listHtml(vis) {
    return vis.map(function (p) {
      var b = bits(p);
      return '<button type="button" data-k="' + esc(p.key) + '" aria-pressed="false" title="' + esc(words(p)) + '">' +
             '<span class="l1"><span>' + esc(p.at ? day(p.at, data.years) + DOT + hm(p.at) : 'Date not known') +
             (p === data.pulls[0] && p.at ? '<span class="tag">newest</span>' : '') + '</span>' +
             '<span class="kw">' + esc(p.peak !== null ? fx(p.peak, 1) + ' kW' : DASH) + '</span></span>' +
             '<span class="l2">' + esc(b.length ? b.join(DOT) : 'No details sent') + '</span></button>';
    }).join('');
  }
  function filtersHtml() {               // All, then the drive modes the pulls were made in
    return [''].concat(data.modes).map(function (m) {
      return '<button type="button" class="pill" data-m="' + esc(m) + '" aria-pressed="false">' + esc(m || 'All') + '</button>';
    }).join('');
  }
  function legendHtml(lines) {
    var h = '';
    if (data.env.length) h += '<span><span class="sw" style="background:' + BLUE + '"></span>Best ever at each speed</span>';
    if (data.regen.length) h += '<span><span class="sw" style="background:' + GREEN + '"></span>Regen: best braking power at each speed</span>';
    lines.forEach(function (ln) {
      h += '<span><span class="key' + (ln.second ? ' dash' : '') + '" style="border-color:' + ln.color + '"></span>' +
           esc((ln.second ? 'Compared with: ' : 'This pull: ') + words(ln.pull) + (ln.pull.pts.length ? '' : ' (no points sent)')) + '</span>';
    });
    return h;
  }

  // ---- the two cards from the car's latest snapshot ----
  var RUNCOLS = [['t60', '0' + DASH + '60 km/h (s)', 2, -1], ['t80', '0' + DASH + '80 km/h (s)', 2, -1], ['t100', '0' + DASH + '100 km/h (s)', 2, -1],
                 ['q', '400 m (s)', 2, -1], ['trap', 'Trap speed (km/h)', 0, 1], ['g', 'Peak g', 2, 1]];
  // the best of each column (the shortest time, the highest speed and g), when at least two runs have a value
  function bestOf(rows) {
    var out = {};
    RUNCOLS.forEach(function (c) {
      var vals = rows.map(function (r) { return r[c[0]]; }).filter(function (v) { return v !== null; });
      out[c[0]] = vals.length > 1 ? (c[3] < 0 ? Math.min.apply(null, vals) : Math.max.apply(null, vals)) : null;
    });
    return out;
  }
  // how the timed runs are sorted: 'date' (newest first) or a column key (best first). Best 0-60 first at the start.
  var runSort = 't60';
  function sortRuns(rows) {
    if (runSort === 'date') return rows.slice().sort(newest);
    var col = RUNCOLS.filter(function (c) { return c[0] === runSort; })[0];
    if (!col) return rows.slice().sort(newest);
    return rows.slice().sort(function (a, b) {
      var x = a[col[0]], y = b[col[0]];
      if (x === null && y === null) return newest(a, b);
      if (x === null) return 1;
      if (y === null) return -1;
      return x === y ? newest(a, b) : (col[3] < 0 ? x - y : y - x);
    });
  }
  function sortHead(key, label) {
    var on = runSort === key;
    return '<th><button type="button" class="sorter" data-sort="' + esc(key) + '" aria-pressed="' + (on ? 'true' : 'false') + '"' +
           ' title="Sort by this column">' + esc(label) + (on ? ' ▾' : '') + '</button></th>';
  }
  // snap: { runs, health } from the car's latest snapshot, or null when it could not be read
  function runsCard(snap) {
    var h = '<h2>Timed runs</h2>';
    if (!snap) return h + '<div class="sub">The car\'s timed runs could not be read from Home Assistant just now.</div>';
    var rows = tidyRuns(snap.runs);
    if (!rows.length) return h + '<div class="sub">No timed runs yet. They appear here after the app times an acceleration run.</div>';
    var best = bestOf(rows), years = manyYears(rows), any = RUNCOLS.some(function (c) { return best[c[0]] !== null; }), last = null;
    var byDate = runSort === 'date', sortCol = RUNCOLS.filter(function (c) { return c[0] === runSort; })[0];
    rows = sortRuns(rows);
    h += '<div class="sub">' + (rows.length === 1 ? 'The one timed run' : 'The ' + rows.length + ' timed runs') + ' in the car\'s latest upload' +
         (rows.length > 1 ? (byDate || !sortCol ? ', newest first' : ', best ' + sortCol[1].replace(/ \([^)]*\)$/, '') + ' first') : '') +
         '. Tap a column heading to sort by it. Trap speed is the speed at the end of the 400 m.' +
         (any ? ' <span class="star" aria-hidden="true">' + STAR + '</span> marks the best in each column.' : '') + '</div>' +
         '<div class="scroll"><table><thead><tr>' + sortHead('date', 'Date') + '<th>Time</th>' + RUNCOLS.map(function (c) { return sortHead(c[0], c[1]); }).join('') + '</tr></thead><tbody>';
    rows.forEach(function (r) {
      var d = r.at ? day(r.at, years) : DASH;
      h += '<tr><td class="day">' + (!byDate || d !== last ? esc(d) : '') + '</td><td>' + esc(r.at ? hm(r.at) : DASH) + '</td>';
      RUNCOLS.forEach(function (c) {
        var t = fx(r[c[0]], c[2]), top = r[c[0]] !== null && best[c[0]] !== null && t === fx(best[c[0]], c[2]);
        h += top ? '<td class="best" title="Best"><span aria-hidden="true">' + STAR + '</span> ' + esc(t) + '</td>' : '<td>' + esc(t) + '</td>';
      });
      h += '</tr>';
      last = d;
    });
    return h + '</tbody></table></div>';
  }
  function healthCard(snap) {
    var h = '<h2>Battery health</h2>';
    if (!snap) return h + '<div class="sub">The car\'s battery health could not be read from Home Assistant just now.</div>';
    var x = obj(snap.health);
    var kwh = x ? rng(x.usable_kwh, 0, 1000) : null, soh = x ? rng(x.soh_pct, 0, 200) : null, n = x ? rng(x.charges_counted, 0, 1e6) : null;
    if (kwh === null && soh === null) return h + '<div class="sub">No battery health figure yet. The app works it out from the car\'s charges.</div>';
    return h + '<div class="stats">' +
           '<div><div class="big">' + esc(fx(kwh, 1)) + '<small> kWh</small></div><div class="lbl">Usable battery</div></div>' +
           '<div><div class="big">' + esc(fx(soh, 0)) + '<small>%</small></div><div class="lbl">State of health</div></div></div>' +
           '<div class="sub">' + (n !== null ? 'Worked out by the app from ' + esc(fx(n, 0)) + (n === 1 ? ' charge.' : ' charges.') : 'The app did not say how many charges this is from.') + '</div>';
  }
  var cardsFor = null, cardsSig = null, cardsBusy = false, cardsRetry = 0;
  function drawCards() {
    [[runsEl, runsCard, 'Timed runs'], [healthEl, healthCard, 'Battery health']].forEach(function (c) {
      try { c[0].innerHTML = c[1](cardsFor); }
      catch (e) { c[0].innerHTML = '<h2>' + c[2] + '</h2><div class="sub">Could not show this: ' + esc(e && e.message ? e.message : e) + '</div>'; }
    });
    belowEl.hidden = false;
  }
  // the timed runs and the battery health come with the car's snapshot: read it when it has changed
  function cards() {
    var sig = io.sig(['snapshot']);
    if (cardsBusy || (sig === cardsSig && !(cardsRetry && Date.now() >= cardsRetry))) return;
    cardsBusy = true; cardsRetry = 0;
    io.ask('snapshot', null, 30000).then(function (r) {
      if (dead) return;
      var snap = r && obj(r.snapshot) ? r.snapshot : {};
      cardsFor = { runs: snap.runs, health: snap.health };
    }, function () {
      if (dead) return;
      if (cardsSig === null) cardsFor = null;          // never read: say so; a later failure keeps what was read before
      cardsRetry = Date.now() + 60000;
    }).then(function () {
      if (dead) return;
      cardsBusy = false; cardsSig = sig;
      drawCards();
    });
  }
  function sent() {
    var t = io.sent();
    if (sentEl.textContent !== t) sentEl.textContent = t;
  }

  // ---- what is on show ----
  var data = null;                       // the tidied dyno data from the last good read of the store
  var store = 'wait';                    // wait: not read yet; ok; absent: Zoomy is not loaded; error: a read failed
  var why = '', trouble = '';
  var filter = '';                       // the drive mode the list is narrowed to ('' = all)
  var chosen = null, other = null;       // the pull on the chart, and the one it is compared with
  var compare = false;
  var shown = null;                      // the chart now on screen (see chart)
  var blank = true;                      // nothing to draw
  // what was last written to the list, the mode buttons, the chart, the legend and the readout: a part is written
  // again only when it has changed, so a refresh that brings nothing new leaves the page (scroll position, keyboard
  // focus, the tooltip under the pointer) alone
  var listNow = null, modesNow = null, plotNow = null, legendNow = null, readNow = null;
  var aim = null;                        // where the chart was last pointed at, as a share of its width (null: nowhere)

  function narrow() { return io.narrow(NARROW); }
  // The chart is drawn at its real size on screen, so the lettering stays readable on a phone and on a wide screen.
  // On a wide card its height is what is left of the room under Home Assistant's bar, so the chart, the list and
  // (when they fit) the cards under them make one screen; when the cards are too tall for that, the chart and the
  // list fill the first screen.
  function measure() {
    var w = holder.clientWidth;
    if (!(w > 0)) return null;           // not on screen yet
    var W = Math.max(250, Math.floor(w)), H;
    if (narrow()) H = clamp(Math.round(W * 0.8), 250, 440);
    else {
      var vh = io.room();
      var frame = cardEl.offsetHeight - holder.offsetHeight;          // the chart's card around the picture
      var rest = root.offsetHeight - bodyEl.offsetHeight;             // the heading, the cards under it, the gaps
      var under = belowEl.hidden ? 0 : belowEl.offsetHeight + GAP;
      var all = vh - rest - frame - 6;
      H = clamp(Math.floor(all >= 300 ? all : vh - (rest - under) - frame - 40), 280, Math.max(280, Math.round(W * 0.8)));
    }
    return { W: W, H: H };
  }
  function visible() { return filter ? data.pulls.filter(function (p) { return p.mode === filter; }) : data.pulls; }
  function byKey(k) { for (var i = 0; i < data.pulls.length; i++) if (data.pulls[i].key === k) return data.pulls[i]; return null; }
  // keep what is chosen in step with what the list shows. follow: the newest pull was the one on show, so stay on the newest
  function settle(follow) {
    var vis = visible(), has = function (k) { return vis.some(function (p) { return p.key === k; }); };
    if (follow || chosen === null || !has(chosen)) chosen = vis.length ? vis[0].key : null;
    if (!compare || other === chosen || (other !== null && !has(other))) other = null;
  }
  function hideMarks() { hairEl.hidden = true; marks.forEach(function (m) { m.hidden = true; }); }
  // the reading at the place last pointed at (see aim): a line at the nearest measured speed, a ring on each line there
  // and the values under the chart. false when there is nothing to read.
  function reading() {
    if (!shown || aim === null) return false;
    var r = readAt(shown.series, aim * shown.W);
    if (!r) return false;
    var box = holder.getBoundingClientRect(), k = box && box.width > 0 ? shown.W / box.width : 1;      // 1, unless the page has only just changed size
    var h = readout(r);
    if (h !== readNow) { readEl.innerHTML = h; readNow = h; steady(); }
    hairEl.style.left = (r.x / k) + 'px'; hairEl.style.top = (shown.T / k) + 'px'; hairEl.style.height = (shown.ih / k) + 'px';
    hairEl.hidden = false;
    marks.forEach(function (m, i) {
      var w = r.rows[i];
      if (!w) { m.hidden = true; return; }
      m.style.left = (w.c[0] / k) + 'px'; m.style.top = (w.c[1] / k) + 'px'; m.style.borderColor = w.se.color;
      m.hidden = false;
    });
    return true;
  }
  // The readout takes two lines at some speeds and three at others. Once it has grown it keeps that height (until the
  // page changes width), so the legend, the list and the chart's own size do not jump about while the pointer moves.
  var readTall = 0, readWide = 0;
  function steady() {
    try {
      var w = readEl.clientWidth;
      if (Math.abs(w - readWide) > 2) { readWide = w; readTall = 0; readEl.style.minHeight = ''; }
      var t = readEl.offsetHeight;
      if (t > readTall) { readTall = t; readEl.style.minHeight = t + 'px'; }
    } catch (e) { /* cosmetic only */ }
  }
  function tally() {
    var n = visible().length;
    countEl.textContent = compare ? (other === null ? 'Tap another pull to compare it' : 'Comparing two pulls')
      : n + (filter ? ' ' + filter : '') + (n === 1 ? ' pull' : ' pulls') + (n > 1 ? ', newest first' : '');
  }
  function press() {
    each(listEl.querySelectorAll('button'), function (b) {
      var k = b.dataset ? b.dataset.k : null, role = k === chosen ? 'main' : k === other ? 'other' : '';
      b.setAttribute('aria-pressed', role ? 'true' : 'false');
      b.setAttribute('data-role', role);
    });
    each(filtersEl.querySelectorAll('button'), function (b) {
      b.setAttribute('aria-pressed', (b.dataset ? b.dataset.m || '' : '') === filter ? 'true' : 'false');
    });
  }
  function relist() {
    var vis = visible();
    var html = vis.length ? listHtml(vis) : '<div class="sub">' + (data.pulls.length ? 'No pulls in this mode.' : 'No pulls yet. ' + NOTHING) + '</div>';
    if (html !== listNow) {
      var at = null;                     // the row the keyboard is on gets it back after the list is written again
      try { at = io.root.activeElement; at = at && at.parentNode === listEl && at.dataset ? at.dataset.k : null; } catch (e) { at = null; }
      listEl.innerHTML = html; listNow = html;
      if (typeof at === 'string') {
        each(listEl.querySelectorAll('button'), function (b) {
          try { if (b.dataset && b.dataset.k === at) b.focus({ preventScroll: true }); } catch (e) { /* cosmetic only */ }
        });
      }
    }
    tally(); press();
  }
  function side() {
    var m = data.modes.join('\n');
    if (m !== modesNow) { filtersEl.innerHTML = data.modes.length ? filtersHtml() : ''; modesNow = m; }
    filtersEl.hidden = !data.modes.length;
    cmpEl.hidden = data.pulls.length < 2;
    if (compare && data.pulls.length < 2) { compare = false; other = null; cmpEl.setAttribute('aria-pressed', 'false'); }
    relist();
  }
  function plot() {
    var a = chosen !== null ? byKey(chosen) : null, b = other !== null ? byKey(other) : null, lines = [];
    if (a) lines.push({ pull: a, color: AMBER, name: 'this pull', tip: 'Pull on ' + stamp(a), second: false });
    if (b) lines.push({ pull: b, color: INK, name: 'compared pull', tip: 'Pull on ' + stamp(b), second: true });
    var lg = legendHtml(lines);
    if (lg !== legendNow) { legendEl.innerHTML = lg; legendNow = lg; }
    blank = !data.env.length && !data.regen.length && !data.pulls.some(function (p) { return p.pts.length > 0; });
    if (blank) {
      hideMarks();
      plotEl.innerHTML = '<div class="note">No power measurements yet. ' + NOTHING + '</div>'; plotNow = null;
      shown = null; readEl.textContent = ''; readNow = null;
      return;
    }
    var size = measure();
    if (!size) { shown = null; hideMarks(); return; }                 // drawn at the next look, once the page is on screen
    draw(lines, size);
    var again = measure();                                            // drawing it can change the room there is (a scroll bar coming or going)
    if (again && (Math.abs(again.W - size.W) > 2 || Math.abs(again.H - size.H) > 2)) draw(lines, again);
    if (!reading()) {                                                 // a reading that was up is put back: a redraw does not wipe it
      hideMarks();
      if (readNow !== HINT) { readEl.textContent = HINT; readNow = HINT; }
    }
  }
  function draw(lines, size) {
    shown = chart(data, lines, size.W, size.H);
    if (shown.svg !== plotNow) { plotEl.innerHTML = shown.svg; plotNow = shown.svg; }
  }
  function resized() {
    if (!data || store === 'absent' || blank) return;
    var size = measure();
    if (size && (!shown || Math.abs(size.W - shown.W) > 2 || Math.abs(size.H - shown.H) > 2)) plot();
  }
  // the one-line warning under the heading: a refresh that failed, or a part of the page that could not be drawn
  function warn() {
    var t = trouble || (data && store === 'error' ? 'Could not refresh the pulls (' + why + '). These are the ones read earlier.' : '');
    warnEl.hidden = !t;
    if (t && warnEl.textContent !== t) warnEl.textContent = t;
  }
  // what the page says when there is no chart to draw
  function state() {
    var gone = store === 'absent';
    goneEl.hidden = !gone; bodyEl.hidden = gone;
    warn();
    if (gone) {
      goneEl.textContent = 'Zoomy is not loaded in Home Assistant, so the power chart and the list of pulls cannot be shown.';
      factsEl.textContent = '';
      return;
    }
    if (data) { sideEl.hidden = false; return; }
    sideEl.hidden = true; factsEl.textContent = ''; legendEl.innerHTML = ''; readEl.textContent = ''; hideMarks();
    shown = null; blank = true; listNow = null; modesNow = null; plotNow = null; legendNow = null; readNow = null; aim = null;
    plotEl.innerHTML = '<div class="note">' + esc(store === 'error' ? 'Could not read the pulls from Home Assistant (' + why + '). It will be tried again shortly.'
      : 'Loading the pulls' + DOTS) + '</div>';
  }
  // on a phone the chart is above the list: bring it back into view when a pull is tapped further down
  function showChart() {
    try {
      if (!narrow()) return;
      var r = cardEl.getBoundingClientRect(), vh = window.innerHeight || 0;
      if (Math.min(r.bottom, vh) - Math.max(r.top, 0) < 0.6 * r.height) cardEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) { /* not worth a message */ }
  }

  // ---- reading the store: once at the start, then only when the car has sent new dyno data ----
  var readFor = null, busy = false, reads = 0, retryAt = 0, wait = 30000;
  function got(r) {
    var vis = data ? visible() : [], follow = !compare && chosen !== null && vis.length > 0 && vis[0].key === chosen;
    data = tidy(r); store = 'ok'; wait = 30000;
    if (filter && data.modes.indexOf(filter) < 0) filter = '';
    settle(follow);
    state();
    factsEl.textContent = factsText(data);
    side(); plot();
  }
  function failed(e) {
    if (e && e.code === 'unknown_command') { store = 'absent'; data = null; }
    else {
      store = 'error';
      why = e && typeof e.message === 'string' && e.message ? e.message.slice(0, 140) : e && typeof e.code === 'string' && e.code ? e.code : 'no answer from Home Assistant';
      retryAt = Date.now() + wait; wait = Math.min(wait * 2, 300000);     // a failed read is tried again, less and less often
    }
    state();
  }
  // sig: the change this read is for. delay: how long to give the car's burst of posts first (0 = ask now).
  // One read at a time: busy from here until it has answered, failed, or gone 20 seconds without an answer.
  function read(sig, delay) {
    var mine = ++reads, late = false;
    busy = true; readFor = sig;
    var go = function () {
      if (mine !== reads || dead) return;
      var timer = io.later(function () {
        if (mine !== reads || !busy) return;
        late = true; busy = false; failed({ message: 'no answer after 20 seconds' });
      }, 20000);
      io.ask('dyno', null, 120000).then(function (r) {
        if (mine !== reads || dead) return;                           // a newer read has been sent since: this answer is out of date
        io.clear(timer); busy = false;
        try { got(r); } catch (e) { failed(e); }
      }, function (e) {
        if (mine !== reads || late || dead) return;
        io.clear(timer); busy = false;
        failed(e);
      });
    };
    if (delay > 0) io.later(go, delay); else go();
  }

  // ---- one look: every few seconds, and at once when the car's subscription says something changed ----
  function look() {
    if (dead) return;
    if (trouble) { trouble = ''; warn(); }
    // each part on its own: one that fails must not stop the others
    attempt(sent);
    attempt(cards);
    var sig = io.sig(['dyno']), fresh = sig !== readFor, t = Date.now();
    if (!busy && (fresh || (store === 'error' && t >= retryAt))) {
      // the first read and a retry go at once; a read for a new upload gives the car's burst of posts a moment
      read(sig, fresh && readFor !== null ? SETTLE : 0);
    }
    attempt(resized);
  }
  function attempt(f) {
    try { f(); }
    catch (e) { trouble = 'Something went wrong on this page: ' + (e && e.message ? e.message : e); warn(); }
  }

  // ---- taps ----
  function button(e) { return e && e.target && e.target.closest ? e.target.closest('button') : null; }
  listEl.addEventListener('click', function (e) {
    var b = button(e), k = b && b.dataset ? b.dataset.k : null;
    if (!data || typeof k !== 'string' || !byKey(k)) return;
    if (!compare) { if (k !== chosen) { chosen = k; other = null; tally(); press(); plot(); } }
    else if (k !== chosen) { other = k === other ? null : k; tally(); press(); plot(); }
    showChart();
  });
  runsEl.addEventListener('click', function (e) {
    var b = button(e), k = b && b.dataset ? b.dataset.sort : null;
    if (typeof k !== 'string' || !k || k === runSort) return;
    runSort = k;
    try { runsEl.innerHTML = runsCard(cardsFor); }
    catch (err) { runsEl.innerHTML = '<h2>Timed runs</h2><div class="sub">Could not show this: ' + esc(err && err.message ? err.message : err) + '</div>'; }
  });
  filtersEl.addEventListener('click', function (e) {
    var b = button(e), m = b && b.dataset ? b.dataset.m || '' : null;
    if (!data || m === null || m === filter || (m && data.modes.indexOf(m) < 0)) return;
    filter = m; settle(false); relist(); plot();
  });
  cmpEl.addEventListener('click', function () {
    if (!data) return;
    compare = !compare;
    cmpEl.setAttribute('aria-pressed', compare ? 'true' : 'false');
    if (!compare && other !== null) { other = null; press(); plot(); }
    tally();
  });
  // pointing at the chart, or tapping it: a line at the nearest measured speed, a ring on each line there, the values below
  function point(e) {
    if (!shown || !shown.series.length) return;
    var box = holder.getBoundingClientRect();
    if (!box || !(box.width > 0)) return;
    var at = (e.clientX - box.left) / box.width;
    if (!isFinite(at)) return;
    aim = clamp(at, 0, 1);
    reading();
  }
  holder.addEventListener('pointermove', point);
  holder.addEventListener('pointerdown', point);
  holder.addEventListener('pointerleave', function (e) { if (e && e.pointerType === 'mouse') { aim = null; hideMarks(); } });

  var rz = null;
  attempt(look);
  io.every(function () { attempt(look); }, 5000);

  return {
    changed: function () { attempt(look); },
    carChanged: function () {          // the car was renamed: the heading follows
      var k = io.root.querySelector('.hs-kicker'), s = el('hsub');
      if (k) k.textContent = 'Zoomy · ' + io.title();
      if (s) s.textContent = io.title() + ' power on the road, timed runs and battery health';
    },
    resized: function () { io.clear(rz); rz = io.later(function () { try { resized(); } catch (e) { /* the next look tries again */ } }, 150); },
    destroy: function () { dead = true; }
  };
}

class ZoomyPerformanceCard extends ZoomyCard {
  static get css() { return CSS; }
  static get pageTitle() { return 'Performance'; }
  makePage(io) { return makePerformancePage(io); }
}

registerCard('zoomy-performance-card', ZoomyPerformanceCard, 'Zoomy performance',
  'Power on the road (dyno pulls), timed runs and battery health of a Zoomy car.');

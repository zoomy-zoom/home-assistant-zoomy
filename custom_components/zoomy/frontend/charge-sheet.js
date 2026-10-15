/* Zoomy charge sheet (zoomy-charge-sheet-card): how one charging session went, the power and the battery level
   minute by minute, with three figures worked out from the curve and the list of charges that have a curve.

   Ported from the HOME-styled charge.html of 14 Oct 2026 (an iframe page). The look, the words, the numbers and the
   maths are as there. What changed: it is a card (shadow DOM, no iframe); it reads which charges have a curve
   (zoomy/curve_keys), the facts of each charge (zoomy/charges) and the curve of the chosen one (zoomy/charge_curve,
   read when it is chosen and kept in memory), all for the car it shows; the lists are read again when the car's
   subscription says the charges or the curves changed (no sensor is watched); money uses Home Assistant's currency
   sign; the screen-size rules follow the card's width and the room under Home Assistant's bar.
   It holds no secrets, stores nothing and loads nothing from anywhere else. */

import { ZoomyCard, registerCard } from './core.js';

const CSS = `
  /* The page's own look, in HOME's colours (dark only, like HOME). Kept as the script counts on it: the 760 px width
     under which the list goes under the chart. The widths are as on the iframe page (the page's side padding 16 px,
     the chart card's side padding 14 px, the 300 px list), so the chart is just as wide and its time scale shows the
     same labels. The page is one room high: the room under Home Assistant's bar. */
  :host { --fg: #f0f7ff; --muted: #9db6c9; --grid: #22353f; --card: #0c2232; --page: #050e17; --accent: #45ceff;
          --blue: #51c9ff; --green: #65e7ae; --amber: #ffc267; --violet: #c191ff; --red: #ff86c8; }
  .wrap { min-width: 300px; color: var(--fg); }
  /* the chart on the left, the charges as a list down the right, scrolling by itself; the page is one screen high */
  .page { display: flex; flex-direction: column; box-sizing: border-box; height: var(--zoomy-h, calc(100vh - 56px)); min-height: 560px;
          padding: 26px 16px 26px; gap: 12px; }
  .page > .zcars { margin: 0; }

  /* the heading: kicker, title and subtitle, then the facts of the chosen charge under them */
  .head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-start; gap: 14px 20px; flex: none; margin: 0 0 6px; }
  .head .title { order: 1; flex: 1 1 auto; min-width: 0; }
  .head .facts { order: 3; flex: 1 1 100%; min-width: 0; margin: 0; padding: 14px 18px; border: 1px solid var(--hs-accent-border);
                 border-radius: var(--hs-radius); background: radial-gradient(ellipse at 10% 0%, var(--hs-accent-wash), transparent 75%), var(--hs-accent-base);
                 box-shadow: inset 0 0 22px var(--hs-accent-halo), 0 0 20px var(--hs-accent-halo);
                 color: var(--hs-text); font-size: 15px; font-weight: 650; line-height: 1.45; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
  .head .facts:empty { display: none; }
  .note { padding: 28px 8px; color: var(--hs-muted); }
  .body { display: flex; gap: 12px; flex: 1; min-height: 0; }
  .main { display: flex; flex-direction: column; gap: 12px; flex: 1; min-width: 0; min-height: 0; overflow-y: auto; }
  /* the chart and the figures as HOME's glass cards */
  .card { position: relative; box-sizing: border-box; min-width: 0; padding: 20px 22px; border: 1px solid var(--hs-card-border);
          border-radius: var(--hs-radius); background: var(--hs-card-bg); box-shadow: var(--hs-card-shadow); }
  .card h2 { margin: 0 0 8px; padding-bottom: 10px; border-bottom: 1px solid var(--hs-rule); color: #d3e3ef;
             font-size: 13px; font-weight: 650; letter-spacing: 1px; line-height: 1.5; text-transform: uppercase; }
  .sub { margin: 0 0 8px; min-height: 18px; color: var(--hs-muted); font-size: 12px; line-height: 1.5; }
  .chart { display: flex; flex-direction: column; flex: 1; }
  /* the chart card keeps its side padding of 14 px (the chart's width); its words sit 22 px in, as on HOME */
  .card.chart { padding: 18px 14px; }
  .chart > h2, .chart > .sub, .chart > .legend { margin-left: 8px; margin-right: 8px; }
  .plot { position: relative; flex: 1; min-height: 230px; touch-action: pan-y; }
  .plot:focus { outline: none; }
  .plot:focus-visible { outline: 3px solid var(--hs-gold); outline-offset: 3px; border-radius: 6px; }
  .svgbox { position: absolute; inset: 0; }
  svg { width: 100%; height: 100%; display: block; }
  svg text { fill: var(--hs-dim); font-size: 11px; }
  svg text.v { fill: var(--fg); }
  .msg { position: absolute; left: 0; right: 0; top: 40%; text-align: center; color: var(--hs-muted); padding: 0 16px; }
  .tip { position: absolute; left: 0; top: 0; pointer-events: none; white-space: nowrap; font-size: 12px;
         font-variant-numeric: tabular-nums; color: var(--hs-text); background: #0c2232f2; border: 1px solid #39627c;
         border-radius: 8px; padding: 3px 8px; box-shadow: 0 8px 22px #0006;
         box-sizing: border-box; max-width: calc(100% - 4px); overflow: hidden; text-overflow: ellipsis; overflow-wrap: normal; }
  .legend { display: flex; gap: 6px 16px; flex-wrap: wrap; flex: none; color: var(--hs-muted); font-size: 12px; margin-top: 8px; }
  .sw { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 6px; }
  .sw.dash { width: 14px; height: 0; border-top: 2px dashed var(--blue); border-radius: 0; vertical-align: 3px; }
  /* the three figures as HOME rows: label, big number, small print */
  .figs { flex: none; }
  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-top: 2px; }
  .tile { min-width: 0; padding: 10px 12px; border: 1px solid #34526366; border-radius: 10px; background: #132e3c55; }
  .tile .k { color: #c4d7e5; font-size: 11px; font-weight: 600; letter-spacing: 1.1px; line-height: 1.4; text-transform: uppercase; }
  .tile .n { margin-top: 2px; color: #64d6fa; font-size: 24px; font-weight: 740; letter-spacing: -.8px; line-height: 1.2;
             font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
  .tile .d { margin-top: 3px; color: var(--hs-muted); font-size: 12px; line-height: 1.45; overflow-wrap: anywhere; }
  /* the charges as HOME rows; the chosen one lit like HOME's chosen sidebar item */
  .side { display: flex; flex-direction: column; gap: 8px; flex: none; width: 300px; min-height: 0; }
  .count { flex: none; font-size: 12px; color: var(--hs-muted); padding: 0 2px; }
  .list { position: relative; display: flex; flex-direction: column; gap: 6px; flex: 1; min-height: 0; overflow-y: auto;
          padding: 1px 4px 1px 1px; scrollbar-width: thin; scrollbar-color: var(--hs-line) transparent; }
  .list button { flex: none; display: flex; flex-direction: column; gap: 3px; width: 100%; box-sizing: border-box; min-height: 44px;
                 text-align: left; font: inherit; font-size: 13px; color: var(--hs-text); background: #132e3c55;
                 border: 1px solid #34526366; border-radius: 10px; padding: 9px 12px; cursor: pointer; transition: border-color .2s, background .2s; }
  .list button:hover { border-color: #4b88a5; }
  .list button:focus-visible { outline: 2px solid var(--hs-gold); outline-offset: -2px; }
  .list button[aria-pressed="true"] { border-color: var(--accent); background: #143849;
                                      box-shadow: inset 0 0 0 1px var(--accent), 0 0 22px #28b2ed18; }
  .l1 { display: flex; justify-content: space-between; gap: 10px; font-weight: 650; font-variant-numeric: tabular-nums; }
  .l1 > span { min-width: 0; overflow-wrap: anywhere; }
  .l1 .kwh { flex: none; }
  .l2 { color: var(--hs-muted); font-size: 12px; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
  .tag { display: inline-block; margin-left: 6px; padding: 0 7px; border: 1px dashed #4a6272; border-radius: 20px; background: none;
         color: #a9bccb; font-size: 11px; font-weight: 600; line-height: 1.5; vertical-align: 1px; }

  /* wider than a phone: the three figures always side by side, one row (two rows would push them off the screen) */
  @container zoomy (min-width: 761px) { .tiles { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
  /* wider than a phone: the facts beside the title (under it when there is no room), so the heading takes less
     height from the chart */
  @container zoomy (min-width: 801px) {
    .head .title { flex: 0 1 auto; }
    .head .facts { order: 2; flex: 1 1 360px; align-self: center; }
  }
  /* HOME's screen sizes (top and bottom room only: the side room stays as before, see above) */
  @container zoomy (min-width: 1600px) { .page { padding-top: 28px; padding-bottom: 28px; } }
  @container zoomy (max-width: 1150px) { .page { padding-top: 22px; padding-bottom: 22px; } }
  @container zoomy (max-width: 800px) {
    .page { padding-top: 16px; padding-bottom: 22px; }
    .head .title { flex-basis: 100%; }
    .head .facts { padding: 12px 14px; font-size: 14px; }
    .card { padding: 16px 18px; }
    .card.chart { padding: 16px 14px; }
    .chart > h2, .chart > .sub, .chart > .legend { margin-left: 4px; margin-right: 4px; }
    .tile .n { font-size: 22px; }
  }
  /* a narrow card (a phone): the list goes under the chart and the page scrolls */
  @container zoomy (max-width: 760px) {
    .page { height: auto; min-height: 0; }
    .body { flex-direction: column; flex: none; }
    .main { flex: none; overflow-y: visible; }
    .chart { flex: none; }
    .plot { flex: none; height: 300px; min-height: 0; }
    .side { width: auto; }
    .list { flex: none; overflow-y: visible; padding: 1px; }
  }
  /* a short window (a laptop, under Home Assistant's own bars): HOME's smaller sizes, so the chart and the three
     figures under it fit on one screen. Shorter than the page's least height, the whole page scrolls. */
  @media (max-height: 816px) {
    @container zoomy (min-width: 761px) {
      .page { min-height: 650px; padding-top: 16px; padding-bottom: 16px; gap: 10px; }
      .head { margin-bottom: 0; }
      .head .hs-kicker { margin-bottom: 6px; }
      .head .hs-title { font-size: 29px; }
      .head .hs-sub { margin-top: 4px; }
      .head .facts { padding: 10px 16px; font-size: 14px; }
      .card, .card.chart { padding-top: 14px; padding-bottom: 14px; }
      .card h2 { margin-bottom: 6px; padding-bottom: 8px; }
      .sub { margin-bottom: 4px; }
      .legend { margin-top: 6px; }
      .tile { padding: 8px 12px; }
      .tile .n { font-size: 22px; }
    }
  }
  /* a narrow window: the chart column is narrow, so its figures are taller; below this height the page scrolls */
  @container zoomy (min-width: 761px) and (max-width: 1000px) { .page { min-height: 860px; } }
  @media (prefers-reduced-motion: reduce) { .list button { transition: none !important; } }
`;

function skeleton(car) {
  var e = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  return '<div class="page">' +
    '<div class="zcars" hidden></div>' +
    '<div class="head"><div class="title">' +
      '<p class="hs-kicker" id="kick">' + e('Zoomy \u00b7 ' + car) + '</p>' +
      '<h1 class="hs-title">ZOOMY <em>&mdash; Charge sheet</em></h1>' +
      '<p class="hs-sub">One charge, minute by minute: power and battery level</p>' +
    '</div><p class="facts hs-accent-car" id="facts"></p></div>' +
    '<div class="note" id="note">Loading the charges&hellip;</div>' +
    '<div class="body" id="body" hidden>' +
      '<div class="main">' +
        '<div class="card chart" id="chartcard">' +
          '<h2>Power and battery during the charge</h2>' +
          '<div class="sub" id="csub"></div>' +
          '<div class="plot" id="plot" tabindex="0" role="group" aria-label="Chart of the chosen charge. The left and right arrow keys step through its readings.">' +
            '<div class="svgbox" id="svgbox"></div><div class="msg" id="msg" hidden></div><div class="tip" id="tip" hidden></div>' +
          '</div>' +
          '<div class="legend" id="legend"></div>' +
        '</div>' +
        '<div class="card figs"><h2>Worked out from the curve</h2><div class="tiles" id="tiles"></div></div>' +
      '</div>' +
      '<div class="side"><div class="count" id="count"></div><div class="list" id="list" role="group" aria-label="Choose a charge"></div></div>' +
    '</div>' +
  '</div>';
}

function makeChargeSheetPage(io) {
  'use strict';
  io.box.innerHTML = skeleton(io.title());
  var dead = false;
  var TICK_MS = 5000;            // how often the page looks whether the car has sent something
  var SETTLE_MS = 3000;          // the car's posts come in a burst: the store is read this long after a change is seen
  var WAIT_MS = 30000;           // give up on one question to Home Assistant after this long
  var RETRY_MS = 30000;          // after a read that failed, ask again this much later; twice as long after each further failure
  var RETRY_MAX_MS = 300000;     // ... but never longer than this
  var ABSENT_RETRY_MS = 120000;  // the same, when Zoomy is not loaded
  var SEARCH_MAX = 100;          // at the start, look through at most this many curves for one with 3 readings
  var SHORT = 3;                 // a curve of this many readings or fewer is "a very short record"
  var DASH = '\u2013', DOT = ' \u00b7 ', TO = ' \u2192 ', DOTS = '\u2026';
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var SIGN = io.sign();

  function $(id) { return io.root.getElementById(id); }
  var el = {};
  ['facts', 'note', 'body', 'csub', 'plot', 'svgbox', 'msg', 'tip', 'legend', 'tiles', 'count', 'list', 'chartcard', 'kick'].forEach(function (id) { el[id] = $(id); });

  // ---------- reading from Home Assistant ----------

  // one question to Home Assistant: it always ends, with the answer or with the reason there is none
  function ask(type, extra) { return io.ask(type, extra, WAIT_MS); }
  function why(e) { return e && typeof e.message === 'string' && e.message ? e.message : 'no answer from Home Assistant'; }
  // when to ask again after the n-th failure in a row
  function later(n) { return Date.now() + Math.min(RETRY_MAX_MS, RETRY_MS * Math.pow(2, Math.max(0, n - 1))); }

  // ---------- small helpers ----------

  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
  function txt(v, max) {
    if (typeof v !== 'string' || !v.trim()) return null;
    v = v.trim();
    return v.length > max ? v.slice(0, max - 1) + DOTS : v;
  }
  function esc(s) {
    return s === null || s === undefined ? '' : String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function fixed(v, d) { var s = v.toFixed(d); return Number(s) === 0 ? (0).toFixed(d) : s; }   // never "-0.0"
  function fx(v, d) { return v === null ? DASH : fixed(v, d); }
  function when(x) {
    if (typeof x !== 'string' || !/^\d{4}-\d\d-\d\d[T ]\d\d:\d\d/.test(x)) return null;
    var d = new Date(x);
    return isNaN(d) ? null : d;
  }
  // dates are written by hand (not by the browser's locale tables) so they read the same everywhere: Wed, 14 Oct
  function day(d, year) { return DOW[d.getDay()] + ', ' + d.getDate() + ' ' + MON[d.getMonth()] + (year ? ' ' + d.getFullYear() : ''); }
  function hm(d) { return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
  // minutes (may be a part of a minute) as "0.2 min", "50 min" or "1 h 5 min"
  function dur(m) {
    if (m === null) return DASH;
    if (m < 9.95) return fixed(m, Math.abs(m - Math.round(m)) < 0.05 ? 0 : 1) + ' min';
    var w = Math.round(m);
    return w >= 60 ? Math.floor(w / 60) + ' h ' + (w % 60) + ' min' : w + ' min';
  }
  function kwh(v) { return v === null ? DASH + ' kWh' : fixed(v, Math.abs(v) < 10 ? 2 : 1) + ' kWh'; }
  function money(v) { return (v <= -0.005 ? '-' + SIGN : SIGN) + Math.abs(v).toFixed(2); }   // never "-$0.00"
  function fromTo(a, b) { return fx(a, 0) + TO + fx(b, 0) + '%'; }
  function minutesOf(row) {
    var m = num(row.minutes);
    if (m === null) { var a = when(row.start), b = when(row.end); if (a && b) m = (b - a) / 60000; }
    return m === null ? null : Math.max(0, m);
  }

  // ---------- the words: the facts line, one line of the list, the count above the list ----------

  function factsText(key, row, withYear) {
    var a = when(key) || (row ? when(row.start) : null), b = row ? when(row.end) : null, bits = [];
    if (a) {
      var sameDay = !!b && a.toDateString() === b.toDateString();
      bits.push(day(a, withYear) + ' ' + hm(a) +
                (b && b >= a && !(sameDay && hm(a) === hm(b)) ? ' to ' + (sameDay ? '' : day(b, withYear) + ' ') + hm(b) : ''));
    } else bits.push(txt(String(key), 60) || DASH);
    if (!row) { bits.push('no details are stored for this charge'); return bits.join(DOT); }
    var m = minutesOf(row), s0 = num(row.soc_start), s1 = num(row.soc_end), avg = num(row.avg_kw), peak = num(row.peak_kw);
    var cost = num(row.cost), type = txt(row.type, 30), place = txt(row.place, 80), how = txt(row.breakdown, 200);
    if (m !== null) bits.push(dur(m));
    bits.push(kwh(num(row.kwh_added)) + ' added');
    bits.push('battery ' + (s0 === null && s1 === null ? DASH : fromTo(s0, s1)));
    // a peak of 0 with a real average means the app did not note a peak for this charge
    bits.push('average ' + (avg === null ? DASH : fixed(avg, 1) + ' kW') + ', peak ' + (peak === null || peak <= 0 ? DASH : fixed(peak, 1) + ' kW'));
    if (type) bits.push(type);
    if (place) bits.push(place);
    bits.push('cost ' + (cost === null ? DASH : money(cost) + (row.cost_typed === true ? ' (typed)' : row.cost_typed === false ? ' (estimated)' : '')));
    if (how) bits.push(how);
    return bits.join(DOT);
  }

  // one charge in the list: date, time and kWh on the first line; type, place, battery and minutes on the second
  function itemHtml(key, row, i, withYear, readings) {
    var a = when(key) || (row ? when(row.start) : null), bits = [];
    var l1 = a ? day(a, withYear) + DOT + hm(a) : (txt(String(key), 40) || DASH);
    if (row) {
      var type = txt(row.type, 20), place = txt(row.place, 40), s0 = num(row.soc_start), s1 = num(row.soc_end), m = minutesOf(row);
      if (type) bits.push(type);
      if (place) bits.push(place);
      if (s0 !== null || s1 !== null) bits.push(fromTo(s0, s1));
      if (m !== null) bits.push(dur(m));
    }
    return '<button type="button" data-i="' + i + '" aria-pressed="false">' +
           '<span class="l1"><span>' + esc(l1) + (typeof readings === 'number' && readings <= SHORT ? '<span class="tag">short</span>' : '') + '</span>' +
           '<span class="kwh">' + esc(row ? kwh(num(row.kwh_added)) : '') + '</span></span>' +
           '<span class="l2">' + esc(bits.length ? bits.join(DOT) : 'no details stored') + '</span></button>';
  }

  function countText(n, total, failed) {
    var s = total !== null && total >= n
      ? n + ' of ' + total + (total === 1 ? ' charge ' : ' charges ') + (n === 1 ? 'has' : 'have') + ' a curve'
      : n + (n === 1 ? ' charge has' : ' charges have') + ' a curve';
    return s + (n > 1 ? ', newest first' : '') + (failed ? '. The list of all charges could not be read.' : '');
  }

  // ---------- the curve: tidy it, and work figures out from it ----------

  // points as [minutes since the start, battery %, kW] become {t, s, k}, in time order; a value that is missing is null
  function clean(raw) {
    var out = [];
    if (!Array.isArray(raw)) return out;
    raw.forEach(function (p, i) {
      if (!Array.isArray(p)) return;
      var t = num(p[0]);
      if (t !== null) out.push({ t: t, s: num(p[1]), k: num(p[2]), i: i });
    });
    out.sort(function (a, b) { return a.t - b.t || a.i - b.i; });
    return out;
  }
  function mark(pts) {     // changes when the curve changes
    var a = 0;
    pts.forEach(function (p) { a += p.t * 3 + (p.s === null ? 0.5 : p.s * 5) + (p.k === null ? 0.25 : p.k * 7); });
    return pts.length + ':' + a;
  }

  /* Figures from the curve. The readings are unevenly spaced, so everything goes by time: between two readings the
     power is taken to move in a straight line (as the chart draws it), and a reading with no power breaks the line. */
  function stats(pts) {
    var o = { n: 0, span: 0, peak: null, above: null, avg: null, covered: 0, rate: null, s0: null, s1: null, socMin: null };
    var first = null, last = null, fs = null, ls = null, area = 0, above = 0, i, p, q;
    for (i = 0; i < pts.length; i++) {
      p = pts[i];
      if (p.k === null && p.s === null) continue;
      o.n++;
      if (!first) first = p;
      last = p;
      if (p.k !== null && (o.peak === null || p.k > o.peak)) o.peak = p.k;
      if (p.s !== null) { if (!fs) fs = p; ls = p; }
    }
    if (first) o.span = Math.max(0, last.t - first.t);
    var line = o.peak !== null && o.peak > 0 ? 0.8 * o.peak : null;
    for (i = 1; i < pts.length; i++) {
      p = pts[i - 1]; q = pts[i];
      if (p.k === null || q.k === null) continue;
      var dt = q.t - p.t;
      if (!(dt > 0)) continue;
      area += (p.k + q.k) / 2 * dt;
      o.covered += dt;
      if (line !== null) {
        var hi = Math.max(p.k, q.k), lo = Math.min(p.k, q.k);
        if (lo >= line) above += dt; else if (hi > line) above += dt * (hi - line) / (hi - lo);
      }
    }
    if (o.covered > 0) { o.avg = area / o.covered; if (line !== null) o.above = above; }
    if (fs && ls && ls.t > fs.t) { o.s0 = fs.s; o.s1 = ls.s; o.socMin = ls.t - fs.t; o.rate = (ls.s - fs.s) / o.socMin * 60; }
    return o;
  }

  // the three figures of the card under the chart; with no curve to work from (s.n is 0) only the names and a dash
  function figures(s) {
    var none = s.n ? null : '\u00a0';
    return [
      { k: 'Time above 80% of peak power', n: dur(s.above),
        d: none || (s.above === null ? 'not enough power readings'
                            : 'peak ' + fixed(s.peak, 1) + ' kW, so above ' + fixed(s.peak * 0.8, 1) + ' kW; ' + Math.round(s.above / s.covered * 100) + '% of the time') },
      { k: 'Average power', n: s.avg === null ? DASH : fixed(s.avg, 1) + ' kW',
        d: none || (s.avg === null ? 'not enough power readings' : 'over the ' + dur(s.covered) + ' of the curve') },
      { k: 'Battery gained per hour', n: s.rate === null ? DASH : fixed(s.rate, Math.abs(s.rate) >= 100 ? 0 : 1) + '%',
        d: none || (s.rate === null ? 'not enough battery readings' : fixed(s.s0, 1) + TO + fixed(s.s1, 1) + '% in ' + dur(s.socMin)) }
    ];
  }
  function tilesHtml(f) {
    return f.map(function (t) {
      return '<div class="tile"><div class="k">' + esc(t.k) + '</div><div class="n">' + esc(t.n) + '</div><div class="d">' + esc(t.d) + '</div></div>';
    }).join('');
  }

  // ---------- the chart ----------

  // the kW scale: 4 or 5 equal steps of a round size, the smallest such scale that holds every value
  function scaleKw(lo, hi) {
    lo = Math.min(0, lo); hi = Math.max(0, hi);
    if (hi - lo < 1) hi = lo + 1;
    var mult = [1, 2, 2.5, 5], best = null;
    for (var e = -1; e <= 6 && !best; e++) {
      for (var i = 0; i < mult.length; i++) {
        var step = mult[i] * Math.pow(10, e);
        for (var d = 5; d >= 4; d--) {
          var neg = Math.ceil(-lo / step - 1e-9);
          if (neg > d || (d - neg) * step < hi - 1e-9) continue;
          if (!best || d * step < best.divs * best.step - 1e-9) best = { lo: neg > 0 ? -neg * step : 0, hi: (d - neg) * step, step: step, divs: d };
        }
      }
    }
    return best || { lo: lo, hi: hi, step: (hi - lo) / 5, divs: 5 };
  }
  /* The battery scale: a tight range around this charge (a 3% top-up would be a flat line on 0 to 100), in round
     steps, with as many steps as the kW scale so both share the same grid lines. Never outside 0 to 100. */
  function scaleSoc(lo, hi, divs) {
    var whole = { lo: 0, hi: 100, step: 100 / divs };
    if (lo === null || hi === null) return whole;
    lo = Math.max(0, Math.min(100, lo)); hi = Math.max(0, Math.min(100, hi));
    var steps = [1, 2, 2.5, 5, 10, 20, 25];
    for (var i = 0; i < steps.length; i++) {
      var span = steps[i] * divs;
      if (span > 100 + 1e-9) continue;
      var a = Math.floor(lo / steps[i] + 1e-9) * steps[i];
      if (a + span > 100) a = 100 - span;
      if (a <= lo + 1e-9 && a + span >= hi - 1e-9) return { lo: a, hi: a + span, step: steps[i] };
    }
    return whole;
  }
  function places(step) {
    for (var d = 0; d < 3; d++) { var v = step * Math.pow(10, d); if (Math.abs(v - Math.round(v)) < 1e-9) return d; }
    return 3;
  }
  // where the labels go along the time axis; room = how many fit
  function timeTicks(t0, t1, room) {
    var steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 20, 30, 60, 120, 180, 240, 360, 480, 720, 1440];
    var span = t1 - t0, want = Math.max(2, Math.min(10, room)), step = null, at = [], i;
    for (i = 0; i < steps.length && step === null; i++) if (span / steps[i] <= want) step = steps[i];
    if (step === null) step = 1440 * Math.ceil(span / 1440 / want);
    for (i = Math.ceil(t0 / step - 1e-9); i * step <= t1 + 1e-9 && at.length < 40; i++) at.push(i * step);
    return { step: step, at: at };
  }
  function clock(v) {     // minutes as hours:minutes
    var a = Math.round(Math.abs(v));
    return (v < 0 && a ? '-' : '') + Math.floor(a / 60) + ':' + ('0' + a % 60).slice(-2);
  }
  // the stretches of readings, one after the other, that have a value for key ("k" or "s")
  function runs(pts, key) {
    var out = [], run = null;
    pts.forEach(function (p) {
      if (p[key] === null) { run = null; return; }
      if (!run) { run = []; out.push(run); }
      run.push(p);
    });
    return out;
  }

  /* The chart, drawn at its real size on screen: W x H pixels. Time since the start goes across (by time, not by
     count of readings), power is a filled line on the left scale, the battery a second line on the right scale. */
  function chartSvg(pts, W, H, label) {
    var ks = [], ss = [];
    pts.forEach(function (p) { if (p.k !== null) ks.push(p.k); if (p.s !== null) ss.push(p.s); });
    var t0 = pts.length ? Math.min(0, pts[0].t) : 0, t1 = pts.length ? pts[pts.length - 1].t : 1;
    if (!(t1 > t0)) t1 = t0 + 1;
    var peak = ks.length ? Math.max.apply(null, ks) : null;
    var kw = scaleKw(ks.length ? Math.min.apply(null, ks) : 0, peak === null ? 0 : peak);
    var soc = scaleSoc(ss.length ? Math.min.apply(null, ss) : null, ss.length ? Math.max.apply(null, ss) : null, kw.divs);
    var kd = places(kw.step), sd = places(soc.step), kl = [], sl = [], g, gy;
    for (g = 0; g <= kw.divs; g++) { kl.push(fixed(kw.lo + kw.step * g, kd)); sl.push(fixed(soc.lo + soc.step * g, sd)); }
    // the room at each side holds the longest label of its scale
    var room = function (a) { return Math.ceil(12 + 6.4 * a.reduce(function (m, x) { return Math.max(m, x.length); }, 0)); };
    var L = Math.max(40, room(kl)), R = Math.max(44, room(sl)), T = 28, B = 40, iw = Math.max(60, W - L - R), ih = Math.max(60, H - T - B);
    var hours = t1 - t0 > 120;
    var X = function (t) { return L + (t - t0) / (t1 - t0) * iw; };
    var Y = function (v, sc) { return T + ih - (Math.max(sc.lo, Math.min(sc.hi, v)) - sc.lo) / (sc.hi - sc.lo) * ih; };
    var xy = function (p, key, sc) { return X(p.t).toFixed(1) + ' ' + Y(p[key], sc).toFixed(1); };
    var base = Y(0, kw);

    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(label) + '">';
    for (g = 0; g <= kw.divs; g++) {
      gy = (T + ih - ih * g / kw.divs).toFixed(1);
      s += '<line x1="' + L + '" x2="' + (L + iw) + '" y1="' + gy + '" y2="' + gy + '" stroke="var(--grid)" stroke-width="1"/>' +
           '<text x="' + (L - 6) + '" y="' + (Number(gy) + 4).toFixed(1) + '" text-anchor="end">' + kl[g] + '</text>';
      if (ss.length) s += '<text x="' + (L + iw + 6) + '" y="' + (Number(gy) + 4).toFixed(1) + '">' + sl[g] + '</text>';
    }
    s += '<rect x="2" y="6" width="8" height="8" rx="2" fill="var(--blue)"/><text class="v" x="14" y="14">kW</text>';
    if (ss.length) s += '<rect x="' + (W - 10) + '" y="6" width="8" height="8" rx="2" fill="var(--amber)"/><text class="v" x="' + (W - 14) + '" y="14" text-anchor="end">%</text>';
    var tk = timeTicks(t0, t1, Math.floor(iw / (hours ? 60 : 48)));
    tk.at.forEach(function (v) {
      var x = X(v).toFixed(1);
      s += '<line x1="' + x + '" x2="' + x + '" y1="' + (T + ih) + '" y2="' + (T + ih + 4) + '" stroke="var(--grid)" stroke-width="1"/>' +
           '<text x="' + x + '" y="' + (T + ih + 17) + '" text-anchor="middle">' + (hours ? clock(v) : fixed(v, tk.step < 1 ? 1 : 0)) + '</text>';
    });
    s += '<text x="' + (L + iw / 2).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle">' +
         (hours ? 'hours:minutes since the charge started' : 'minutes since the charge started') + '</text>';

    // charging power: filled down to zero
    var joined = false;
    runs(pts, 'k').forEach(function (r) {
      if (r.length < 2) return;
      joined = true;
      var d = r.map(function (p, j) { return (j ? 'L' : 'M') + xy(p, 'k', kw); }).join('');
      s += '<path d="' + d + 'L' + X(r[r.length - 1].t).toFixed(1) + ' ' + base.toFixed(1) + 'L' + X(r[0].t).toFixed(1) + ' ' + base.toFixed(1) +
           'Z" fill="var(--blue)" fill-opacity=".2"/>' +
           '<path d="' + d + '" fill="none" stroke="var(--blue)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
    });
    // the line the first figure under the chart is counted against
    var line = joined && peak > 0 ? peak * 0.8 : null;
    if (line !== null) {
      gy = Y(line, kw).toFixed(1);
      s += '<line x1="' + L + '" x2="' + (L + iw) + '" y1="' + gy + '" y2="' + gy + '" stroke="var(--blue)" stroke-opacity=".75" stroke-width="1" stroke-dasharray="5 4"/>';
    }
    // battery level
    runs(pts, 's').forEach(function (r) {
      if (r.length < 2) return;
      s += '<path d="' + r.map(function (p, j) { return (j ? 'L' : 'M') + xy(p, 's', soc); }).join('') +
           '" fill="none" stroke="var(--amber)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
    });
    // each reading as a dot when there are few of them, and always a reading that stands alone
    var few = pts.length <= 40;
    [['k', kw, 'var(--blue)'], ['s', soc, 'var(--amber)']].forEach(function (a) {
      runs(pts, a[0]).forEach(function (r) {
        if (!few && r.length > 1) return;
        r.forEach(function (p) {
          s += '<circle cx="' + X(p.t).toFixed(1) + '" cy="' + Y(p[a[0]], a[1]).toFixed(1) + '" r="3" fill="' + a[2] + '"/>';
        });
      });
    });
    // what follows the pointer
    s += '<line id="hl" x1="0" x2="0" y1="' + T + '" y2="' + (T + ih) + '" stroke="var(--fg)" stroke-opacity=".5" stroke-width="1" visibility="hidden"/>' +
         '<circle id="hk" cx="0" cy="0" r="4.5" fill="var(--blue)" stroke="var(--card)" stroke-width="2" visibility="hidden"/>' +
         '<circle id="hs" cx="0" cy="0" r="4.5" fill="var(--amber)" stroke="var(--card)" stroke-width="2" visibility="hidden"/></svg>';

    var P = [];
    pts.forEach(function (p) {
      if (p.k === null && p.s === null) return;
      P.push({ x: X(p.t), yk: p.k === null ? null : Y(p.k, kw), ys: p.s === null ? null : Y(p.s, soc), p: p });
    });
    return { svg: s, geo: { W: W, H: H, hours: hours, P: P, kw: kw, soc: ss.length ? soc : null, line: line } };
  }

  function legendHtml(g) {
    return '<span><span class="sw" style="background:var(--blue)"></span>Charging power, kW (left scale)</span>' +
           (g.soc ? '<span><span class="sw" style="background:var(--amber)"></span>Battery, % (right scale, ' +
                    esc(fixed(g.soc.lo, places(g.soc.lo)) + ' to ' + fixed(g.soc.hi, places(g.soc.hi))) + '%)</span>' : '') +
           (g.line !== null ? '<span><span class="sw dash"></span>80% of the peak power</span>' : '');
  }
  function tipText(p, hours, start) {
    return (hours ? dur(p.t) : fixed(p.t, 1) + ' min') +
           (start ? ' (' + hm(new Date(start.getTime() + p.t * 60000)) + ')' : '') + DOT +
           (p.k === null ? DASH : fixed(p.k, 1)) + ' kW' + DOT + (p.s === null ? DASH : fixed(p.s, 1)) + '%';
  }
  // the reading nearest to x (pixels from the left of the chart); P is in order from left to right
  function nearest(P, x) {
    var lo = 0, hi = P.length - 1;
    if (hi < 0) return -1;
    while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (P[mid].x <= x) lo = mid; else hi = mid; }
    return Math.abs(P[lo].x - x) <= Math.abs(P[hi].x - x) ? lo : hi;
  }

  // ---------- what the page holds (in memory only) ----------

  var keys = null;                  // the charges that have a curve, newest first; null until the store has answered
  var shown = [];                   // the same, as the list on screen has them
  var rows = [], total = null, rowsFailed = false;      // the facts of the charges; how many charges there are
  var storeRows = null, storeAll = false;               // the charges as the store last gave them (all of them, or only the latest upload)
  var byStart = Object.create(null), byTime = Object.create(null);
  var cache = Object.create(null), pending = Object.create(null), gen = 0;   // curves already read
  var readings = Object.create(null);                   // how many readings each curve read so far has
  var sel = null, cur = null, seq = 0;                  // the chosen charge, its curve, and which choice is the latest
  var picked = false;               // a charge has been chosen, by the page at the start or by the viewer
  var year = false;                 // the list spans more than one year, so dates carry the year
  var geo = null, drawn = '', hover = -1, listHtml = null;
  var readSig = null, waitSig = null, waitAt = 0, busy = false;
  var retryAt = 0, listFails = 0;                       // when to ask for the lists again after a failure; failures in a row
  var curveRetryAt = 0, curveFails = 0;                 // the same for the curve of the chosen charge

  // one sentence in place of the chart and the list; an answer still on its way for a charge is no longer wanted
  function note(t) { seq++; el.note.textContent = t; el.note.hidden = false; el.body.hidden = true; el.facts.textContent = ''; }
  function say(t) { el.msg.textContent = t; el.msg.hidden = !t; }
  function rowFor(key) {
    var d = when(key);
    return byStart[key] || (d ? byTime[d.getTime()] : null) || null;
  }

  function hideTip() {
    hover = -1; el.tip.hidden = true;
    ['hl', 'hk', 'hs'].forEach(function (id) { var x = $(id); if (x) x.setAttribute('visibility', 'hidden'); });
  }
  function point(i) {
    if (!geo || !cur || i < 0 || i >= geo.P.length) { hideTip(); return; }
    hover = i;
    var q = geo.P[i], hl = $('hl');
    if (hl) { hl.setAttribute('x1', q.x.toFixed(1)); hl.setAttribute('x2', q.x.toFixed(1)); hl.setAttribute('visibility', 'visible'); }
    [['hk', q.yk], ['hs', q.ys]].forEach(function (a) {
      var c = $(a[0]); if (!c) return;
      if (a[1] === null) { c.setAttribute('visibility', 'hidden'); return; }
      c.setAttribute('cx', q.x.toFixed(1)); c.setAttribute('cy', a[1].toFixed(1)); c.setAttribute('visibility', 'visible');
    });
    el.tip.textContent = tipText(q.p, geo.hours, when(cur.key));
    el.tip.hidden = false;
    var tw = el.tip.offsetWidth || 170, left = q.x + 12;
    if (left + tw > geo.W - 2) left = q.x - 12 - tw;
    el.tip.style.left = Math.round(Math.max(2, left)) + 'px';
  }

  function blank() {
    el.svgbox.innerHTML = ''; el.legend.innerHTML = ''; el.csub.textContent = '';
    el.tiles.innerHTML = tilesHtml(figures(stats([])));
    geo = null; drawn = ''; hideTip();
  }

  // the room the chart has on screen, in pixels; null while the page is not laid out
  function plotSize() {
    var w = Math.floor(el.plot.clientWidth || 0), h = Math.floor(el.plot.clientHeight || 0);
    return w > 0 && h > 0 ? [Math.max(240, w), Math.max(180, h)] : null;
  }
  // draw the chosen curve, if it is not on screen already at this size
  function drawChart() {
    try { paint(); }
    catch (e) { blank(); say('Could not draw the chart (' + why(e) + ').'); }
  }
  function paint() {
    if (!cur || el.body.hidden) return;
    var z = plotSize();
    if (!z) return;                                // the next look draws it
    var sig = function (size) { return cur.key + '|' + size[0] + 'x' + size[1] + '|' + cur.mark + '|' + (year ? 1 : 0); };
    if (sig(z) === drawn) return;
    var st = stats(cur.pts), a = when(cur.key);
    if (!st.n) { blank(); drawn = sig(z); say('This charge\'s curve has no readings.'); return; }
    var label = 'Charging power and battery level' + (a ? ', charge of ' + day(a, year) + ' ' + hm(a) : '');
    var c = chartSvg(cur.pts, z[0], z[1], label);
    // the words around the chart first: they can change the room left for it
    el.csub.textContent = (st.n <= SHORT ? 'A very short record: ' : '') + st.n + (st.n === 1 ? ' reading' : ' readings') +
                          (st.span > 0 ? ' over ' + dur(st.span) : '') + (st.n > SHORT ? '. Tap or point at the chart to read one moment.' : '.');
    el.legend.innerHTML = legendHtml(c.geo);
    el.tiles.innerHTML = tilesHtml(figures(st));
    var z2 = plotSize();
    if (z2 && (z2[0] !== z[0] || z2[1] !== z[1])) { z = z2; c = chartSvg(cur.pts, z[0], z[1], label); }
    hideTip();
    el.svgbox.innerHTML = c.svg; geo = c.geo; drawn = sig(z); say('');
  }

  function markList() {
    Array.prototype.forEach.call(el.list.children, function (b, i) { b.setAttribute('aria-pressed', shown[i] === sel ? 'true' : 'false'); });
  }
  function renderList() {
    var html = keys.map(function (k, i) { return itemHtml(k, rowFor(k), i, year, readings[k]); }).join('');
    if (html !== listHtml) {
      // keep the place in the list, and the button the keyboard is on
      var top = el.list.scrollTop, act = io.root.activeElement, on = null;
      if (act && act.parentNode === el.list && act.getAttribute) on = shown[Number(act.getAttribute('data-i'))];
      el.list.innerHTML = html; listHtml = html;
      el.list.scrollTop = top;
      var at = typeof on === 'string' ? keys.indexOf(on) : -1;
      if (at >= 0 && el.list.children[at]) { try { el.list.children[at].focus({ preventScroll: true }); } catch (e) { /* not needed */ } }
    }
    shown = keys;
    el.count.textContent = countText(keys.length, total, rowsFailed);
    markList();
  }
  // bring the chosen charge into view in the list (only where the list scrolls by itself)
  function reveal() {
    var b = el.list.children[shown.indexOf(sel)];
    if (!b || !(el.list.scrollHeight > el.list.clientHeight + 1)) return;
    if (b.offsetTop < el.list.scrollTop || b.offsetTop + b.offsetHeight > el.list.scrollTop + el.list.clientHeight) {
      el.list.scrollTop = Math.max(0, b.offsetTop - 6);
    }
  }

  // one curve, from memory or from the store
  function curve(key) {
    if (cache[key]) return Promise.resolve(cache[key]);
    if (pending[key]) return pending[key];
    var g = gen;
    var p = ask('charge_curve', { charge_start: key }).then(function (r) {
      var pts = clean(r && r.points), c = { key: key, pts: pts, n: stats(pts).n, mark: mark(pts) };
      if (g === gen) { cache[key] = c; delete pending[key]; }
      var was = typeof readings[key] === 'number' && readings[key] <= SHORT;
      readings[key] = c.n;
      if (!dead && was !== (c.n <= SHORT) && keys && keys.indexOf(key) >= 0) renderList();
      return c;
    }, function (e) { if (g === gen) delete pending[key]; throw e; });
    pending[key] = p;
    return p;
  }

  // the curve of the chosen charge could not be read: say so (only that curve is asked for again, a while later)
  function curveFailed(key, e) {
    var gone = !!e && e.code === 'not_found';
    if (!gone) curveRetryAt = later(++curveFails);
    if (!gone && cur && cur.key === key) return;         // a re-read that failed: the curve already drawn stays
    cur = null; blank();
    say(gone ? 'No curve is stored for this charge.'
             : 'Could not read this charge\'s curve (' + why(e) + '). It will be tried again shortly.');
  }

  // show one charge. When it is the one already on screen (a re-read), its chart stays up until the new curve is in
  function show(key) {
    var mine = ++seq, c = cache[key];
    if (key !== sel) curveFails = 0;
    sel = key; picked = true; curveRetryAt = 0; markList();
    el.facts.textContent = factsText(key, rowFor(key), year);
    if (c) { curveFails = 0; cur = c; drawChart(); return; }
    if (!(cur && cur.key === key)) { cur = null; blank(); say('Loading the curve' + DOTS); }
    curve(key).then(function (got) {
      if (mine !== seq || dead) return;
      curveFails = 0; cur = got; drawChart();
    }, function (e) { if (mine === seq && !dead) curveFailed(key, e); });
  }

  // at the start: the newest charge whose curve has at least 3 readings, else the newest
  function pickFirst() {
    var mine = ++seq, list = keys, n = Math.min(list.length, SEARCH_MAX), i = 0, failed = 0;
    var take = function (k) { show(k); reveal(); };
    // the curves cannot be read just now: say so on the newest charge; the choice is made when a later try works
    var giveUp = function (e) {
      sel = list[0]; markList(); reveal();
      el.facts.textContent = factsText(sel, rowFor(sel), year);
      curveFailed(sel, e);
    };
    picked = false; curveRetryAt = 0;
    sel = null; cur = null; blank(); markList(); el.facts.textContent = ''; say('Loading the latest charge' + DOTS);
    (function next() {
      if (mine !== seq || dead) return;
      if (i >= n) { take(list[0]); return; }
      var k = list[i++];
      curve(k).then(function (c) {
        if (mine !== seq || dead) return;
        if (c.n >= 3) take(k); else next();
      }, function (e) {
        if (mine !== seq || dead) return;
        // a curve that has gone, or one that cannot be read, is passed over. No answer at all, or a second curve
        // that cannot be read, means the store is not answering: stop asking
        if (e && e.code === 'not_found') next();
        else if ((e && e.code === 'timeout') || ++failed > 1) giveUp(e);
        else next();
      });
    })();
  }

  // the two lists are in: k = which charges have a curve, c = the facts of the charges; each {ok, v} or {ok, e}
  function gotLists(k, c) {
    if (!k.ok) {
      var absent = !!k.e && k.e.code === 'unknown_command';
      retryAt = absent ? Date.now() + ABSENT_RETRY_MS : later(++listFails);
      if (absent) {
        keys = null; sel = null; cur = null; drawn = '';
        note('Zoomy is not loaded in Home Assistant, so there are no charge curves to show.');
      } else if (!keys || !keys.length) {
        note('Could not read the charge curves from Home Assistant (' + why(k.e) + '). It will be tried again shortly.');
      }
      return;                                            // with a list already on screen, a re-read that failed leaves it there
    }
    var seen = Object.create(null), nk = [];
    (k.v && Array.isArray(k.v.keys) ? k.v.keys : []).forEach(function (x) {
      if (typeof x === 'string' && x && !seen[x]) { seen[x] = true; nk.push(x); }
    });
    nk = nk.map(function (x, i) { var d = when(x); return { k: x, t: d ? d.getTime() : null, i: i }; })
           .sort(function (p, q) { return p.t !== null && q.t !== null ? (q.t - p.t || p.i - q.i) : p.t !== null ? -1 : q.t !== null ? 1 : p.i - q.i; })
           .map(function (o) { return o.k; });

    var got = c.ok && !!c.v && Array.isArray(c.v.rows), isRow = function (r) { return !!r && typeof r === 'object'; };
    if (got) { storeRows = c.v.rows.filter(isRow); storeAll = c.v.source !== 'snapshot'; listFails = 0; }
    else retryAt = later(++listFails);
    // the charges could not be read this time: those read before (if any)
    rows = storeRows || [];
    total = storeRows && storeAll ? storeRows.length : null; rowsFailed = !storeRows;
    byStart = Object.create(null); byTime = Object.create(null);
    rows.forEach(function (r) {
      if (typeof r.start !== 'string') return;
      if (!byStart[r.start]) byStart[r.start] = r;
      var d = when(r.start);
      if (d && !byTime[d.getTime()]) byTime[d.getTime()] = r;
    });
    var ys = Object.create(null), ny = 0;
    nk.forEach(function (x) { var d = when(x); if (d && !ys[d.getFullYear()]) { ys[d.getFullYear()] = true; ny++; } });
    year = ny > 1;

    gen++; cache = Object.create(null); pending = Object.create(null);     // a curve may have grown: read again when wanted
    keys = nk;
    if (!nk.length) {
      sel = null; cur = null; drawn = '';
      note(total ? (total === 1 ? 'The one charge has no curve yet.' : 'None of the ' + total + ' charges has a curve yet.') : 'No charge has a curve yet.');
      return;
    }
    el.note.hidden = true; el.body.hidden = false;
    renderList();
    if (picked && sel !== null && nk.indexOf(sel) >= 0) show(sel); else pickFirst();
  }

  // read the two lists again
  function refresh(sig) {
    busy = true; waitSig = null;
    var settle = function (p) { return p.then(function (v) { return { ok: true, v: v }; }, function (e) { return { ok: false, e: e }; }); };
    Promise.all([settle(ask('curve_keys')), settle(ask('charges'))]).then(function (r) {
      if (dead) return;
      busy = false; readSig = sig; retryAt = 0;
      try { gotLists(r[0], r[1]); }
      catch (e) { if (!keys || !keys.length || el.body.hidden) note('Could not show the charges (' + why(e) + ').'); }
    });
  }

  /* Looked at every few seconds, and at once when the car's subscription says something changed. The store is read
     again only when the car has sent charges or charge curves (or a while after a read that failed). */
  function look() {
    if (dead) return;
    SIGN = io.sign();
    var now = Date.now(), sig = io.sig(['charges', 'curves']);
    if (!busy) {
      if (readSig === null) { refresh(sig); return; }
      if (retryAt && now >= retryAt) { refresh(sig); return; }
      if (sig !== readSig) {
        // The car has sent something. Its posts come in a burst: the store is read a moment after the change is
        // seen, once for that burst.
        if (waitSig === null) { waitSig = sig; waitAt = now + SETTLE_MS; io.later(tick, SETTLE_MS + 20); }
        else if (now >= waitAt) { refresh(sig); return; }
      }
      if (curveRetryAt && now >= curveRetryAt && keys && keys.length && !el.body.hidden) {
        curveRetryAt = 0;
        if (picked && sel !== null) show(sel); else pickFirst();
      }
    }
    drawChart();
  }
  function tick() {
    try { look(); }
    catch (e) { if (keys === null) note('Could not show the charges (' + why(e) + ').'); }     // the next look tries again
  }

  // ---------- what the viewer does ----------

  el.list.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('button') : null;
    if (!b) return;
    var k = shown[Number(b.getAttribute('data-i'))];
    if (typeof k !== 'string') return;
    show(k);
    // on a phone the chart is above the list: go up to it
    try { if (io.narrow(760)) el.chartcard.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (err) { /* stay here */ }
  });
  function follow(e) {
    if (!geo) return;
    var r = el.plot.getBoundingClientRect();
    point(nearest(geo.P, e.clientX - r.left));
  }
  el.plot.addEventListener('pointerdown', follow);
  el.plot.addEventListener('pointermove', follow);
  el.plot.addEventListener('pointerleave', function (e) { if (e.pointerType !== 'touch') hideTip(); });
  el.plot.addEventListener('keydown', function (e) {
    if (!geo || !geo.P.length) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      var n = geo.P.length, step = e.key === 'ArrowRight' ? 1 : -1;
      e.preventDefault();
      point(hover < 0 ? (step > 0 ? 0 : n - 1) : Math.max(0, Math.min(n - 1, hover + step)));
    } else if (e.key === 'Escape') hideTip();
  });
  var rz = null;
  tick();
  io.every(tick, TICK_MS);

  return {
    changed: function () { tick(); },
    carChanged: function () { if (el.kick) el.kick.textContent = 'Zoomy \u00b7 ' + io.title(); },
    resized: function () { io.clear(rz); rz = io.later(drawChart, 150); },
    destroy: function () { dead = true; }
  };
}

class ZoomyChargeSheetCard extends ZoomyCard {
  static get css() { return CSS; }
  static get pageTitle() { return 'Charge sheet'; }
  makePage(io) { return makeChargeSheetPage(io); }
}

registerCard('zoomy-charge-sheet-card', ZoomyChargeSheetCard, 'Zoomy charge sheet',
  'One charge of a Zoomy car, minute by minute: charging power and battery level.');

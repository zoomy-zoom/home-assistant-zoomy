/* Zoomy charts: the whole history of the car's trips (zoomy-trips-card) or charges (zoomy-charges-card). For a
   chosen period (the last 30 days, one calendar month, or everything) it shows the totals, four charts and a table
   of every row.

   Ported from the HOME-styled charts.html of 14 Oct 2026 (an iframe page). The look, the words, the numbers and
   the maths are as there. What changed: it is a card (shadow DOM, no iframe); it reads zoomy/trips or
   zoomy/charges for the car it shows (the store's rows, or the car's latest upload when the store has none yet,
   source "snapshot"); it reads them again when the car's subscription says something changed (no sensor is
   watched, no attribute is read); the car's name and Home Assistant's currency sign replace the fixed car name and
   dollar sign; the screen-size rules follow the card's width (container queries), as they followed the iframe's.
   It holds no secrets, stores nothing in the browser and loads nothing from anywhere. */

import { ZoomyCard, registerCard, esc } from './core.js';

const CSS = `
  /* The page's own look, in HOME's colours (dark only, like HOME). The widths are as on the iframe page, so every
     chart is drawn at the same size and shows the same axis labels: the page's side padding 16 px and its 1500 px
     width, a chart card's side padding 14 px plus its 1 px border, and the 14 px gap between the charts. */
  :host { --fg: #f0f7ff; --muted: #9db6c9; --grid: #22353f; --card: #0c2232; --page: #050e17; --accent: #45ceff; --on: #04121c;
          --blue: #51c9ff; --green: #65e7ae; --amber: #ffc267; --violet: #c191ff; --red: #ff86c8; }
  .wrap { min-width: 300px; color: var(--fg); }
  .page { padding: 26px 16px 50px; max-width: 1500px; margin: 0 auto; }

  /* the heading: kicker, title and subtitle on the left, the car's last upload as a chip on the right, the totals under them */
  .head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-start; gap: 14px 20px; margin: 0 0 18px; }
  .head .title { order: 1; flex: 1 1 auto; min-width: 0; }
  .head .hs-chips { order: 2; min-width: 0; max-width: 100%; }
  .head .hs-chip { white-space: normal; overflow-wrap: anywhere; }
  .head .facts { order: 3; flex: 1 1 100%; min-width: 0; margin: 0; padding: 14px 18px; border: 1px solid var(--hs-accent-border);
                 border-radius: var(--hs-radius); background: radial-gradient(ellipse at 10% 0%, var(--hs-accent-wash), transparent 75%), var(--hs-accent-base);
                 box-shadow: inset 0 0 22px var(--hs-accent-halo), 0 0 20px var(--hs-accent-halo);
                 color: var(--hs-text); font-size: 15px; font-weight: 650; line-height: 1.45; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }

  /* the periods as HOME tabs; the chosen one lit like HOME's chosen sidebar item */
  .periods { display: flex; flex-wrap: wrap; gap: 4px; box-sizing: border-box; width: fit-content; max-width: 100%; margin: 0 0 16px; padding: 3px;
             border: 1px solid #2c4b5e; border-radius: 12px; background: #0b2030cc; }
  .page button { font: inherit; font-size: 12px; color: var(--hs-text); cursor: pointer; white-space: nowrap; }
  .periods button { min-height: 34px; padding: 7px 12px; border: 1px solid transparent; border-radius: 9px; background: none;
                    color: var(--hs-muted); transition: background .2s, color .2s; }
  .periods button:hover { background: #ffffff08; color: #fff; }
  .periods button[aria-pressed="true"] { border-color: #2e728c; background: #143849; color: var(--hs-teal);
                                         box-shadow: 0 0 22px #28b2ed18, inset 0 1px #6ad4ff23; }
  .page button:focus-visible { outline: 3px solid var(--hs-gold); outline-offset: 3px; }
  /* a warning as HOME's gold note, its button as a HOME button */
  .warn { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin: 0 0 14px; padding: 8px 12px;
          border: 1px solid #dba44555; border-radius: 10px; background: #dba44512; color: var(--hs-gold); font-size: 13px; overflow-wrap: anywhere; }
  .warn button { min-height: 34px; padding: 8px 13px; border: 1px solid #326b88; border-radius: 6px; background: #12364b;
                 transition: background .2s, transform .2s; }
  .warn button:hover { background: #1c4a63; transform: translateY(-1px); }

  /* the charts and the table as HOME's glass cards */
  .grid { display: grid; grid-template-columns: repeat(var(--cols, 1), minmax(0, 1fr)); gap: 14px; }
  .chart, .tablecard { position: relative; min-width: 0; border: 1px solid var(--hs-card-border); border-radius: var(--hs-radius);
                       background: var(--hs-card-bg); box-shadow: var(--hs-card-shadow); }
  .chart { padding: 18px 14px 14px; }
  .tablecard { margin-top: 14px; padding: 20px 22px; }
  .chart h2, .tablecard h2 { margin: 0 0 8px; padding-bottom: 10px; border-bottom: 1px solid var(--hs-rule); color: #d3e3ef;
                             font-size: 13px; font-weight: 650; letter-spacing: 1px; line-height: 1.5; text-transform: uppercase; }
  .sub { margin: 0 0 8px; color: var(--hs-muted); font-size: 12px; line-height: 1.5; }
  .chart > h2, .chart > .sub, .chart > .tip, .chart > .legend { margin-left: 8px; margin-right: 8px; }
  svg { width: 100%; height: auto; display: block; }
  svg text { fill: var(--hs-dim); font-size: 11px; }
  svg text.v { fill: var(--fg); }
  .bar { cursor: pointer; }
  .bar.on .hit { fill: var(--fg); fill-opacity: 0.09; }
  .tip { min-height: 17px; margin-top: 6px; color: var(--hs-text); font-size: 12px; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
  .legend { display: flex; gap: 6px 16px; flex-wrap: wrap; color: var(--hs-muted); font-size: 12px; margin-top: 4px; }
  .sw { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 6px; vertical-align: -1px; }

  /* the table: HOME's label colours for the column names, thin lines, numbers in even widths; only the table scrolls */
  .scroll { overflow: auto; max-height: max(320px, 72vh); margin-top: 4px; -webkit-overflow-scrolling: touch;
            scrollbar-color: var(--hs-line) transparent; scrollbar-width: thin; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; font-variant-numeric: tabular-nums; }
  th, td { padding: 7px 10px; text-align: right; white-space: nowrap; border-bottom: 1px solid #31526755; overflow-wrap: normal; }
  th { position: sticky; top: 0; z-index: 1; background: #0c2232; color: #c4d7e5; font-weight: 600; font-size: 12px;
       border-bottom: 0; box-shadow: inset 0 -1px 0 var(--hs-rule); }
  tbody tr:hover td { background: #ffffff08; }
  th.l, td.l { text-align: left; }
  td.day { font-weight: 600; }
  td.day.rep { font-weight: 400; color: var(--hs-dim); }
  tr:last-child td { border-bottom: 0; }
  .note { padding: 28px 8px; color: var(--hs-muted); overflow-wrap: anywhere; }

  /* a wide card: the totals beside the title (less height for the heading), the chip still at the top right */
  @container zoomy (min-width: 1151px) {
    .head .title { flex: 0 1 auto; }
    .head .facts { order: 2; flex: 1 1 360px; align-self: center; }
    .head .hs-chips { order: 3; }
  }
  /* HOME's screen sizes (top and bottom room only: the side room stays as before, see above) */
  @container zoomy (min-width: 1600px) { .page { padding-top: 28px; padding-bottom: 52px; } }
  @container zoomy (max-width: 1150px) { .page { padding-top: 22px; padding-bottom: 46px; } }
  @container zoomy (max-width: 800px) {
    .page { padding-top: 16px; padding-bottom: 40px; }
    .head .title { flex-basis: 100%; }
    .head .hs-chips { justify-content: flex-start; margin-top: 0; }
    .head .facts { padding: 12px 14px; font-size: 14px; }
    .chart > h2, .chart > .sub, .chart > .tip, .chart > .legend { margin-left: 4px; margin-right: 4px; }
    .tablecard { padding: 16px 18px; }
    .periods button, .warn button { min-height: 42px; padding: 10px 14px; font-size: 13px; }
  }
  @media (pointer: coarse) { .periods button, .warn button { min-height: 42px; padding: 10px 14px; font-size: 13px; } }
  @media (prefers-reduced-motion: reduce) { .page button { transition: none !important; } }
`;

/* The page for one car. mode: 'trips' or 'charges'. */
function makeChartsPage(io, MODE) {
  'use strict';
  io.box.innerHTML = '<div class="page" id="root"><div class="zcars" hidden></div><div id="top"></div><div id="main"><div class="note">Loading the car\'s history&hellip;</div></div></div>';
  // the heading (#top) and the rest (#main) are written separately: see paint()
  var root = io.root.getElementById('root'), elTop = io.root.getElementById('top'), elMain = io.root.getElementById('main');
  var dead = false;

  var DASH = '–', DOT = ' · ', TO = ' → ', DOTS = '…', DEG = '°';
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var EACH_MAX = 45;        // up to this many rows in the period: one bar per trip / charge
  var DAY_SPAN_MAX = 62;    // more rows than that: one bar per day up to this many days, otherwise one bar per month
  var TICK_MS = 5000;       // how often the page looks whether the car has sent something
  var SETTLE_MS = 1500;     // after a new upload, give the store a moment before reading it again
  var SLOW_MS = 4000;       // no history after this long: say it is still loading
  var GIVE_UP_MS = 30000;   // no history after this long: say it is not available (a later answer is still used)
  var NOTE_WAIT = '<div class="note">Loading the car\'s history' + DOTS + '</div>';
  var SIGN = '$';           // Home Assistant's currency sign (see draw)

  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
  function fx(v, d) {
    if (num(v) === null) return DASH;
    var s = v.toFixed(d);
    return +s === 0 && s.charAt(0) === '-' ? s.slice(1) : s;   // -0.4 to no decimals is 0, not -0
  }
  function big(v, d) {                       // like fx, with a comma every three digits: 1,234.5
    if (num(v) === null) return DASH;
    var p = fx(v, d).split('.');
    p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return p.join('.');
  }
  function money(v) { return num(v) === null ? DASH : (v <= -0.005 ? '-' + SIGN : SIGN) + big(Math.abs(v), 2); }
  function pct(v) { return num(v) === null ? DASH : fx(v, 0) + '%'; }
  function count(n, word) { return big(n, 0) + ' ' + word + (n === 1 ? '' : 's'); }
  function nb(s) { return s.replace(/ /g, ' '); }   // no line break inside: a number stays with its unit
  function text(v) {                         // free text from the app: one line, not endless (escaped where it is used)
    if (typeof v === 'number' && isFinite(v)) v = String(v);
    if (typeof v !== 'string') return '';
    v = v.replace(/\s+/g, ' ').trim();
    if (v.length <= 90) return v;
    v = v.slice(0, 89);
    if (/[\uD800-\uDBFF]$/.test(v)) v = v.slice(0, -1);   // not half of a two-part character (an emoji)
    return v + DOTS;
  }
  // dates are written by hand (not by the browser's locale tables) so they read the same everywhere: Wed, 14 Oct
  function day(d, yr) { return DOW[d.getDay()] + ', ' + d.getDate() + ' ' + MON[d.getMonth()] + (yr ? ' ' + d.getFullYear() : ''); }
  function dm(d) { return d.getDate() + '/' + (d.getMonth() + 1); }
  function hm(d) { return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
  function my(d) { return MON[d.getMonth()] + ' ' + d.getFullYear(); }
  function mkey(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2); }
  function dkey(d) { return mkey(d) + '-' + ('0' + d.getDate()).slice(-2); }
  function day0(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function daysApart(a, b) { return Math.round((day0(b) - day0(a)) / 86400000); }
  function mins(a, b) { return a && b ? Math.max(0, Math.round((b - a) / 60000)) : null; }
  function dur(m) {
    if (num(m) === null) return DASH;
    m = Math.max(0, Math.round(m));
    return m >= 60 ? Math.floor(m / 60) + ' h ' + (m % 60) + ' min' : m + ' min';
  }
  function when(x) { if (typeof x !== 'string' || !x) return null; var d = new Date(x); return isNaN(d) ? null : d; }
  function nice(max) {
    if (!(max > 0)) return 1;
    var p = Math.pow(10, Math.floor(Math.log10(max))), m = max / p;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
  }

  // ---- rows ---------------------------------------------------------------------------------------------------

  function trip(x) {
    var a = when(x.start), m = num(x.minutes), used = num(x.kwh_used), regen = num(x.kwh_regen), net = num(x.kwh_net);
    if (m === null) m = mins(a, when(x.end));
    if (net === null && used !== null) net = used - (regen || 0);
    return { a: a, m: m === null ? null : Math.max(0, Math.round(m)), km: num(x.km), net: net, regen: regen,
             eff: num(x.kwh_per_100km), s0: num(x.soc_start), s1: num(x.soc_end), out: num(x.outside_c) };
  }
  function charge(x) {
    var a = when(x.start), m = num(x.minutes), k = num(x.kwh_added), o = num(x.offpeak_kwh);
    if (m === null) m = mins(a, when(x.end));
    if (k !== null && o !== null) o = Math.max(0, Math.min(o, k));
    return { a: a, m: m === null ? null : Math.max(0, Math.round(m)), k: k, off: o, s0: num(x.soc_start), s1: num(x.soc_end),
             kw: num(x.avg_kw), cost: num(x.cost), type: text(x.type), place: text(x.place), why: text(x.breakdown) };
  }
  // raw rows (any order, any rubbish) -> tidy rows, oldest first, one per start time
  function tidy(raw, make) {
    var out = [], seen = {};
    (Array.isArray(raw) ? raw : []).forEach(function (x) {
      if (!x || typeof x !== 'object') return;
      var r = make(x), k = r.a ? r.a.getTime() : null;
      if (k === null || seen[k]) return;
      seen[k] = 1; out.push(r);
    });
    return out.sort(function (p, q) { return p.a - q.a; });
  }
  function monthsOf(rows) {                  // the calendar months that have rows, newest first
    var out = [], seen = {}, i, k;
    for (i = rows.length - 1; i >= 0; i--) {
      k = mkey(rows[i].a);
      if (!seen[k]) { seen[k] = 1; out.push({ key: k, label: my(rows[i].a) }); }
    }
    return out;
  }
  function pick(rows, period, now) {         // period: '30' (today and the 29 days before it), 'all', or a month '2026-10'
    if (period === 'all') return rows;
    if (period === '30') {
      var from = day0(now); from.setDate(from.getDate() - 29);
      return rows.filter(function (x) { return x.a >= from; });
    }
    return rows.filter(function (x) { return mkey(x.a) === period; });
  }

  function tsum(rows) {                      // totals for some trips
    var o = { n: rows.length, km: null, net: null, regen: null, m: null, eff: null, lo: null, hi: null }, pkm = 0, pnet = 0;
    rows.forEach(function (x) {
      if (x.km !== null) o.km = (o.km || 0) + x.km;
      if (x.net !== null) o.net = (o.net || 0) + x.net;
      if (x.regen !== null) o.regen = (o.regen || 0) + x.regen;
      if (x.m !== null) o.m = (o.m || 0) + x.m;
      if (x.km !== null && x.net !== null) { pkm += x.km; pnet += x.net; }
      range(o, x.s0); range(o, x.s1);
    });
    o.km = r6(o.km); o.net = r6(o.net); o.regen = r6(o.regen);
    if (pkm > 0) o.eff = r6(pnet) / r6(pkm) * 100;   // total net kWh / total km, over the trips that have both
    return o;
  }
  function csum(rows) {                      // totals for some charges
    var o = { n: rows.length, k: null, off: 0, cost: null, priced: 0, pk: 0, rate: null, m: null, kw: null, lo: null, hi: null };
    var wk = 0, wkw = 0, sk = 0, nk = 0, pcost = 0;
    rows.forEach(function (x) {
      if (x.k !== null) { o.k = (o.k || 0) + x.k; if (x.off !== null) o.off += x.off; }
      if (x.cost !== null) { o.cost = (o.cost || 0) + x.cost; o.priced++; if (x.k !== null) { o.pk += x.k; pcost += x.cost; } }
      if (x.m !== null) o.m = (o.m || 0) + x.m;
      if (x.kw !== null) { nk++; sk += x.kw; if (x.k > 0) { wk += x.k; wkw += x.kw * x.k; } }
      range(o, x.s0); range(o, x.s1);
    });
    o.k = r6(o.k); o.off = r6(o.off); o.cost = r6(o.cost); o.pk = r6(o.pk);
    o.kw = wk > 0 ? wkw / wk : nk ? sk / nk : null;      // average power, bigger charges counting for more
    if (o.pk > 0) o.rate = r6(pcost) / o.pk;             // money per kWh over the charges that have a cost
    return o;
  }
  function r6(v) { return v === null ? null : Math.round(v * 1e6) / 1e6; }   // a sum of decimals, without the stray 0.0000000001
  function range(o, s) { if (s !== null) { o.lo = o.lo === null ? s : Math.min(o.lo, s); o.hi = o.hi === null ? s : Math.max(o.hi, s); } }

  // what each bar stands for: every row when there are few, otherwise every day, otherwise every month.
  // sel is oldest first and not empty; days / months with nothing in them keep their place, empty
  function slots(sel, yr, sum) {
    var n = sel.length, first = sel[0].a, last = sel[n - 1].a, out = [], at = {}, by, d;
    var put = function (key) { return function (x) { var s = out[at[key(x.a)]]; if (s) s.rows.push(x); }; };
    if (n <= EACH_MAX) {
      by = 'each';
      out = sel.map(function (x) { return { rows: [x], lab: dm(x.a), sep: dkey(x.a), name: day(x.a, yr) + ' ' + hm(x.a) }; });
    } else if (daysApart(first, last) + 1 <= DAY_SPAN_MAX) {
      by = 'day';
      for (d = day0(first); d <= last; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
        at[dkey(d)] = out.length;
        out.push({ rows: [], lab: dm(d), name: day(d, yr) });
      }
      sel.forEach(put(dkey));
    } else {
      by = 'month';
      for (d = new Date(first.getFullYear(), first.getMonth(), 1); d <= last; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
        at[mkey(d)] = out.length;
        out.push({ rows: [], lab: MON[d.getMonth()] + (yr && (!out.length || d.getMonth() === 0) ? ' ' + d.getFullYear() : ''), name: my(d),
                   must: yr && d.getMonth() === 0 });             // where the year turns: this label is not to be dropped
      }
      sel.forEach(put(mkey));
    }
    out.forEach(function (s) { s.sum = sum(s.rows); });
    return { by: by, list: out };
  }

  // ---- drawing ------------------------------------------------------------------------------------------------

  // the charts are drawn at their real size on screen, so the lettering stays readable on a phone and on a wide screen
  var CW = 640;
  function measure() {
    var w = Math.max(260, (root.clientWidth || 0) - 32), cols = w >= 1500 ? 4 : w >= 760 ? 2 : 1;
    root.style.setProperty('--cols', cols);
    CW = Math.max(250, Math.floor((w - 14 * (cols - 1)) / cols) - 30);
  }

  function rect(x, y, w, h, color) {
    return '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="2" fill="' + color + '"/>';
  }
  // one bar chart: items oldest first; each has segs [{v, color}] (stacked) or lo/hi (a floating bar), a tip, an axis
  // label (lab, with must when it is not to be dropped for want of room) and, with o.seps, a day key (sep) for the
  // dashed day dividers. An item with a tip alone is an empty place (a day or month with nothing in it) that still
  // answers a hover or a tap. The colours come from this file, never from data.
  function chart(o) {
    var W = CW, H = 230, R = 12, T = 12, B = 30, ih = H - T - B, n = o.items.length, min = o.min || 0, peak = 0;
    o.items.forEach(function (it) {
      var v = it.segs ? it.segs.reduce(function (a, sg) { return a + (sg.v > 0 ? sg.v : 0); }, 0)
                      : (num(it.lo) !== null && num(it.hi) !== null ? Math.max(it.lo, it.hi) : 0);
      if (v > peak) peak = v;
    });
    if (num(o.avg) !== null && o.avg > peak) peak = o.avg;
    var top = num(o.max) !== null ? o.max : nice(peak > 0 && peak < 0.01 ? 0.01 : peak), span = top - min;
    var mant = span / Math.pow(10, Math.floor(Math.log10(span)));
    var divs = Math.abs(mant - 2) < 1e-9 ? 4 : 5, dec = Math.max(0, -Math.floor(Math.log10(span / divs) + 1e-9));
    var L = Math.max(38, Math.ceil(10 + 6.4 * top.toFixed(dec).length)), iw = W - L - R;
    var y = function (v) { return T + ih - (Math.max(min, Math.min(top, v)) - min) / span * ih; };
    var bw = iw / Math.max(n, 1), w = Math.max(Math.min(3, bw * 0.9), Math.min(28, bw * 0.66));
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(o.title) + '">';
    for (var g = 0; g <= divs; g++) {
      var gv = min + span * g / divs, gy = y(gv);
      s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + gy.toFixed(1) + '" y2="' + gy.toFixed(1) + '" stroke="var(--grid)" stroke-width="1"/>' +
           '<text x="' + (L - 6) + '" y="' + (gy + 4).toFixed(1) + '" text-anchor="end">' + gv.toFixed(dec) + '</text>';
    }
    var lastSep = null, labs = [], spots = [];
    o.items.forEach(function (it, i) {
      var x0 = L + bw * i, x = x0 + (bw - w) / 2, cx = x0 + bw / 2;
      if (it.tip) {
        // one group per bar: its tooltip, a see-through strip the height of the chart (easy to hover or tap), the bar
        s += '<g class="bar"><title>' + esc(it.tip) + '</title><rect class="hit" x="' + x0.toFixed(1) + '" y="' + T + '" width="' + bw.toFixed(1) +
             '" height="' + ih + '" fill="none" pointer-events="all"/>';
        if (it.segs) {
          var base = min;
          it.segs.forEach(function (sg) {
            if (!(sg.v > 0)) return;
            var b = y(base), h = Math.max(1, b - y(base + sg.v));   // at least 1 px, standing on its base (not hanging below it)
            s += rect(x, b - h, w, h, sg.color);
            base += sg.v;
          });
        } else if (num(it.lo) !== null && num(it.hi) !== null) {
          var y1 = y(Math.max(it.lo, it.hi)), fh = Math.max(2, y(Math.min(it.lo, it.hi)) - y1);
          s += rect(x, Math.min(y1, T + ih - fh), w, fh, it.color);   // a mark at 0% stays above the bottom line
        }
        s += '</g>';
      }
      if (o.seps) {
        if (it.sep === lastSep) return;
        lastSep = it.sep;
        if (i > 0) s += '<line x1="' + x0.toFixed(1) + '" x2="' + x0.toFixed(1) + '" y1="' + T + '" y2="' + (T + ih + 4) + '" stroke="var(--grid)" stroke-width="1" stroke-dasharray="2 3"/>';
      }
      if (it.lab) labs.push({ t: String(it.lab), cx: cx, must: !!it.must });
    });
    // the axis labels that have room, left to right; the ones that must show take their places first
    [true, false].forEach(function (must) {
      labs.forEach(function (l) {
        if (l.must !== must) return;
        var half = l.t.length * 3.2, lx = Math.min(l.cx, W - half - 2), a = lx - half, b = lx + half;
        if (spots.some(function (p) { return a <= p[1] + 5 && b >= p[0] - 5; })) return;
        spots.push([a, b]);
        s += '<text x="' + lx.toFixed(1) + '" y="' + (H - 10) + '" text-anchor="middle">' + esc(l.t) + '</text>';
      });
    });
    if (num(o.avg) !== null) {
      var ay = y(o.avg);
      s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + ay.toFixed(1) + '" y2="' + ay.toFixed(1) + '" stroke="var(--amber)" stroke-width="1.5" stroke-dasharray="6 4"/>' +
           '<text class="v" x="' + (W - R - 2) + '" y="' + (ay - 5).toFixed(1) + '" text-anchor="end">' + esc(o.avgLabel) + '</text>';
    }
    s += '</svg>';
    var lg = (o.legend || []).map(function (l) { return '<span><span class="sw" style="background:' + l[0] + '"></span>' + esc(l[1]) + '</span>'; }).join('');
    return '<div class="chart"><h2>' + esc(o.title) + '</h2><div class="sub">' + esc(o.sub || '') + '</div>' + s +
           '<div class="tip" aria-live="polite"></div>' + (lg ? '<div class="legend">' + lg + '</div>' : '') + '</div>';
  }

  // heads: column names; left: {column number: 1} for the columns that read from the left; rows: arrays of plain text
  // (everything is escaped here), the date first. Built as one string, so hundreds of rows cost one write to the page.
  function table(title, sub, heads, left, rows) {
    var cls = heads.map(function (x, i) { return left[i] ? ' class="l"' : ''; });
    var h = ['<div class="tablecard"><h2>' + esc(title) + '</h2><div class="sub">' + esc(sub) + '</div><div class="scroll"><table><thead><tr>'];
    heads.forEach(function (x, i) { h.push('<th' + cls[i] + '>' + esc(x) + '</th>'); });
    h.push('</tr></thead><tbody>');
    var last = null;
    rows.forEach(function (r) {
      h.push('<tr><td class="l day' + (r[0] === last ? ' rep' : '') + '">' + esc(r[0]) + '</td>');
      for (var i = 1; i < heads.length; i++) h.push('<td' + cls[i] + '>' + esc(r[i]) + '</td>');
      h.push('</tr>');
      last = r[0];
    });
    h.push('</tbody></table></div></div>');
    return h.join('');
  }

  function head(mode, facts) {
    var car = io.title();
    // the HOME heading (kicker, title, subtitle), then the totals, then the car's last upload as a chip (HOME look)
    return '<div class="head"><div class="title"><p class="hs-kicker">' + esc('Zoomy · ' + car) + '</p><h1 class="hs-title">ZOOMY <em>&mdash; ' +
           (mode === 'charges' ? 'Charges' : 'Trips') + '</em></h1><p class="hs-sub">' +
           esc('Every ' + car + (mode === 'charges' ? ' charge' : ' trip') + ': totals, charts and a full table') + '</p></div>' +
           (facts ? '<p class="facts main hs-accent-car">' + esc(facts) + '</p>' : '') + '<div class="hs-chips"><span class="hs-chip is-status">' +
           esc(io.sent()) + '</span></div></div>';
  }

  var period = '30';                         // which period is showing; kept only while the page is open
  function buttons(months) {
    var b = function (key, label) {
      return '<button type="button" data-p="' + esc(key) + '" aria-pressed="' + (key === period ? 'true' : 'false') + '">' + esc(label) + '</button>';
    };
    return '<div class="periods" role="group" aria-label="Period">' + b('30', 'Last 30 days') +
           months.map(function (m) { return b(m.key, m.label); }).join('') + b('all', 'All') + '</div>';
  }
  function warn(v) {
    return v.note ? '<div class="warn"><span>' + esc(v.note) + '</span>' + (v.retry ? '<button type="button" data-again="1">Try again</button>' : '') + '</div>' : '';
  }
  function safe(f, cls) {                    // one part that cannot be drawn must not take the rest with it
    try { return f(); }
    catch (e) { return '<div class="' + cls + '"><div class="note">Could not draw this part: ' + esc(e && e.message ? e.message : e) + '</div></div>'; }
  }
  // the places of a chart, filled by f(slot, its totals, its first row); a day / month with nothing in it keeps its
  // place, with no bar and a tooltip that says so (word: trip or charge)
  function bars(sl, word, f) {
    return sl.list.map(function (s) {
      var o = s.rows.length ? f(s, s.sum, s.rows[0]) : { tip: s.name + ': no ' + word + 's' };
      o.lab = s.lab; o.sep = s.sep; o.must = s.must;
      return o;
    });
  }
  function socs(x) { return x.s0 === null && x.s1 === null ? DASH : fx(x.s0, 0) + TO + fx(x.s1, 0); }
  // a floating battery bar: from / to for one row, lowest / highest for a group; one known end alone draws a small mark
  function fromTo(a, b, color, tip) {
    if (a === null) a = b;
    if (b === null) b = a;
    return { lo: a, hi: b, color: color, tip: tip };
  }

  function tripsView(sel, sl, yr, where) {
    var t = tsum(sel), each = sl.by === 'each', per = each ? 'trip' : sl.by;
    var tip = function (s, txt) { return s.name + (each ? '' : ', ' + count(s.sum.n, 'trip')) + ': ' + txt; };
    var facts = [count(t.n, 'trip'), big(t.km, 0) + ' km', big(t.net, 1) + ' kWh net'];
    if (t.eff !== null) facts.push(fx(t.eff, 1) + ' kWh/100 km average');
    if (t.m !== null) facts.push(dur(t.m) + ' driving');
    var charts = [
      function () { return chart({ title: 'Distance', sub: each ? 'km per trip, oldest on the left' : 'km per ' + per, seps: each,
        items: bars(sl, 'trip', function (s, a) { return { segs: [{ v: a.km || 0, color: 'var(--blue)' }], tip: tip(s, big(a.km, 1) + ' km in ' + dur(a.m)) }; }) }); },
      function () { return chart({ title: 'Consumption', sub: 'kWh per 100 km, each ' + per, seps: each,
        avg: t.eff, avgLabel: t.eff !== null ? 'average ' + fx(t.eff, 1) : '',
        items: bars(sl, 'trip', function (s, a, x) { var e = each ? x.eff : a.eff;
          return { segs: [{ v: e || 0, color: 'var(--violet)' }], tip: tip(s, fx(e, 1) + ' kWh/100 km over ' + big(a.km, 1) + ' km') }; }) }); },
      function () { return chart({ title: 'Energy', sub: 'kWh per ' + per + ': taken from the battery, and put back by regen', seps: each,
        legend: [['var(--blue)', 'Net from battery'], ['var(--green)', 'Recovered by regen']],
        items: bars(sl, 'trip', function (s, a) { return { segs: [{ v: a.net || 0, color: 'var(--blue)' }, { v: a.regen || 0, color: 'var(--green)' }],
          tip: tip(s, big(a.net, 2) + ' kWh net, ' + big(a.regen, 2) + ' kWh regen') }; }) }); },
      function () { return chart({ title: 'Battery', sub: each ? '% at the start and end of each trip' : 'lowest and highest % each ' + per, min: 0, max: 100, seps: each,
        items: bars(sl, 'trip', function (s, a, x) {
          return each ? fromTo(x.s1, x.s0, 'var(--amber)', tip(s, pct(x.s0) + ' to ' + pct(x.s1)))
                      : fromTo(a.lo, a.hi, 'var(--amber)', tip(s, 'lowest ' + pct(a.lo) + ', highest ' + pct(a.hi))); }) }); }
    ];
    var temp = sel.some(function (x) { return x.out !== null; });
    var heads = ['Date', 'Time', 'Duration', 'km', 'kWh/100 km', 'Net kWh', 'Regen kWh', 'Battery %'];
    if (temp) heads.push('Outside ' + DEG + 'C');
    return { facts: facts.map(nb).join(DOT), charts: charts, table: function () {
      return table('Trips', 'The ' + count(sel.length, 'trip') + ' ' + where + ', newest first', heads, { 0: 1, 1: 1 },
        sel.slice().reverse().map(function (x) {
          return [day(x.a, yr), hm(x.a), dur(x.m), fx(x.km, 1), fx(x.eff, 1), fx(x.net, 2), fx(x.regen, 2), socs(x), fx(x.out, 0)];
        }));
    } };
  }

  function chargesView(sel, sl, yr, where) {
    var c = csum(sel), each = sl.by === 'each', per = each ? 'charge' : sl.by;
    var tip = function (s, txt) { return s.name + (each ? '' : ', ' + count(s.sum.n, 'charge')) + ': ' + txt; };
    var unpriced = function (a) { return a.n - a.priced; };
    var facts = [count(c.n, 'charge'), big(c.k, 1) + ' kWh added'];
    facts.push(c.priced ? money(c.cost) + (unpriced(c) ? ' (' + unpriced(c) + ' without a price)' : '') : 'no prices');
    if (c.k > 0) facts.push(fx(c.off / c.k * 100, 0) + '% off-peak');
    if (c.rate !== null) facts.push(money(c.rate) + ' per kWh on average');
    var charts = [
      function () { return chart({ title: 'Energy added', sub: 'kWh per ' + per + ', split by off-peak', seps: each,
        legend: [['var(--green)', 'Off-peak'], ['var(--amber)', 'Other times']],
        items: bars(sl, 'charge', function (s, a, x) { var k = a.k || 0, kind = [x.type, x.place].filter(Boolean).join(DOT);
          return { segs: [{ v: a.off, color: 'var(--green)' }, { v: Math.max(0, k - a.off), color: 'var(--amber)' }],
                   tip: tip(s, big(a.k, 1) + ' kWh, ' + big(each ? x.off : a.off, 1) + ' kWh off-peak' + (each ? ' (' + (kind || 'charger not named') + ')' : '')) }; }) }); },
      function () { return chart({ title: 'Cost', sub: SIGN + ' per ' + per, seps: each,
        items: bars(sl, 'charge', function (s, a) { return { segs: [{ v: a.cost || 0, color: 'var(--red)' }],
          tip: tip(s, a.priced ? money(a.cost) + ' for ' + big(a.pk, 1) + ' kWh' + (unpriced(a) ? ', ' + unpriced(a) + ' without a price' : '') : 'no price') }; }) }); },
      function () { return chart({ title: 'Battery', sub: each ? '% at the start and end of each charge' : 'lowest and highest % each ' + per, min: 0, max: 100, seps: each,
        items: bars(sl, 'charge', function (s, a, x) {
          return each ? fromTo(x.s0, x.s1, 'var(--blue)', tip(s, pct(x.s0) + ' to ' + pct(x.s1)))
                      : fromTo(a.lo, a.hi, 'var(--blue)', tip(s, 'lowest ' + pct(a.lo) + ', highest ' + pct(a.hi))); }) }); },
      function () { return chart({ title: 'Charging power', sub: each ? 'average kW for each charge' : 'average kW each ' + per + ' (bigger charges count for more)', seps: each,
        items: bars(sl, 'charge', function (s, a) { return { segs: [{ v: a.kw || 0, color: 'var(--violet)' }], tip: tip(s, fx(a.kw, 1) + ' kW average over ' + dur(a.m)) }; }) }); }
    ];
    return { facts: facts.map(nb).join(DOT), charts: charts, table: function () {
      return table('Charges', 'The ' + count(sel.length, 'charge') + ' ' + where + ', newest first',
        ['Date', 'Time', 'Duration', 'kWh', 'Battery %', 'Avg kW', 'Type', 'Place', 'Off-peak %', 'Cost', 'Cost breakdown'], { 0: 1, 1: 1, 6: 1, 7: 1, 10: 1 },
        sel.slice().reverse().map(function (x) {
          return [day(x.a, yr), hm(x.a), dur(x.m), fx(x.k, 1), socs(x), fx(x.kw, 1), x.type || DASH, x.place || DASH,
                  x.k > 0 && x.off !== null ? fx(x.off / x.k * 100, 0) : DASH, money(x.cost), x.why || DASH];
        }));
    } };
  }

  // the whole page for one kind of row, as its heading and the rest: v.rows oldest first, v.partial when they are
  // only the car's latest upload
  function page(mode, v, now) {
    var word = mode === 'charges' ? 'charge' : 'trip', rows = v.rows;
    if (!rows.length) {
      return { head: head(mode, ''), body: warn(v) + '<div class="note">No ' + word + 's in the car\'s ' + (v.partial ? 'latest upload' : 'history') + ' yet.</div>' };
    }
    var months = monthsOf(rows);
    if (period !== '30' && period !== 'all' && !months.some(function (m) { return m.key === period; })) period = '30';
    var sel = pick(rows, period, now);
    if (!sel.length) {
      return { head: head(mode, 'Last 30 days: no ' + word + 's'), body: warn(v) + buttons(months) +
               '<div class="note">No ' + word + 's in the last 30 days. Pick a month above, or All.</div>' };
    }
    var first = sel[0].a, yr = first.getFullYear() !== sel[sel.length - 1].a.getFullYear();
    var name = period === '30' ? 'Last 30 days' : period === 'all' ? 'Since ' + first.getDate() + ' ' + my(first) : my(first);
    var where = period === '30' ? 'in the last 30 days' : period === 'all' ? (v.partial ? 'in the car\'s latest upload' : 'on record') : 'in ' + my(first);
    var b = mode === 'charges' ? chargesView(sel, slots(sel, yr, csum), yr, where) : tripsView(sel, slots(sel, yr, tsum), yr, where);
    return { head: head(mode, nb(name) + ': ' + b.facts), body: warn(v) + buttons(months) +
             '<div class="grid">' + b.charts.map(function (f) { return safe(f, 'chart'); }).join('') + '</div>' + safe(b.table, 'tablecard') };
  }

  // ---- reading ------------------------------------------------------------------------------------------------

  // the newest read of the store. rows = the history as last read (tidy), kept while a newer read is on its way or has
  // failed; partial = those rows are only the car's latest upload (the store has none yet); state = loading / ok /
  // failed; since = when the wait for an answer began. A new upload while the store has still not answered starts a
  // new read but not a new wait: otherwise a store that never answers, with the car uploading every few seconds,
  // would leave "Loading" on the page for good.
  var store = { trips: null, charges: null }, reads = 0;
  function read(mode, usig, delay) {
    var prev = store[mode], make = mode === 'charges' ? charge : trip, waiting = !!prev && prev.state === 'loading';
    if (prev) prev.stop();                   // its timers are done with (its answer, if still on its way, is weighed below)
    var s = store[mode] = { id: ++reads, sig: usig, state: 'loading', rows: prev ? prev.rows : null, partial: prev ? prev.partial : false,
      rowsId: prev ? prev.rowsId : 0, since: waiting ? prev.since : Date.now(), slow: waiting && prev.slow,
      prevFailed: !!prev && (prev.state === 'failed' || (waiting && prev.prevFailed)) };
    var left = function (ms) { return Math.max(0, s.since + ms - Date.now()); }, timers = [];
    var fail = function () { if (store[mode] === s && s.state === 'loading') { s.state = 'failed'; draw(); } };
    s.stop = function () { timers.forEach(io.clear); timers = []; };
    var go = function () {
      if (store[mode] !== s || dead) return;
      // a late answer is still used (see GIVE_UP_MS): the question itself is given up only after much longer
      io.ask(mode, null, GIVE_UP_MS * 4).then(function (res) {
        if (dead) return;
        var cur = store[mode], rows = res && Array.isArray(res.rows) ? tidy(res.rows, make) : null, partial = !!res && res.source === 'snapshot';
        if (cur === s) {
          s.stop();
          if (rows) { s.rows = rows; s.partial = partial; s.rowsId = s.id; s.state = 'ok'; s.prevFailed = false; } else s.state = 'failed';
        } else if (rows && cur && s.id > cur.rowsId) {
          // a newer read is still out, or has failed: these rows are newer than the ones it holds, so use them
          cur.rows = rows; cur.partial = partial; cur.rowsId = s.id;
          if (cur.state === 'loading') cur.prevFailed = false;
        } else return;
        draw();
      }, function () { if (!dead) fail(); });
    };
    timers.push(io.later(function () { if (store[mode] === s && s.state === 'loading' && !s.slow) { s.slow = true; draw(); } }, left(SLOW_MS)));
    timers.push(io.later(fail, left(GIVE_UP_MS)));
    if (delay > 0) timers.push(io.later(go, delay)); else go();
    return s;
  }

  // what to show for one read: the rows when there are some, with a note when they are old or only the latest upload
  function view(mode, s) {
    var failed = s.state === 'failed' || (s.state === 'loading' && s.prevFailed);
    if (s.rows && s.rows.length) {
      return { rows: s.rows, partial: !!s.partial, retry: failed,
               note: failed ? 'The history could not be refreshed: these are the rows read earlier.'
                     : s.partial ? 'Showing the car\'s latest upload only: the full history is empty so far.' : null };
    }
    if (failed) return { rows: [], partial: false, retry: true, note: 'The history could not be read from Home Assistant.' };
    if (s.state === 'loading') return { wait: true };
    return { rows: [], partial: !!s.partial, note: null };
  }

  var shown = null, painted = null, paintedHead = null, paintedKey = null;
  // The heading and the rest are written separately, each only when it has changed. The "Car last sent" time moves
  // with every upload: rewriting the charts and the table for that would drop the numbers of a tapped bar, close a
  // tooltip and stop a table scroll in mid-flick.
  function paint(headHtml, html, key) {
    if (headHtml !== paintedHead) { elTop.innerHTML = headHtml; paintedHead = headHtml; }
    if (html === painted) return;
    var keep = key === paintedKey && elMain.querySelector, box = keep ? elMain.querySelector('.scroll') : null;
    var y = box ? box.scrollTop : 0, x = box ? box.scrollLeft : 0;
    var act = io.root.activeElement, p = act && act.getAttribute ? act.getAttribute('data-p') : null;
    elMain.innerHTML = html; painted = html; paintedKey = key;
    try {
      box = keep ? elMain.querySelector('.scroll') : null;
      if (box) { box.scrollTop = y; box.scrollLeft = x; }               // the table stays where it was scrolled to
      if (p) {                                                          // and the keyboard stays on the period button
        Array.prototype.forEach.call(elMain.querySelectorAll('button[data-p]'), function (b) {
          if (b.getAttribute('data-p') === p) b.focus({ preventScroll: true });
        });
      }
    } catch (e) { /* cosmetic only */ }
  }
  // the store is read again when the car has sent rows of this kind or a new snapshot (its latest 20 rows)
  function usigNow() { return io.sig([MODE, 'snapshot']); }
  function sigNow(mode, s) {
    return [mode, CW, period, s.id, s.sig, s.state, s.rowsId, s.slow ? 1 : 0, io.sent(), io.title(), SIGN, dkey(new Date())].join('|');
  }
  function draw() {
    if (dead) return;
    var mode = MODE, usig = usigNow(), s = store[mode];
    if (!s || s.sig !== usig) s = read(mode, usig, s ? SETTLE_MS : 0);   // the store is read again only when the car has sent something
    SIGN = io.sign();
    measure();
    if (sigNow(mode, s) === shown) return;
    var out;
    try { var v = view(mode, s); out = v.wait ? { head: head(mode, ''), body: NOTE_WAIT } : page(mode, v, new Date()); }
    catch (e) { out = { head: paintedHead || '', body: '<div class="note">Could not draw the charts: ' + esc(e && e.message ? e.message : e) + '</div>' }; }
    paint(out.head, out.body, mode + '|' + period);
    shown = sigNow(mode, s);
  }

  function onClick(ev) {
    var t = ev.target;
    if (!t || !t.closest) return;
    var b = t.closest('button');
    if (b) {
      var p = b.getAttribute('data-p');
      if (p !== null) { if (/^(30|all|\d{4}-\d{2})$/.test(p)) { period = p; shown = null; draw(); } }
      else if (b.getAttribute('data-again') !== null) { read(MODE, usigNow(), 0); shown = null; draw(); }
      return;
    }
    // a tap on a bar writes its numbers under the chart (a phone has no hover for the tooltip)
    var g = t.closest('g.bar'), card = g ? g.closest('.chart') : null;
    if (!card) return;
    var out = card.querySelector('.tip'), ti = g.querySelector('title'), old = card.querySelector('g.bar.on');
    if (old) old.classList.remove('on');
    g.classList.add('on');
    if (out && ti) out.textContent = ti.textContent;
  }
  elMain.addEventListener('click', onClick);
  var rz = null;
  draw();
  io.every(draw, TICK_MS);

  return {
    changed: function () { draw(); },
    hass: function () { /* the heading's "Car last sent" is redrawn at the next look */ },
    carChanged: function () { shown = null; draw(); },
    resized: function () { io.clear(rz); rz = io.later(function () { shown = null; draw(); }, 150); },
    destroy: function () { dead = true; elMain.removeEventListener('click', onClick); }
  };
}

class ZoomyTripsCard extends ZoomyCard {
  static get css() { return CSS; }
  static get pageTitle() { return 'Trips'; }
  makePage(io) { return makeChartsPage(io, 'trips'); }
}
class ZoomyChargesCard extends ZoomyCard {
  static get css() { return CSS; }
  static get pageTitle() { return 'Charges'; }
  makePage(io) { return makeChartsPage(io, 'charges'); }
}

registerCard('zoomy-trips-card', ZoomyTripsCard, 'Zoomy trips', 'Every trip of a Zoomy car: totals, charts and a full table.');
registerCard('zoomy-charges-card', ZoomyChargesCard, 'Zoomy charges', 'Every charge of a Zoomy car: totals, charts and a full table.');

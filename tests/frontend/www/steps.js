/* The steps and snapshots of the compare group (compare.html), shared by the host of an original page (old-host.html)
   and the host of a new card (new-host.html), so both are driven and read the same way.
   Steps: ['wait', ms] ['snap', label] ['click', selector, index] ['bar', chart index, bar index]
          ['point', selector, share of the width] ['fitH', chart height in px]
   Snapshot: the words on screen (the heading aside: h1, kicker, subtitle), the words drawn in the charts, the
   tooltips, the labels, the pressed buttons and the charts' sizes. */
window.ZoomySteps = (function () {
  'use strict';
  function norm(s) { return String(s).replace(/\s+/g, ' ').trim(); }

  /* ctx: { root(): Document | ShadowRoot, win: the window the page lives in, resize(dh): make the room dh px taller } */
  function make(ctx, result) {
    function all(sel) { return Array.prototype.slice.call(ctx.root().querySelectorAll(sel)); }
    function texts(which) {
      var root = ctx.root(), out = [];
      var start = root.body || root, w = (root.ownerDocument || root).createTreeWalker(start, NodeFilter.SHOW_TEXT), n;
      while ((n = w.nextNode())) {
        var el = n.parentElement;
        if (!el || el.closest('script, style, title, .zcars')) continue;
        if (el.closest('h1, .hs-kicker, .hs-sub')) continue;
        var drawn = el.checkVisibility({ visibilityProperty: true }), inSvg = !!el.closest('svg');
        if (which === 'shown' && (!drawn || inSvg)) continue;
        if (which === 'svg' && (!drawn || !inSvg)) continue;
        if (norm(n.data)) out.push(norm(n.data));
      }
      return norm(out.join(' '));
    }
    function snap(label) {
      result.snaps.push({
        label: label, shown: texts('shown'), svg: texts('svg'),
        sizes: all('svg[viewBox]').map(function (s) { return s.getAttribute('viewBox'); }).join(' / '),
        titles: all('svg title').map(function (e) { return norm(e.textContent); }).join(' / '),
        pressed: all('[aria-pressed="true"]').filter(function (e) { return !e.closest('.zcars'); }).map(function (e) { return norm(e.textContent).slice(0, 40); }).join(' / ')
      });
    }
    function point(sel, frac) {
      var el = ctx.root().querySelector(sel);
      if (!el) { result.errors.push('no ' + sel); return; }
      var r = el.getBoundingClientRect(), x = r.left + r.width * frac, y = r.top + r.height / 2;
      ['pointerdown', 'pointermove'].forEach(function (t) {
        el.dispatchEvent(new ctx.win.PointerEvent(t, { bubbles: true, composed: true, clientX: x, clientY: y, pointerType: 'mouse' }));
      });
    }
    function click(sel, i) {
      var el = all(sel)[i || 0];
      if (!el) { result.errors.push('nothing to click: ' + sel + ' #' + (i || 0)); return; }
      el.dispatchEvent(new ctx.win.MouseEvent('click', { bubbles: true, composed: true }));
    }
    function bar(chart, i) {
      var c = all('.chart')[chart], g = c ? c.querySelectorAll('g.bar')[i] : null;
      if (!g) { result.errors.push('no bar ' + chart + '/' + i); return; }
      g.querySelector('rect.hit').dispatchEvent(new ctx.win.MouseEvent('click', { bubbles: true, composed: true }));
    }
    // make the room taller or shorter until the first chart is drawn target px high, so old and new compare charts of one size
    function fitH(target, tries, done) {
      var svg = ctx.root().querySelector('svg[viewBox]'), h = svg ? Number(svg.getAttribute('viewBox').split(' ')[3]) : NaN;
      if (h === target || !(tries > 0) || !isFinite(h)) { if (h !== target) result.errors.push('chart height ' + h + ', wanted ' + target); done(); return; }
      ctx.resize(target - h);
      setTimeout(function () { fitH(target, tries - 1, done); }, 700);
    }
    function run(steps, k, done) {
      if (k >= steps.length) { done(); return; }
      var s = steps[k], next = function (ms) { setTimeout(function () { run(steps, k + 1, done); }, ms || 0); };
      try {
        if (s[0] === 'wait') return next(s[1]);
        if (s[0] === 'fitH') return fitH(s[1], 14, function () { next(0); });
        if (s[0] === 'snap') snap(s[1]);
        else if (s[0] === 'click') click(s[1], s[2]);
        else if (s[0] === 'bar') bar(s[1], s[2]);
        else if (s[0] === 'point') point(s[1], s[2]);
      } catch (e) { result.errors.push(String(s[0]) + ': ' + (e && e.message ? e.message : e)); }
      next(0);
    }
    return { run: run };
  }

  // the old pages' Home Assistant: sensors as the template sensors had them, zoomy_store/... answered from the same data
  function oldHass(fake, entryId) {
    var car = fake.car(entryId), d = car.d, st = fake.hass.states, ids = car.ids;
    var u = st[ids.last_update];
    var states = {
      'sensor.zoomy_last_update': { state: u.state, last_updated: u.last_updated, attributes: { version: st[ids.app_version].state } },
      'sensor.zoomy_trips': { state: '20', last_updated: u.last_updated, attributes: { trips: d.trips.slice(-20).reverse() } },
      'sensor.zoomy_charges': { state: '20', last_updated: u.last_updated, attributes: { charges: d.charges.slice(-20).reverse() } },
      'sensor.zoomy_snapshot_extras': { state: 'ok', last_updated: u.last_updated, attributes: { runs: d.runs, health: d.health } }
    };
    return {
      states: states,
      themes: { darkMode: true },
      callWS: function (msg) {
        var m = Object.assign({}, msg);
        if (/^zoomy_store\//.test(m.type)) m.type = 'zoomy/' + m.type.slice('zoomy_store/'.length);
        m.entry_id = entryId;
        return fake.hass.callWS(m);
      }
    };
  }
  return { make: make, oldHass: oldHass };
})();

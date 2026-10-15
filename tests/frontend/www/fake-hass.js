/* A stand-in for Home Assistant, for the Zoomy cards under test in a browser: states, the zoomy/... websocket
   answers and a websocket connection with subscriptions, all made up from a fixed seed.
   Made-up numbers only: no real place, person, car or id. Routes wander around latitude 10, longitude 20.

   FakeHass.make(opts) gives a fake hass object plus helpers:
     opts.cars      [{entry_id, title, slug, seed}]   (default: one car "Test car")
     opts.now       the time "now" in ms (default Date.now())
     opts.currency  Home Assistant's currency (default AUD)
     opts.fail      {type: {code, message}}  answers that fail (e.g. {'zoomy/trips': {code: 'timeout'}})
     opts.hang      [type]                   questions that never answer
     opts.empty     true: no data at all (no trips, charges, pulls, curves, routes; sensors unknown)
     opts.routesOff true: route storage is turned off (route_keys says store_routes false)
   Returned: { hass, calls, subs, emit(entry_id, changed), reconnect(), data(entry_id), setState(id, state) } */
window.FakeHass = (function () {
  'use strict';
  function rng(seed) {                       // mulberry32: the same numbers every run
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function r1(v) { return Math.round(v * 10) / 10; }
  function r2(v) { return Math.round(v * 100) / 100; }
  function r5(v) { return Math.round(v * 100000) / 100000; }
  function iso(ms) { return new Date(ms).toISOString(); }
  function clone(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }

  // one car's whole history, newest last
  function history(seed, now) {
    var R = rng(seed), day0 = new Date(now); day0.setHours(0, 0, 0, 0);
    var D = 86400000, trips = [], charges = [], i, t;
    // trips: about 1.2 a day over the last 75 days (so 30 days < 45 rows: one bar each; all > 62 days: one bar a month)
    for (i = 75; i >= 0; i--) {
      var n = R() < 0.25 ? 2 : R() < 0.85 ? 1 : 0;
      for (var k = 0; k < n; k++) {
        t = day0.getTime() - i * D + (7 + k * 9 + Math.floor(R() * 3)) * 3600000 + Math.floor(R() * 50) * 60000;
        if (t > now - 3600000) continue;
        var km = r1(3 + R() * 45), used = r2(km * (0.13 + R() * 0.07)), regen = r2(used * (0.08 + R() * 0.12)), mins = Math.round(km * (1.4 + R()));
        var s0 = Math.round(40 + R() * 55), x = {
          start: iso(t), end: iso(t + mins * 60000), minutes: mins, km: km, kwh_used: used, kwh_regen: regen, kwh_net: r2(used - regen),
          kwh_per_100km: r1((used - regen) / km * 100), soc_start: s0, soc_end: Math.max(5, Math.round(s0 - (used - regen) / 0.62)),
          outside_c: Math.round(6 + R() * 20)
        };
        if (i === 40 && k === 0) delete x.outside_c;      // a trip with a missing value
        trips.push(x);
      }
    }
    // charges: every two or three days
    for (i = 74; i >= 0; i -= 2 + Math.floor(R() * 2)) {
      t = day0.getTime() - i * D + (R() < 0.7 ? 1 : 13) * 3600000 + Math.floor(R() * 40) * 60000;
      if (t > now - 7200000) continue;
      var dc = R() < 0.2, kwh = r1(dc ? 20 + R() * 25 : 6 + R() * 30), kw = r1(dc ? 40 + R() * 60 : 6.4 + R() * 0.6);
      var m = Math.round(kwh / kw * 60), s = Math.round(20 + R() * 40), off = dc ? 0 : r1(kwh * R());
      var c = {
        start: iso(t), end: iso(t + m * 60000), minutes: m, kwh_added: kwh, offpeak_kwh: off, soc_start: s, soc_end: Math.min(100, Math.round(s + kwh / 0.62)),
        avg_kw: kw, peak_kw: dc ? r1(kw * 1.4) : (R() < 0.3 ? 0 : r1(kw + 0.3)), cost: r2(dc ? kwh * 0.6 : off * 0.08 + (kwh - off) * 0.3),
        type: dc ? 'DC' : 'AC', place: dc ? 'Public' : 'Home', breakdown: dc ? 'Public rate' : 'Off-peak ' + off + ' kWh', cost_typed: R() < 0.5
      };
      if (charges.length === 5) c.cost = null;            // one charge with no price
      charges.push(c);
    }
    // the dyno: best-at-each-speed lines, and eight pulls in three modes
    var env = [], regenEnv = [];
    for (var v = 0; v <= 160; v += 5) {
      env.push([v, v === 0 ? 0 : r1(Math.min(310, 9 * v) * (v > 110 ? 1 - (v - 110) / 200 : 1))]);
      regenEnv.push([v, v < 10 ? 0 : r1(Math.min(75, v * 1.4))]);
    }
    env.push([165, 0], [170, 0]);                          // the fast end not reached yet
    var modes = ['Eco', 'Normal', 'Sport'], pulls = [];
    for (i = 0; i < 8; i++) {
      var mode = modes[i % 3], top = mode === 'Eco' ? 110 : mode === 'Normal' ? 190 : 290, a = 10 + Math.floor(R() * 20), b = a + 40 + Math.floor(R() * 40), pts = [];
      for (var sp = a; sp <= b; sp += 2.5) pts.push([r1(sp), r1(Math.min(top, top * (0.4 + (sp - a) / 60)) - R() * 6)]);
      pulls.push({ when: iso(now - (i * 3 + 1) * D - Math.floor(R() * 8) * 3600000), mode: mode, soc: Math.round(50 + R() * 40),
                   peak_kw: r1(top - R() * 4), peak_at_kmh: a + 30, start_kmh: a, end_kmh: b, secs: r1((b - a) / 12), outside_c: Math.round(8 + R() * 15), points: pts });
    }
    var dyno = { envelope: env, regen_envelope: regenEnv, best: { kw: 296.4, kmh: 72 }, sag: { volts: 341.2, at_kw: 288.5 }, pulls: pulls };
    var runs = [
      { when: iso(now - 2 * D), s_0_60: 2.41, s_0_80: 3.18, s_0_100: 3.92, s_400m: 12.1, trap_kmh: 171, peak_g: 0.92 },
      { when: iso(now - 9 * D), s_0_60: 2.55, s_0_80: 3.3, s_0_100: 4.1, s_400m: 12.4, trap_kmh: 168, peak_g: 0.88 },
      { when: iso(now - 30 * D), s_0_60: null, s_0_80: 3.5, s_0_100: null, s_400m: null, trap_kmh: null, peak_g: 0.81 }
    ];
    // charge curves: the twelve newest charges; the newest has only two readings (a "short" one)
    var keys = charges.slice(-12).map(function (x) { return x.start; }).reverse(), curves = {};
    keys.forEach(function (key, j) {
      var ch = charges.filter(function (x) { return x.start === key; })[0], cp = [], len = j === 0 ? 2 : Math.max(4, Math.round(ch.minutes / 6));
      for (var q = 0; q < len; q++) {
        var tt = j === 0 ? q * 0.4 : q * ch.minutes / (len - 1), soc = ch.soc_start + (ch.soc_end - ch.soc_start) * q / Math.max(1, len - 1);
        var p = ch.avg_kw * (q / len > 0.85 ? 0.6 : 1) + (R() - 0.5) * 0.4;
        cp.push([r1(tt), r1(soc), q === 3 && j === 2 ? null : r2(p)]);
      }
      curves[key] = cp;
    });
    // routes: the twelve newest trips; a wiggly line of a point every few metres (made-up place)
    var routes = {}, routeKeys = [];
    trips.slice(-12).reverse().forEach(function (tr, j) {
      var count = j === 0 ? 900 : 120 + Math.floor(R() * 300), lat = 10 + R() * 0.05, lon = 20 + R() * 0.05, pp = [];
      for (var q = 0; q < count; q++) {
        lat += 0.00012 * Math.cos(q / 40 + j); lon += 0.00012 * Math.sin(q / 55 + j);
        pp.push([r5(lat), r5(lon)]);
      }
      if (j === 5) pp = [[0, 0], [null, 3]];                // a route with no usable points
      routes[tr.start] = { trip_start: tr.start, trip_end: tr.end, km: tr.km, points: pp };
      routeKeys.push({ trip_start: tr.start, trip_end: tr.end, km: tr.km, n: pp.length });
    });
    // one route the list knows but whose file is gone (zoomy/route answers not_found)
    var lost = trips[trips.length - 13];
    if (lost) routeKeys.push({ trip_start: lost.start, trip_end: lost.end, km: lost.km, n: 50 });
    return { trips: trips, charges: charges, dyno: dyno, runs: runs, health: { usable_kwh: 61.2, soh_pct: 97, charges_counted: 42 },
             keys: keys, curves: curves, routes: routes, routeKeys: routeKeys };
  }

  var SENSORS = {
    last_update: ['timestamp'], app_version: [''],
    last_trip_start: ['timestamp'], last_trip_distance: ['km', 1], last_trip_duration: ['min', 0], last_trip_energy: ['kWh', 2],
    last_trip_regen: ['kWh', 2], last_trip_consumption: ['kWh/100 km', 1], last_trip_battery_start: ['%', 0], last_trip_battery_end: ['%', 0],
    last_trip_outside_temperature: ['°C', 1],
    last_charge_start: ['timestamp'], last_charge_energy: ['kWh', 1], last_charge_duration: ['min', 0], last_charge_battery_start: ['%', 0],
    last_charge_battery_end: ['%', 0], last_charge_average_power: ['kW', 1], last_charge_charger: [''], last_charge_cost: ['$CUR', 2],
    last_charge_price: ['c/kWh', 1], last_charge_off_peak: ['%', 0],
    battery: ['%', 0], battery_health: ['%', 0], battery_usable_energy: ['kWh', 1]
  };
  ['this_month', 'last_month'].forEach(function (p) {
    SENSORS[p + '_distance'] = ['km', 1]; SENSORS[p + '_trips'] = ['', 0]; SENSORS[p + '_charges'] = ['', 0];
    SENSORS[p + '_charges_without_price'] = ['', 0]; SENSORS[p + '_energy_home'] = ['kWh', 1]; SENSORS[p + '_energy_public'] = ['kWh', 1];
    SENSORS[p + '_consumption'] = ['kWh/100 km', 1]; SENSORS[p + '_cost'] = ['$CUR', 2];
  });

  function make(opts) {
    opts = opts || {};
    var now = opts.now || Date.now(), currency = opts.currency || 'AUD';
    var cars = (opts.cars || [{ entry_id: 'entry0001', title: 'Test car', slug: 'test_car', seed: 20301001 }]).map(function (c) {
      var d = history(c.seed || 1, now);
      if (opts.empty) { d.trips = []; d.charges = []; d.dyno = { envelope: [], regen_envelope: [], best: null, sag: null, pulls: [] }; d.keys = []; d.curves = {}; d.routes = {}; d.routeKeys = []; d.runs = []; d.health = null; }
      if (opts.routesOff) { d.routes = {}; d.routeKeys = []; }
      return { entry_id: c.entry_id, title: c.title, slug: c.slug, d: d, posts: { snapshot: 3, trips: 4, charges: 4, dyno: 2, charge_curve: 9, route: 12 }, started: iso(now - 86400000) };
    });
    var calls = [], subs = [], listeners = { ready: [] }, states = {}, entities = {};

    function sensorStates(car) {
      var d = car.d, trip = d.trips[d.trips.length - 1], ch = d.charges[d.charges.length - 1];
      var val = {
        last_update: opts.empty ? null : iso(now - 300000), app_version: opts.empty ? null : '4.18.20',
        last_trip_start: trip ? trip.start : null, last_trip_distance: trip ? trip.km : null, last_trip_duration: trip ? trip.minutes : null,
        last_trip_energy: trip ? trip.kwh_net : null, last_trip_regen: trip ? trip.kwh_regen : null, last_trip_consumption: trip ? trip.kwh_per_100km : null,
        last_trip_battery_start: trip ? trip.soc_start : null, last_trip_battery_end: trip ? trip.soc_end : null,
        last_trip_outside_temperature: trip && trip.outside_c !== undefined ? trip.outside_c : null,
        last_charge_start: ch ? ch.start : null, last_charge_energy: ch ? ch.kwh_added : null, last_charge_duration: ch ? ch.minutes : null,
        last_charge_battery_start: ch ? ch.soc_start : null, last_charge_battery_end: ch ? ch.soc_end : null,
        last_charge_average_power: ch ? ch.avg_kw : null, last_charge_charger: ch ? ch.type + ' · ' + ch.place : null,
        last_charge_cost: ch ? ch.cost : null, last_charge_price: ch && ch.cost !== null ? r1(ch.cost / ch.kwh_added * 100) : null,
        last_charge_off_peak: ch ? Math.round(Math.min(ch.offpeak_kwh / ch.kwh_added * 100, 100)) : null,
        battery: trip ? trip.soc_end : null, battery_health: d.health ? d.health.soh_pct : null, battery_usable_energy: d.health ? d.health.usable_kwh : null,
        this_month_distance: opts.empty ? null : 412.3, this_month_trips: opts.empty ? null : 21, this_month_charges: opts.empty ? null : 7,
        this_month_charges_without_price: opts.empty ? null : 1, this_month_energy_home: opts.empty ? null : 60.25, this_month_energy_public: opts.empty ? null : 12,
        this_month_consumption: opts.empty ? null : 15.2, this_month_cost: opts.empty ? null : 19.5,
        last_month_distance: opts.empty ? null : 1210, last_month_trips: opts.empty ? null : 44, last_month_charges: opts.empty ? null : 15,
        last_month_charges_without_price: opts.empty ? null : 0, last_month_energy_home: opts.empty ? null : 180, last_month_energy_public: opts.empty ? null : 25.5,
        last_month_consumption: opts.empty ? null : 14.8, last_month_cost: opts.empty ? null : 61.75
      };
      var ids = {};
      Object.keys(SENSORS).forEach(function (key) {
        var id = 'sensor.' + car.slug + '_' + key, spec = SENSORS[key], v = val[key];
        ids[key] = id;
        var attrs = { friendly_name: 'Zoomy ' + car.title + ' ' + key.replace(/_/g, ' ') };
        if (spec[0] === 'timestamp') attrs.device_class = 'timestamp';
        else if (spec[0] === '$CUR') { attrs.unit_of_measurement = currency; attrs.device_class = 'monetary'; }
        else if (spec[0]) attrs.unit_of_measurement = spec[0];
        if (/_month_distance$/.test(key)) attrs.month = key.indexOf('this') === 0 ? '2030-01' : '2029-12';
        states[id] = { entity_id: id, state: v === null || v === undefined ? 'unknown' : String(v), attributes: attrs,
                       last_changed: iso(now - 299000), last_updated: iso(now - 299000) };
        entities[id] = { entity_id: id, platform: 'zoomy', display_precision: spec[1] };
      });
      car.ids = ids;
    }
    cars.forEach(sensorStates);

    function carOf(msg) {
      if (msg.entry_id) return cars.filter(function (c) { return c.entry_id === msg.entry_id; })[0] || null;
      return cars.length === 1 ? cars[0] : null;
    }
    function answer(msg) {
      var ty = msg && msg.type;
      if (opts.fail && opts.fail[ty]) return { err: opts.fail[ty] };
      if (opts.hang && opts.hang.indexOf(ty) >= 0) return { hang: true };
      if (!/^zoomy\//.test(ty)) return { err: { code: 'unknown_command', message: 'Unknown command.' } };
      if (ty === 'zoomy/cars') {
        return { ok: { cars: cars.map(function (c) {
          return { entry_id: c.entry_id, title: c.title, device_id: 'dev-' + c.entry_id, app_version: '4.18.20', last_update: iso(now - 300000),
                   store_routes: !opts.routesOff, counts: { trips: c.d.trips.length }, entities: c.ids };
        }) } };
      }
      var car = carOf(msg);
      if (!car) return { err: msg.entry_id ? { code: 'not_found', message: 'No such Zoomy car' } : { code: 'invalid_format', message: 'More than one car: send entry_id' } };
      var d = car.d;
      if (ty === 'zoomy/trips') return { ok: { rows: d.trips.slice().reverse(), source: 'store' } };
      if (ty === 'zoomy/charges') return { ok: { rows: d.charges.slice().reverse(), source: 'store' } };
      if (ty === 'zoomy/dyno') return { ok: d.dyno };
      if (ty === 'zoomy/snapshot') return { ok: { snapshot: opts.empty ? {} : { runs: d.runs, health: d.health, trips: d.trips.slice(-20).reverse() }, received: iso(now - 300000) } };
      if (ty === 'zoomy/curve_keys') return { ok: { keys: d.keys } };
      if (ty === 'zoomy/charge_curve') {
        return d.curves[msg.charge_start] ? { ok: { charge_start: msg.charge_start, points: d.curves[msg.charge_start] } }
                                          : { err: { code: 'not_found', message: 'No charge curve is stored for that charge' } };
      }
      if (ty === 'zoomy/route_keys') return { ok: { routes: d.routeKeys, store_routes: !opts.routesOff } };
      if (ty === 'zoomy/route') {
        return d.routes[msg.trip_start] ? { ok: d.routes[msg.trip_start] } : { err: { code: 'not_found', message: 'No route is stored for that trip' } };
      }
      if (ty === 'zoomy/status') {
        return { ok: { entry_id: car.entry_id, counts: { trips: d.trips.length, charges: d.charges.length, dyno_pulls: d.dyno.pulls.length,
                                                         charge_curves: d.keys.length, routes: d.routeKeys.length },
                       posts: clone(car.posts), started: car.started, snapshot_received: iso(now - 300000), app_version: '4.18.20', store_routes: !opts.routesOff } };
      }
      return { err: { code: 'unknown_command', message: 'Unknown command.' } };
    }

    var connection = {
      subscribeMessage: function (cb, msg, o) {
        calls.push({ t: Date.now(), type: msg.type, entry_id: msg.entry_id || null, sub: true, resubscribe: o ? o.resubscribe : undefined });
        var a = answer(msg.type === 'zoomy/subscribe' ? { type: 'zoomy/status', entry_id: msg.entry_id } : msg);
        if (opts.fail && opts.fail['zoomy/subscribe']) a = { err: opts.fail['zoomy/subscribe'] };
        return new Promise(function (res, rej) {
          setTimeout(function () {
            if (a.err) { rej(a.err); return; }
            var s = { cb: cb, msg: msg, live: true };
            subs.push(s);
            res(function () { s.live = false; calls.push({ t: Date.now(), type: 'unsubscribe', entry_id: msg.entry_id || null }); return Promise.resolve(); });
          }, 20);
        });
      },
      addEventListener: function (ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
      removeEventListener: function (ev, fn) { listeners[ev] = (listeners[ev] || []).filter(function (f) { return f !== fn; }); }
    };

    function precision(so) {
      var e = entities[so.entity_id];
      return e && typeof e.display_precision === 'number' ? e.display_precision : null;
    }
    var hass = {
      states: states,
      entities: entities,
      config: { currency: currency, time_zone: 'UTC' },
      themes: { darkMode: true },
      connection: connection,
      callWS: function (msg) {
        calls.push({ t: Date.now(), type: msg && msg.type, entry_id: msg && msg.entry_id || null,
                     key: msg && (msg.charge_start || msg.trip_start) ? String(msg.charge_start || msg.trip_start) : '' });
        var a = answer(msg);
        return new Promise(function (res, rej) {
          if (a.hang) return;
          setTimeout(function () { if (a.err) rej(a.err); else res(clone(a.ok)); }, 30);
        });
      },
      formatEntityStateToParts: function (so) {
        var p = precision(so), v = Number(so.state), unit = so.attributes.unit_of_measurement || '';
        if (so.attributes.device_class === 'timestamp' || !isFinite(v) || so.state === '') return [{ type: 'value', value: so.state }];
        // as Home Assistant's compute_state_display: money as the currency format's parts (sign first in English),
        // other numbers as value, a blank (none before %), unit
        if (so.attributes.device_class === 'monetary') {
          var parts = new Intl.NumberFormat('en', { style: 'currency', currency: unit, minimumFractionDigits: 2 }).formatToParts(v), outm = [];
          parts.forEach(function (x) {
            var t = x.type === 'currency' ? 'unit' : x.type === 'literal' ? 'literal' : 'value', last = outm[outm.length - 1];
            if (t === 'value' && last && last.type === 'value') last.value += x.value; else outm.push({ type: t, value: x.value });
          });
          return outm;
        }
        var text = p === null ? String(v) : v.toLocaleString('en', { minimumFractionDigits: p, maximumFractionDigits: p });
        var out = [{ type: 'value', value: text }];
        if (unit) { out.push({ type: 'literal', value: unit === '%' ? '' : ' ' }); out.push({ type: 'unit', value: unit }); }
        return out;
      },
      formatEntityState: function (so) { return hass.formatEntityStateToParts(so).map(function (x) { return x.value; }).join(''); }
    };

    function live() { return subs.filter(function (s) { return s.live; }); }
    return {
      hass: hass,
      calls: calls,
      subs: subs,
      cars: cars,
      live: live,
      // the integration tells the subscribers of a car that something changed
      emit: function (entryId, changed) {
        live().forEach(function (s) { if (s.msg.entry_id === entryId) s.cb({ entry_id: entryId, changed: changed, counts: {} }); });
      },
      // the websocket reconnects: subscriptions made with resubscribe false are gone, "ready" is fired
      reconnect: function () {
        subs.forEach(function (s) { s.live = false; });
        (listeners.ready || []).slice().forEach(function (fn) { fn(); });
      },
      data: function (entryId) { var c = cars.filter(function (x) { return x.entry_id === entryId; })[0]; return c ? c.d : null; },
      car: function (entryId) { return cars.filter(function (x) { return x.entry_id === entryId; })[0] || null; },
      // a new hass object (as Home Assistant hands the cards after any state change)
      next: function () { var h = Object.assign({}, hass); h.states = Object.assign({}, states); hass = h; return h; },
      // one sensor changes: a new hass object with it
      set: function (id, state) {
        states = Object.assign({}, states);
        states[id] = Object.assign({}, states[id], { state: String(state), last_updated: new Date().toISOString() });
        var h = Object.assign({}, hass); h.states = states; hass = h; return h;
      },
      // a new entity registry (a car added or renamed): a new hass object whose entities are a new object
      newRegistry: function () { var h = Object.assign({}, hass); h.entities = Object.assign({}, entities); hass = h; return h; },
      addCar: function (c) {
        var car = { entry_id: c.entry_id, title: c.title, slug: c.slug, d: history(c.seed || 7, now), posts: { snapshot: 1 }, started: iso(now) };
        cars.push(car); sensorStates(car);
        var h = Object.assign({}, hass); h.states = Object.assign({}, states); h.entities = Object.assign({}, entities); hass = h; return h;
      },
      rename: function (entryId, title) { var c = cars.filter(function (x) { return x.entry_id === entryId; })[0]; if (c) c.title = title; },
      bumpPosts: function (entryId, kind) { var c = cars.filter(function (x) { return x.entry_id === entryId; })[0]; if (c) c.posts[kind] = (c.posts[kind] || 0) + 1; },
      readyListeners: function () { return (listeners.ready || []).length; }
    };
  }
  return { make: make };
})();

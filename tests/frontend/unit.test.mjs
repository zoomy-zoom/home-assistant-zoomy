/* Unit tests of the pure parts of the Zoomy frontend, in plain Node (no browser):
     node --test tests/frontend/
   The modules are loaded with a few stand-ins for the browser (window, HTMLElement, customElements, localStorage);
   nothing is drawn here (the cards are tested in a real browser: run.js). All values are made up. */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
const win = new EventTarget();
win.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
win.innerHeight = 900;
globalThis.window = win;
globalThis.HTMLElement = class {};
const defined = new Map();
globalThis.customElements = { get: (n) => defined.get(n), define: (n, c) => defined.set(n, c), whenDefined: () => Promise.resolve() };

const core = await import('../../custom_components/zoomy/frontend/core.js');
const strategy = await import('../../custom_components/zoomy/frontend/strategy.js');
const map = await import('../../custom_components/zoomy/frontend/trip-map.js');
await import('../../custom_components/zoomy/frontend/zoomy.js');

test('the entry module defines the strategy, the six cards and the Add dashboard entry', () => {
  assert.ok(defined.get('ll-strategy-dashboard-zoomy'));
  for (const tag of ['zoomy-summary-card', 'zoomy-trips-card', 'zoomy-charges-card', 'zoomy-route-map-card', 'zoomy-performance-card', 'zoomy-charge-sheet-card']) {
    assert.ok(defined.get(tag), tag);
    assert.equal(win.customCards.filter((c) => c.type === tag).length, 1, tag + ' listed once');
  }
  assert.deepEqual(win.customStrategies.filter((s) => s.type === 'zoomy').map((s) => s.strategyType), ['dashboard']);
});

test('strategy: six panel views, an entry_id only when it is a plain id', async () => {
  const S = defined.get('ll-strategy-dashboard-zoomy');
  const cfg = await S.generate({ type: 'custom:zoomy' });
  assert.deepEqual(cfg.views.map((v) => v.title), ['Summary', 'Trips', 'Charges', 'Trip map', 'Performance', 'Charge sheet']);
  assert.ok(cfg.views.every((v) => v.type === 'panel' && v.cards.length === 1));
  assert.deepEqual(strategy.zoomyViews({ entry_id: 'abc_DEF-123' })[1].cards[0], { type: 'custom:zoomy-trips-card', entry_id: 'abc_DEF-123' });
  assert.deepEqual(strategy.zoomyViews({ entry_id: '../x' })[1].cards[0], { type: 'custom:zoomy-trips-card' });
  assert.deepEqual(strategy.zoomyViews({ entry_id: 'x'.repeat(65) })[1].cards[0], { type: 'custom:zoomy-trips-card' });
  assert.deepEqual(S.registryDependencies, []);
});

test('statusMarks: one text per kind, moving only with that kind', () => {
  const a = core.statusMarks({ started: 's', counts: { trips: 3, charges: 2, dyno_pulls: 1, charge_curves: 4, routes: 5 },
                               posts: { trips: 1, charges: 1, dyno: 1, charge_curve: 1, route: 1, snapshot: 2 }, snapshot_received: 't', store_routes: true });
  const b = core.statusMarks({ started: 's', counts: { trips: 4, charges: 2, dyno_pulls: 1, charge_curves: 4, routes: 5 },
                               posts: { trips: 2, charges: 1, dyno: 1, charge_curve: 1, route: 1, snapshot: 2 }, snapshot_received: 't', store_routes: true });
  const moved = Object.keys(a).filter((k) => a[k] !== b[k]);
  assert.deepEqual(moved, ['trips']);
  const off = core.statusMarks({ started: 's', counts: { routes: 5 }, posts: { route: 1 }, store_routes: false });
  assert.notEqual(off.routes, core.statusMarks({ started: 's', counts: { routes: 5 }, posts: { route: 1 }, store_routes: true }).routes);
  assert.deepEqual(Object.keys(core.statusMarks(null)), ['started', 'snapshot', 'trips', 'charges', 'dyno', 'curves', 'routes', 'runs']);
  const r1 = core.statusMarks({ counts: { runs: 3 }, posts: { runs: 1 } }), r2 = core.statusMarks({ counts: { runs: 3 }, posts: { runs: 2 } });
  assert.deepEqual(Object.keys(r1).filter((k) => r1[k] !== r2[k]), ['runs']);
});

test('carFor: the fixed car, else the picked one, else the first', () => {
  const cars = [{ entry_id: 'a', title: 'A' }, { entry_id: 'b', title: 'B' }];
  assert.equal(core.carFor(cars, null).entry_id, 'a');
  let heard = null;
  win.addEventListener('zoomy-car-picked', (e) => { heard = e.detail.entry_id; }, { once: true });
  core.pickCar('b');
  assert.equal(heard, 'b');
  assert.equal(store.get('zoomy.car'), 'b');
  assert.equal(core.carFor(cars, null).entry_id, 'b');
  assert.equal(core.carFor(cars, 'a').entry_id, 'a');
  assert.equal(core.carFor(cars, 'zzz'), null);
  assert.equal(core.carFor([], null), null);
  core.pickCar('gone');
  assert.equal(core.carFor(cars, null).entry_id, 'a');
});

test('callWS: answers, errors and a question that never ends', async () => {
  assert.deepEqual(await core.callWS({ callWS: async (m) => ({ got: m.type }) }, { type: 'zoomy/x' }), { got: 'zoomy/x' });
  await assert.rejects(core.callWS({ callWS: async () => { throw { code: 'not_found', message: 'no' }; } }, { type: 'x' }), { code: 'not_found' });
  await assert.rejects(core.callWS({ callWS: () => new Promise(() => {}) }, { type: 'x' }, 30), { code: 'timeout' });
  await assert.rejects(core.callWS(null, { type: 'x' }), { code: 'not_ready' });
  await assert.rejects(core.callWS({ callWS: () => { throw new Error('boom'); } }, { type: 'x' }), /boom/);
});

test('moneySign: Home Assistant\'s currency, $ when unknown', () => {
  assert.equal(core.moneySign({ config: { currency: 'AUD' } }), '$');
  assert.equal(core.moneySign({ config: { currency: 'EUR' } }), '€');
  assert.equal(core.moneySign({ config: { currency: 'GBP' } }), '£');
  assert.equal(core.moneySign({ config: {} }), '$');
  assert.equal(core.moneySign({ config: { currency: '<b>' } }), '$');
});

test('lastSentText: from the Last update and App version sensors', () => {
  const car = { entities: { last_update: 'sensor.a_last_update', app_version: 'sensor.a_app_version' } };
  const when = new Date(new Date().getFullYear(), 0, 2, 7, 45);
  const hass = { states: { 'sensor.a_last_update': { state: when.toISOString() }, 'sensor.a_app_version': { state: '4.18.20' } } };
  assert.equal(core.lastSentText(hass, car), 'Car last sent ' + core.DOW[when.getDay()] + ', 2 Jan 07:45 · Zoomy 4.18.20');
  hass.states['sensor.a_last_update'].state = 'unknown';
  assert.equal(core.lastSentText(hass, car), 'No upload from the car yet');
  assert.equal(core.lastSentText({ states: {} }, {}), 'No upload from the car yet');
});

test('esc: no markup gets through', () => {
  assert.equal(core.esc('<img src=x onerror="a">&\''), '&lt;img src=x onerror=&quot;a&quot;&gt;&amp;&#39;');
  assert.equal(core.esc(null), '');
});

test('trip map: the list is the stored routes, newest first, with their trips\' facts', () => {
  const routes = [{ trip_start: '2030-01-01T08:00:00', trip_end: '2030-01-01T08:30:00', km: 9, n: 300 },
                  { trip_start: '2030-01-02T08:00:00', trip_end: '2030-01-02T08:10:00', km: 3, n: 50 },
                  { trip_start: '2030-01-02T08:00:00', km: 99 },          // the same trip again: once
                  { trip_start: 'not a time' }, null];
  const rows = [{ start: '2030-01-02T08:00:00', km: 3.2, minutes: 11, kwh_per_100km: 14.1, soc_start: 80, soc_end: 78 },
                { start: '2030-01-03T08:00:00', km: 50 }];               // a trip with no route: not listed
  const list = map.buildList(routes, rows);
  assert.deepEqual(list.map((e) => e.key), ['2030-01-02T08:00:00', '2030-01-01T08:00:00']);
  assert.equal(list[0].km, 3.2);
  assert.equal(list[0].min, 11);
  assert.equal(list[1].km, 9);
  assert.equal(list[1].min, 30);
  assert.equal(map.countLine(list, false, false), "2 trips with the car's route, newest first");
  assert.match(map.countLine(list.slice(0, 1), true, true), /^1 trip with the car's route \(new routes are not kept: Keep GPS routes is off\) \(the list of routes could not be refreshed just now\)$/);
  assert.deepEqual(map.buildList(null, null), []);
});

test('trip map: usable points only, the box around them, thinned for drawing', () => {
  assert.deepEqual(map.cleanPoints([[10.1, 20.2], [0, 0], [91, 1], [10, 181], ['1', 2], [10.2, 20.3], null, [NaN, 1]]), [[10.1, 20.2], [10.2, 20.3]]);
  assert.deepEqual(map.bounds([[10, 20], [11, 19], [10.5, 21]]), [[10, 19], [11, 21]]);
  const line = [];
  for (let i = 0; i < 5000; i++) line.push([10 + i * 0.00001, 20 + Math.sin(i / 50) * 0.001]);
  const thin = map.thin(line, 400);
  assert.ok(thin.length <= 400 && thin.length > 20, String(thin.length));
  assert.deepEqual(thin[0], line[0]);
  assert.deepEqual(thin[thin.length - 1], line[line.length - 1]);
  const straight = map.thin(line.slice(0, 300), 400);
  assert.equal(straight.length, 300, 'a short route is not thinned');
});

test('trip map: tells the 2026.10 map from an older (Leaflet) one', () => {
  class NewMap { static get elementProperties() { return new Map([['paths', {}]]); } }
  class OldMap { static get elementProperties() { return new Map([['paths', {}], ['layers', {}]]); } }
  assert.equal(map.newMap(new NewMap()), true);
  assert.equal(map.newMap(new OldMap()), false);
});

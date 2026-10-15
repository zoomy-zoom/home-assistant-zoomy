/* The browser tests of the Zoomy cards. case.html?case=<name>&v=<version> runs one of them in a fake Home Assistant
   (fake-hass.js, stubs.js) and leaves window.result = {results: [[pass, text]...], errors, logs} and window.done.
   All data is made up (fake-hass.js). */
const Q = new URLSearchParams(location.search);
const NAME = Q.get('case');
const V = Q.get('v') || '0.1.0';
const BASE = '/zoomy_static/' + V + '/';
const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const COORD = /\b-?\d{1,3}\.\d{4,}\b/;     // a number that looks like a coordinate

function ok(c, msg) { results.push([!!c, msg]); }
function eq(a, b, msg) { results.push([a === b, msg + (a === b ? '' : ' (got ' + JSON.stringify(a) + ', wanted ' + JSON.stringify(b) + ')')]); }
async function until(fn, ms, step) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 20000)) {
    try { const v = fn(); if (v) return v; } catch (e) { /* not yet */ }
    await sleep(step || 100);
  }
  try { return fn(); } catch (e) { return null; }
}
function q(card, sel) { return card.shadowRoot ? card.shadowRoot.querySelector(sel) : null; }
function all(card, sel) { return card.shadowRoot ? Array.from(card.shadowRoot.querySelectorAll(sel)) : []; }
function txt(card, sel) { const n = q(card, sel); return n ? norm(n.textContent) : null; }
// a summary tile as words: its label, its value, its small print
function tileText(b) { return ['.k', '.n', '.d'].map((s) => b.querySelector(s)).filter(Boolean).map((e) => norm(e.textContent)).filter(Boolean).join(' '); }
function click(el) { el.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true })); }
function mount(fake, tag, config) {
  const el = document.createElement(tag);
  el.setConfig(config || {});
  el.hass = fake.hass;
  document.getElementById('view').appendChild(el);
  return el;
}
function calls(fake, type, entry) { return fake.calls.filter((c) => c.type === type && (entry === undefined || c.entry_id === entry)); }
function day0(ms) { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d; }
const TWO_CARS = [{ entry_id: 'entry0001', title: 'Test car', slug: 'test_car', seed: 20301001 },
                  { entry_id: 'entry0002', title: 'Second car', slug: 'second_car', seed: 20301002 }];

const CASES = {};

// ---- the dashboard strategy -----------------------------------------------------------------------------------
CASES.strategy = async function () {
  const fake = FakeHass.make();
  const S = customElements.get('ll-strategy-dashboard-zoomy');
  ok(!!S, 'the strategy element ll-strategy-dashboard-zoomy is defined');
  ok(!customElements.get('ll-strategy-zoomy'), 'no legacy-named strategy element');
  const cfg = await S.generate({ type: 'custom:zoomy' }, fake.hass);
  eq(cfg.views.map((v) => v.title).join('|'), 'Summary|Trips|Charges|Trip map|Performance|Charge sheet', 'six tabs, in order');
  eq(cfg.views.map((v) => v.path).join('|'), 'summary|trips|charges|map|dyno|charge-sheet', 'their paths');
  ok(cfg.views.every((v) => v.type === 'panel' && v.cards.length === 1 && !v.icon), 'each a panel view with one card and no icon');
  const types = cfg.views.map((v) => v.cards[0].type);
  eq(types.join('|'), 'custom:zoomy-summary-card|custom:zoomy-trips-card|custom:zoomy-charges-card|custom:zoomy-route-map-card|custom:zoomy-performance-card|custom:zoomy-charge-sheet-card', 'the card of each tab');
  ok(types.every((t) => !!customElements.get(t.slice(7))), 'every card the strategy uses is defined');
  ok(cfg.views.every((v) => !('entry_id' in v.cards[0])), 'no car fixed: the cards offer a picker');
  eq(cfg.views[0].cards[0].map_view, 'map', 'the summary links to the map tab');
  const one = await S.generate({ type: 'custom:zoomy', entry_id: 'entry0002' }, fake.hass);
  ok(one.views.every((v) => v.cards[0].entry_id === 'entry0002'), 'strategy option entry_id goes to every card');
  const bad = await S.generate({ type: 'custom:zoomy', entry_id: '"><script>' }, fake.hass);
  ok(bad.views.every((v) => !('entry_id' in v.cards[0])), 'a malformed entry_id is ignored');
  eq(JSON.stringify(S.registryDependencies), '[]', 'no rebuild when the registries change');
  eq(JSON.stringify(S.getCreateSuggestions(fake.hass)), '{"title":"ZOOMY","icon":"mdi:car-electric"}', 'create suggestions');
  eq(fake.calls.length, 0, 'generating the views asks Home Assistant nothing');
  const cs = (window.customStrategies || []).filter((s) => s.type === 'zoomy');
  ok(cs.length === 1 && cs[0].strategyType === 'dashboard' && cs[0].name === 'Zoomy', 'offered once in Add dashboard (window.customStrategies)');
  const cc = (window.customCards || []).filter((c) => /^zoomy-/.test(c.type)).map((c) => c.type).sort();
  eq(cc.join(','), 'zoomy-charge-sheet-card,zoomy-charges-card,zoomy-performance-card,zoomy-route-map-card,zoomy-summary-card,zoomy-trips-card', 'six cards in the card picker');
  // loading the module a second time (two tabs of the same page) does not define anything twice
  await import(BASE + 'zoomy.js?again');
  eq((window.customStrategies || []).filter((s) => s.type === 'zoomy').length, 1, 'still offered once after a second load');
  let threw = null;
  try { document.createElement('zoomy-trips-card').setConfig({ entry_id: 42 }); } catch (e) { threw = e.message; }
  ok(threw && /entry_id/.test(threw), 'a card refuses an entry_id that is not text: ' + threw);
  threw = null;
  try { document.createElement('zoomy-route-map-card').setConfig({ list_side: 'up' }); } catch (e) { threw = e.message; }
  ok(threw && /list_side/.test(threw), 'the trip map refuses a wrong list_side: ' + threw);
};

// ---- summary ----------------------------------------------------------------------------------------------------
CASES.summary = async function () {
  const fake = FakeHass.make();
  const card = mount(fake, 'zoomy-summary-card', { map_view: 'map' });
  await until(() => all(card, '.tile').length > 20);
  const d = fake.data('entry0001'), trip = d.trips[d.trips.length - 1], ch = d.charges[d.charges.length - 1];
  eq(txt(card, '.hs-title'), 'ZOOMY \u2014 Summary', 'heading');
  eq(txt(card, '.hs-kicker'), 'Zoomy \u00b7 Test car', 'kicker names the car');
  const tiles = all(card, '.tile').map(tileText);
  ok(tiles.includes('Distance ' + trip.km.toFixed(1) + ' km'), 'last trip distance tile: ' + tiles[0]);
  ok(tiles.includes('Battery ' + trip.soc_start + '% \u2192 ' + trip.soc_end + '%'), 'last trip battery from and to');
  const m = trip.minutes;
  ok(tiles.includes('Duration ' + (m >= 60 ? Math.floor(m / 60) + ' h ' + (m % 60) + ' min' : m + ' min')), 'last trip duration in words');
  ok(tiles.includes('Energy added ' + ch.kwh_added.toFixed(1) + ' kWh'), 'last charge energy');
  ok(tiles.includes('Charger ' + ch.type + ' \u00b7 ' + ch.place), 'charger as text');
  ok(tiles.some((x) => x === 'Charging cost A$19.50 1 charge without a price'), 'this month cost (money as Home Assistant writes it) with the unpriced note');
  ok(card.shadowRoot.textContent.includes('Jan 2030') && card.shadowRoot.textContent.includes('Dec 2029'), 'month labels from the month attribute');
  ok(/^Battery \d+%$/.test(norm(all(card, '.hs-chip')[0].textContent)), 'battery chip: ' + norm(all(card, '.hs-chip')[0].textContent));
  ok(/^Car last sent .+ \u00b7 Zoomy 4\.18\.20$/.test(norm(all(card, '.hs-chip')[1].textContent)), 'last sent chip: ' + norm(all(card, '.hs-chip')[1].textContent));
  // a tap opens the sensor's own dialog
  let info = null;
  window.addEventListener('hass-more-info', (e) => { info = e.detail.entityId; }, { once: true });
  click(all(card, '.tile')[0]);
  eq(info, 'sensor.test_car_last_trip_distance', 'a tap on a tile asks for the sensor\'s dialog');
  // Show on the map: to the map tab of this dashboard
  let moved = false;
  window.addEventListener('location-changed', () => { moved = true; }, { once: true });
  const before = location.pathname;
  click(q(card, '.go'));
  ok(moved && location.pathname === '/' + before.split('/')[1] + '/map', 'Show on the map goes to this dashboard\'s map tab: ' + location.pathname);
  history.replaceState(null, '', before + location.search);
  // a new state is drawn
  card.hass = fake.set('sensor.test_car_last_trip_distance', '123.4');
  await until(() => all(card, '.tile').some((b) => tileText(b) === 'Distance 123.4 km'), 3000);
  ok(all(card, '.tile').some((b) => tileText(b) === 'Distance 123.4 km'), 'a changed sensor is shown at once');
  // a renamed entity is followed (the car list gives the new id)
  eq(calls(fake, 'zoomy/cars').length, 1, 'the car list is asked for once');
  ok(!fake.calls.some((c) => /^zoomy\/(trips|charges|dyno|route|charge_curve)/.test(c.type)), 'the summary reads sensors only');
};

CASES.summary_empty = async function () {
  const fake = FakeHass.make({ empty: true });
  const card = mount(fake, 'zoomy-summary-card', {});
  await until(() => all(card, '.tile').length > 20);
  ok(/Nothing from the car yet/.test(txt(card, '.note') || ''), 'says nothing came from the car yet');
  ok(all(card, '.tile .n.none').length >= 20, 'unknown values show a dash');
  ok(!q(card, '.go'), 'no map button without map_view');
  eq(txt(card, '.hs-chip'), 'No upload from the car yet', 'chip says no upload yet');
};

CASES.nocar = async function () {
  const fake = FakeHass.make({ cars: [] });
  const card = mount(fake, 'zoomy-trips-card', {});
  await until(() => txt(card, '.zsay p'));
  ok(/No Zoomy car yet\. Add one: Settings > Devices & services > Add integration > Zoomy/.test(txt(card, '.zsay p')), 'no car: says how to add one');
  eq(fake.subs.length, 0, 'no subscription without a car');
};

CASES.cars_fail = async function () {
  const fake = FakeHass.make({ fail: { 'zoomy/cars': { code: 'unknown_command', message: 'Unknown command.' } } });
  const card = mount(fake, 'zoomy-charges-card', {});
  await until(() => txt(card, '.zsay p'));
  ok(/Could not read the Zoomy cars from Home Assistant \(Unknown command\.\)/.test(txt(card, '.zsay p')), 'cannot list the cars: says so');
  await sleep(6000);
  ok(calls(fake, 'zoomy/cars').length >= 2, 'and asks again a while later');
};

// ---- trips and charges -----------------------------------------------------------------------------------------
CASES.trips = async function () {
  const fake = FakeHass.make();
  const card = mount(fake, 'zoomy-trips-card', {});
  await until(() => all(card, 'tbody tr').length);
  const d = fake.data('entry0001'), from = day0(Date.now()); from.setDate(from.getDate() - 29);
  const last30 = d.trips.filter((x) => new Date(x.start) >= from);
  eq(txt(card, '.hs-title'), 'ZOOMY \u2014 Trips', 'heading');
  eq(txt(card, '.hs-sub'), 'Every Test car trip: totals, charts and a full table', 'subtitle names the car');
  const facts = txt(card, '.facts');
  ok(facts.indexOf('Last 30 days: ' + last30.length + ' trips') === 0, 'facts: ' + facts);
  const km = last30.reduce((a, x) => a + x.km, 0);
  ok(facts.includes(Math.round(km).toLocaleString('en-US') + ' km'), 'facts: total km of the last 30 days');
  eq(all(card, '.chart').length, 4, 'four charts');
  eq(all(card, 'tbody tr').length, last30.length, 'one table row per trip of the last 30 days');
  ok(/^Car last sent /.test(txt(card, '.hs-chip')), 'last sent chip');
  click(q(card, 'button[data-p="all"]'));
  await until(() => all(card, 'tbody tr').length === d.trips.length, 3000);
  eq(all(card, 'tbody tr').length, d.trips.length, 'All: every trip');
  const month = all(card, 'button[data-p]')[2];
  click(month);
  await sleep(300);
  const key = month.getAttribute('data-p');
  eq(all(card, 'tbody tr').length, d.trips.filter((x) => { const t = new Date(x.start); return t.getFullYear() + '-' + ('0' + (t.getMonth() + 1)).slice(-2) === key; }).length, 'a month: its trips');
  eq(all(card, 'button[aria-pressed="true"]').map((b) => b.getAttribute('data-p')).join(), key, 'the month button is pressed');
  const bar = q(card, '.chart g.bar');
  click(bar.querySelector('rect.hit'));
  ok(txt(card, '.chart .tip') === norm(bar.querySelector('title').textContent) && txt(card, '.chart .tip').length > 5, 'a tap on a bar writes its numbers: ' + txt(card, '.chart .tip'));
  const asked = calls(fake, 'zoomy/trips');
  ok(asked.length >= 1 && asked.every((c) => c.entry_id === 'entry0001'), 'reads zoomy/trips for its car');
  ok(!calls(fake, 'zoomy/charges').length, 'never reads the charges');
};

CASES.charges = async function () {
  const fake = FakeHass.make({ currency: 'EUR' });
  const card = mount(fake, 'zoomy-charges-card', {});
  await until(() => all(card, 'tbody tr').length);
  eq(txt(card, '.hs-title'), 'ZOOMY \u2014 Charges', 'heading');
  const facts = txt(card, '.facts');
  ok(/€\d/.test(facts) && !/\$/.test(facts), 'money in Home Assistant\'s currency (EUR): ' + facts);
  ok(all(card, '.chart .sub').some((s) => norm(s.textContent) === '€ per charge'), 'cost chart in €');
  click(q(card, 'button[data-p="all"]'));
  await sleep(300);
  const d = fake.data('entry0001');
  eq(all(card, 'tbody tr').length, d.charges.length, 'All: every charge');
  ok(/\(1 without a price\)/.test(txt(card, '.facts')), 'the charge with no price is counted: ' + txt(card, '.facts'));
};

CASES.charts_fail = async function () {
  const fake = FakeHass.make({ hang: ['zoomy/trips'] });
  const card = mount(fake, 'zoomy-trips-card', {});
  await sleep(2000);
  ok(/Loading the car's history/.test(txt(card, '#main')), 'waiting: says it is loading');
  await sleep(31000);
  ok(/The history could not be read from Home Assistant\./.test(txt(card, '.warn') || ''), 'gave up after 30 s: ' + txt(card, '#main').slice(0, 120));
  ok(!!q(card, 'button[data-again]'), 'with a Try again button');
};

CASES.charts_snapshot_rows = async function () {
  const fake = FakeHass.make();
  // the store has no rows yet: zoomy/trips answers with the latest upload (source "snapshot")
  const orig = fake.hass.callWS;
  fake.hass.callWS = function (msg) {
    if (msg.type === 'zoomy/trips') {
      fake.calls.push({ t: Date.now(), type: msg.type, entry_id: msg.entry_id });
      const rows = fake.data('entry0001').trips.slice(-20).reverse();
      return new Promise((r) => setTimeout(() => r({ rows: rows, source: 'snapshot' }), 30));
    }
    return orig(msg);
  };
  const card = mount(fake, 'zoomy-trips-card', {});
  await until(() => all(card, 'tbody tr').length);
  ok(/Showing the car's latest upload only: the full history is empty so far\./.test(txt(card, '.warn') || ''), 'says these are the latest upload only');
};

// ---- live changes ----------------------------------------------------------------------------------------------
CASES.live = async function () {
  const fake = FakeHass.make();
  const card = mount(fake, 'zoomy-trips-card', {});
  await until(() => all(card, 'tbody tr').length);
  await sleep(200);
  const sub = calls(fake, 'zoomy/subscribe');
  ok(sub.length === 1 && sub[0].entry_id === 'entry0001' && sub[0].resubscribe === false, 'one subscription for the car, resubscribed by the card itself');
  const n0 = calls(fake, 'zoomy/trips').length;
  fake.emit('entry0001', ['charges']);
  await sleep(4000);
  eq(calls(fake, 'zoomy/trips').length, n0, 'a change to the charges does not read the trips');
  fake.emit('entry0001', ['trips']);
  await sleep(500);
  eq(calls(fake, 'zoomy/trips').length, n0, 'a change waits a moment (the car posts in a burst)');
  await sleep(2500);
  eq(calls(fake, 'zoomy/trips').length, n0 + 1, 'then the trips are read again');
  // the entry is reloaded: the subscription is made again and the trips read again
  fake.emit('entry0001', ['unloaded']);
  await sleep(5000);
  eq(calls(fake, 'zoomy/subscribe').length, 2, 'after "unloaded" it subscribes again');
  ok(calls(fake, 'zoomy/trips').length >= n0 + 2, 'and reads the trips again');
  // the websocket reconnects
  const n1 = calls(fake, 'zoomy/trips').length, u1 = calls(fake, 'unsubscribe').length;
  fake.reconnect();
  await sleep(3500);
  eq(calls(fake, 'zoomy/subscribe').length, 3, 'after a reconnect it subscribes again');
  eq(calls(fake, 'unsubscribe').length, u1, 'a reconnect does not unsubscribe the lost one (its id is not valid on the new socket)');
  ok(calls(fake, 'zoomy/trips').length > n1, 'and reads the trips again');
  // the safety net: zoomy/status a minute apart
  const s0 = calls(fake, 'zoomy/status').length;
  await sleep(61000);
  ok(calls(fake, 'zoomy/status').length > s0, 'looks at zoomy/status about once a minute');
  const n2 = calls(fake, 'zoomy/trips').length;
  fake.bumpPosts('entry0001', 'trips');
  await sleep(65000);
  ok(calls(fake, 'zoomy/trips').length > n2, 'a missed change seen in zoomy/status reads the trips again');
  // the card goes away: the subscription ends 30 s later
  card.remove();
  await sleep(31000);
  ok(fake.live().length === 0 && calls(fake, 'unsubscribe').length >= 1, 'no subscription left 30 s after the last card went');
  eq(fake.readyListeners(), 0, 'no listener left on the connection');
};

CASES.cars_reread = async function () {
  // the car list is read again (the entity registry changed): the page keeps getting the car's changes
  const fake = FakeHass.make();
  const card = mount(fake, 'zoomy-trips-card', {});
  await until(() => all(card, 'tbody tr').length);
  card.hass = fake.newRegistry();
  await sleep(3000);
  eq(calls(fake, 'zoomy/cars').length, 2, 'the cars are read again after a registry change');
  const n0 = calls(fake, 'zoomy/trips').length;
  fake.emit('entry0001', ['trips']);
  await sleep(3500);
  eq(calls(fake, 'zoomy/trips').length, n0 + 1, 'and a change still reaches the page');
  fake.rename('entry0001', 'Renamed car');
  card.hass = fake.newRegistry();
  await until(() => txt(card, '.hs-kicker') === 'Zoomy · Renamed car', 6000);
  eq(txt(card, '.hs-kicker'), 'Zoomy · Renamed car', 'a renamed car: the heading follows');
};

CASES.shared = async function () {
  // the six tabs of the dashboard opened one after the other (Home Assistant takes a card off the page when another
  // tab is opened): one subscription for the car, never more
  const fake = FakeHass.make();
  const S = customElements.get('ll-strategy-dashboard-zoomy');
  const cfg = await S.generate({ type: 'custom:zoomy' }, fake.hass);
  const made = [];
  for (const v of cfg.views) {
    made.forEach((c) => c.remove());
    const c = document.createElement(v.cards[0].type.slice(7));
    c.setConfig(v.cards[0]); c.hass = fake.hass;
    document.getElementById('view').appendChild(c);
    made.push(c);
    await sleep(2500);
  }
  eq(calls(fake, 'zoomy/subscribe').length, 1, 'one subscription for six tabs');
  eq(calls(fake, 'zoomy/cars').length, 1, 'the car list is asked for once');
  // a card that comes back (its tab opened again) carries on, reading nothing new
  made.forEach((c) => c.remove());
  const n = fake.calls.length;
  document.getElementById('view').appendChild(made[1]);
  await sleep(6000);
  ok(fake.calls.length - n <= 1, 'a card put back reads nothing new (' + (fake.calls.length - n) + ' questions)');
  ok(all(made[1], 'tbody tr').length > 0, 'and still shows its table');
};

CASES.paused = async function () {
  const fake = FakeHass.make();
  const card = mount(fake, 'zoomy-performance-card', {});
  await until(() => all(card, '#list button').length);
  card.remove();
  await sleep(1000);
  const n = fake.calls.length;
  fake.emit('entry0001', ['dyno']);
  await sleep(20000);
  eq(fake.calls.length, n, 'off screen: nothing is read');
  document.getElementById('view').appendChild(card);
  await sleep(4000);
  ok(calls(fake, 'zoomy/dyno').length >= 2, 'back on screen: the change is read');
};

// ---- several cars ------------------------------------------------------------------------------------------------
CASES.multicar = async function () {
  const fake = FakeHass.make({ cars: TWO_CARS });
  const card = mount(fake, 'zoomy-trips-card', {});
  await until(() => all(card, 'tbody tr').length);
  const tabs = all(card, '.zcars button');
  eq(tabs.map((b) => norm(b.textContent)).join('|'), 'Test car|Second car', 'a car picker with both cars');
  eq(all(card, '.zcars button[aria-pressed="true"]').map((b) => norm(b.textContent)).join(), 'Test car', 'the first car to start with');
  ok(calls(fake, 'zoomy/trips').every((c) => c.entry_id === 'entry0001'), 'reads the first car');
  click(tabs[1]);
  await until(() => txt(card, '.hs-kicker') === 'Zoomy \u00b7 Second car' && all(card, 'tbody tr').length);
  eq(txt(card, '.hs-kicker'), 'Zoomy \u00b7 Second car', 'picked: the second car');
  ok(calls(fake, 'zoomy/trips', 'entry0002').length >= 1, 'reads the second car\'s trips');
  ok(calls(fake, 'zoomy/subscribe', 'entry0002').length === 1, 'and subscribes to it');
  eq(localStorage.getItem('zoomy.car'), 'entry0002', 'the pick is remembered in this browser');
  const d2 = fake.data('entry0002'), from = day0(Date.now()); from.setDate(from.getDate() - 29);
  eq(all(card, 'tbody tr').length, d2.trips.filter((x) => new Date(x.start) >= from).length, 'the second car\'s trips are shown');
  // another tab opened later shows the picked car
  const other = mount(fake, 'zoomy-charges-card', {});
  await until(() => all(other, 'tbody tr').length);
  eq(txt(other, '.hs-kicker'), 'Zoomy \u00b7 Second car', 'another card shows the picked car');
  ok(calls(fake, 'zoomy/charges').every((c) => c.entry_id === 'entry0002'), 'and reads it');
  // a card set to one car has no picker
  const fixed = mount(fake, 'zoomy-summary-card', { entry_id: 'entry0001' });
  await until(() => all(fixed, '.tile').length);
  ok(q(fixed, '.zcars').hidden, 'a card with entry_id has no picker');
  eq(txt(fixed, '.hs-kicker'), 'Zoomy \u00b7 Test car', 'and shows its own car');
  const gone = mount(fake, 'zoomy-summary-card', { entry_id: 'entry9999' });
  await until(() => txt(gone, '.zsay p'));
  ok(/not in Home Assistant any more/.test(txt(gone, '.zsay p')), 'a card set to a car that is gone says so');
  // a car added later appears in the picker (the entity registry changed)
  card.hass = fake.addCar({ entry_id: 'entry0003', title: 'Third car', slug: 'third_car', seed: 3 });
  await until(() => all(card, '.zcars button').length === 3, 8000);
  eq(all(card, '.zcars button').length, 3, 'a new car appears in the picker');
};

CASES.one_car_no_picker = async function () {
  const fake = FakeHass.make();
  const card = mount(fake, 'zoomy-charge-sheet-card', {});
  await until(() => all(card, '#list button').length);
  ok(q(card, '.zcars').hidden && !all(card, '.zcars button').length, 'one car: no picker');
};

// ---- performance -------------------------------------------------------------------------------------------------
CASES.performance = async function () {
  const fake = FakeHass.make();
  const card = mount(fake, 'zoomy-performance-card', {});
  await until(() => all(card, '#list button').length && all(card, '#runs tbody tr').length);
  eq(txt(card, '.hs-title'), 'ZOOMY \u2014 Performance', 'heading');
  ok(/^Best 296\.4 kW at 72 km\/h · Battery sagged to 341\.2 V at 288\.5 kW · 8 pulls · Newest /.test(txt(card, '#facts')), 'facts: ' + txt(card, '#facts'));
  eq(all(card, '#list button').length, 8, 'eight pulls');
  ok(!!q(card, '#plot svg'), 'the chart is drawn');
  eq(all(card, '#filters button').map((b) => norm(b.textContent)).join('|'), 'All|Eco|Normal|Sport', 'mode filters');
  click(q(card, '#filters button[data-m="Sport"]'));
  await sleep(200);
  eq(all(card, '#list button').length, 2, 'Sport: its pulls');
  click(q(card, '#filters button[data-m=""]'));
  click(q(card, '#cmp'));
  await sleep(100);
  // the Sport pull chosen above is still on the chart: compare it with another one
  const chosen = all(card, '#list button').findIndex((b) => b.getAttribute('aria-pressed') === 'true');
  click(all(card, '#list button')[chosen === 4 ? 5 : 4]);
  await sleep(200);
  eq(txt(card, '#count'), 'Comparing two pulls', 'compare two pulls');
  eq(all(card, '#list button[data-role="other"]').length, 1, 'the compared pull is marked');
  const holder = q(card, '#holder'), r = holder.getBoundingClientRect();
  holder.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: r.left + r.width * 0.4, clientY: r.top + r.height / 2, pointerType: 'mouse' }));
  await sleep(100);
  ok(/km\/h/.test(txt(card, '#readout')), 'pointing reads out: ' + txt(card, '#readout'));
  eq(all(card, '#runs tbody tr').length, 3, 'three timed runs');
  ok(/best 0–60 km\/h first/.test(txt(card, '#runs .sub')), 'runs sorted best 0-60 first');
  click(q(card, '#runs button[data-sort="date"]'));
  await sleep(100);
  ok(/newest first/.test(txt(card, '#runs .sub')), 'tap Date: newest first');
  ok(/61\.2 kWh/.test(txt(card, '#health')) && /97%/.test(txt(card, '#health')) && /from 42 charges/.test(txt(card, '#health')), 'battery health: ' + txt(card, '#health'));
  ok(calls(fake, 'zoomy/snapshot').length >= 1 && calls(fake, 'zoomy/dyno').length >= 1, 'reads zoomy/dyno and zoomy/snapshot');
  // the snapshot changes: runs read again; the dyno changes: pulls read again
  const s0 = calls(fake, 'zoomy/snapshot').length, d0 = calls(fake, 'zoomy/dyno').length;
  fake.emit('entry0001', ['snapshot']);
  await sleep(1500);
  eq(calls(fake, 'zoomy/snapshot').length, s0 + 1, 'a new snapshot: the runs and health are read again');
  fake.emit('entry0001', ['dyno']);
  await sleep(4500);
  eq(calls(fake, 'zoomy/dyno').length, d0 + 1, 'new dyno data: the pulls are read again');
};

CASES.performance_absent = async function () {
  const fake = FakeHass.make({ fail: { 'zoomy/dyno': { code: 'unknown_command', message: 'Unknown command.' } } });
  const card = mount(fake, 'zoomy-performance-card', {});
  await until(() => !q(card, '#gone').hidden);
  ok(/Zoomy is not loaded in Home Assistant/.test(txt(card, '#gone')), 'Zoomy not loaded: says so');
};

CASES.performance_empty = async function () {
  const fake = FakeHass.make({ empty: true });
  const card = mount(fake, 'zoomy-performance-card', {});
  await until(() => all(card, '#runs .sub').length && /No power measurements yet/.test(txt(card, '#plot') || ''));
  ok(/No power measurements yet/.test(txt(card, '#plot')), 'no pulls: says so');
  ok(/No timed runs yet/.test(txt(card, '#runs')), 'no runs: says so');
  ok(/No battery health figure yet/.test(txt(card, '#health')), 'no health: says so');
};

// ---- charge sheet ------------------------------------------------------------------------------------------------
CASES.charge_sheet = async function () {
  const fake = FakeHass.make();
  const card = mount(fake, 'zoomy-charge-sheet-card', {});
  await until(() => all(card, '#list button').length && q(card, '#svgbox svg'));
  const d = fake.data('entry0001');
  eq(txt(card, '.hs-title'), 'ZOOMY \u2014 Charge sheet', 'heading');
  eq(all(card, '#list button').length, 12, 'twelve charges with a curve');
  eq(txt(card, '#count'), '12 of ' + d.charges.length + ' charges have a curve, newest first', 'count line');
  eq(all(card, '#list button[aria-pressed="true"]').length, 1, 'one charge chosen');
  ok(all(card, '#list button')[1].getAttribute('aria-pressed') === 'true', 'the newest with 3 or more readings is chosen first');
  ok(/kWh added/.test(txt(card, '#facts')), 'facts: ' + txt(card, '#facts'));
  eq(all(card, '#tiles .tile').length, 3, 'three figures');
  click(all(card, '#list button')[0]);
  await until(() => /A very short record/.test(txt(card, '#csub') || ''), 3000);
  ok(/A very short record: 2 readings/.test(txt(card, '#csub')), 'the short one: ' + txt(card, '#csub'));
  ok(calls(fake, 'zoomy/charge_curve').every((c) => c.entry_id === 'entry0001'), 'curves read for its car');
  const plot = q(card, '#plot'), r = plot.getBoundingClientRect();
  click(all(card, '#list button')[3]);
  await sleep(500);
  plot.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: r.left + r.width * 0.5, clientY: r.top + 20, pointerType: 'mouse' }));
  await sleep(100);
  ok(!q(card, '#tip').hidden && /kW/.test(txt(card, '#tip')), 'pointing shows a reading: ' + txt(card, '#tip'));
  const k0 = calls(fake, 'zoomy/curve_keys').length;
  fake.emit('entry0001', ['curves']);
  await sleep(4000);
  eq(calls(fake, 'zoomy/curve_keys').length, k0 + 1, 'a new curve: the lists are read again');
};

CASES.charge_sheet_empty = async function () {
  const fake = FakeHass.make({ empty: true });
  const card = mount(fake, 'zoomy-charge-sheet-card', {});
  await until(() => !q(card, '#note').hidden && /curve/.test(txt(card, '#note')));
  eq(txt(card, '#note'), 'No charge has a curve yet.', 'no curves: says so');
};

// ---- the trip map ------------------------------------------------------------------------------------------------
CASES.tripmap = async function () {
  const fake = FakeHass.make();
  const card = mount(fake, 'zoomy-route-map-card', {});
  await until(() => window.__maps.length && window.__maps[0].fits.length);
  const map = window.__maps[0], d = fake.data('entry0001');
  eq(window.__mapCards.length, 1, 'the map code is loaded through Home Assistant\'s card helpers');
  eq(map.themeMode, 'dark', 'a dark map, like the page');
  eq(all(card, '#trips button').length, d.routeKeys.length, 'one row per stored route');
  ok(/^13 trips with the car's route, newest first$/.test(txt(card, '#count')), 'count line: ' + txt(card, '#count'));
  eq(txt(card, '#trips button .tag'), 'last', 'the newest is tagged last');
  const newest = d.routeKeys[0];
  const asked = calls(fake, 'zoomy/route');
  ok(asked.length === 1 && asked[0].key === newest.trip_start && asked[0].entry_id === 'entry0001', 'reads the newest route of its car');
  eq(map.paths.length, 3, 'the route and its start and end');
  ok(map.paths[0].points.length <= 400 && map.paths[0].points.length > 50, 'the route is thinned to 400 points or fewer: ' + map.paths[0].points.length);
  eq(map.paths[1].name + '|' + map.paths[2].name, 'Start|End', 'start and end markers');
  const pts = d.routes[newest.trip_start].points;
  eq(JSON.stringify(map.paths[1].points[0].point), JSON.stringify(pts[0]), 'start at the first point');
  eq(JSON.stringify(map.paths[2].points[0].point), JSON.stringify(pts[pts.length - 1]), 'end at the last point');
  const line = map.paths[0].points;
  eq(JSON.stringify([line[0].point, line[line.length - 1].point]), JSON.stringify([pts[0], pts[pts.length - 1]]), 'the thinned line still starts and ends there');
  ok(line.every((p, i) => i === 0 || p.timestamp >= line[i - 1].timestamp), 'the line\'s times run forward');  const box = map.fits[map.fits.length - 1].box;
  ok(box[0][0] === Math.min.apply(null, pts.map((p) => p[0])) && box[1][1] === Math.max.apply(null, pts.map((p) => p[1])), 'fitted to all its points');
  ok(/900 points from the car/.test(txt(card, '#facts')), 'facts: ' + txt(card, '#facts'));
  // another trip
  click(all(card, '#trips button')[3]);
  await until(() => calls(fake, 'zoomy/route').length === 2 && map.fits.length >= 2, 3000);
  eq(all(card, '#trips button')[3].getAttribute('aria-pressed'), 'true', 'tapped trip chosen');
  ok(map.paths.length === 3, 'its route drawn');
  // a route with no usable points
  click(all(card, '#trips button')[5]);
  await until(() => /no usable points/.test(txt(card, '#msg') || ''), 3000);
  ok(/has no usable points/.test(txt(card, '#msg')) && map.paths.length === 0, 'no usable points: says so, nothing drawn');
  // a route whose file is gone
  click(all(card, '#trips button')[12]);
  await until(() => /no longer stored/.test(txt(card, '#msg') || ''), 3000);
  ok(/no longer stored/.test(txt(card, '#msg')), 'gone: says so');
  // privacy
  ok(!COORD.test(card.shadowRoot.textContent.replace(/<[^>]+>/g, '')), 'no coordinate in the card\'s words');
  ok(Object.keys(localStorage).every((k) => k === 'zoomy.car'), 'nothing in the browser\'s storage but the picked car');
  ok(!window.__logs.some((l) => COORD.test(l)), 'nothing logged that looks like a coordinate');
  ok(!calls(fake, 'history/history_during_period').length && !Object.keys(fake.hass.states).some((id) => /^device_tracker\./.test(id)), 'no tracker, no history');
  // a new route arrives: the list is read again
  const k0 = calls(fake, 'zoomy/route_keys').length;
  fake.emit('entry0001', ['routes']);
  await sleep(4000);
  eq(calls(fake, 'zoomy/route_keys').length, k0 + 1, 'a new route: the list is read again');
};

CASES.tripmap_off = async function () {
  const fake = FakeHass.make({ routesOff: true });
  const card = mount(fake, 'zoomy-route-map-card', {});
  await until(() => /turned off/.test(txt(card, '#msg') || ''));
  ok(/GPS routes are turned off for this car/.test(txt(card, '#msg')), 'routes off: says how to turn them on');
};

CASES.tripmap_oldmap = async function () {
  const fake = FakeHass.make();
  const card = mount(fake, 'zoomy-route-map-card', { list_side: 'left' });
  await until(() => window.__maps.length && window.__maps[0].fits.length);
  const map = window.__maps[0];
  eq(map.layers.length, 3, 'an older map: the route as one line and two markers');
  eq(map.layers[0].kind + map.layers[1].kind + map.layers[2].kind, 'polylinemarkermarker', 'line, start, end');
  ok(/^Start \d\d:\d\d$/.test(map.layers[1].label) && /^End \d\d:\d\d$/.test(map.layers[2].label), 'markers say the times');
  ok(q(card, '#body').classList.contains('left'), 'list_side: left');
};

CASES.privacy = async function () {
  const fake = FakeHass.make({ cars: TWO_CARS });
  const tags = ['zoomy-summary-card', 'zoomy-trips-card', 'zoomy-charges-card', 'zoomy-route-map-card', 'zoomy-performance-card', 'zoomy-charge-sheet-card'];
  const cards = tags.map((t) => mount(fake, t, {}));
  await sleep(8000);
  ok(window.__errors.length === 0, 'no error and no unhandled rejection: ' + window.__errors.join(' / '));
  ok(window.__logs.length === 0, 'nothing logged: ' + window.__logs.slice(0, 3).join(' / '));
  const store = Object.keys(localStorage).concat(Object.keys(sessionStorage));
  ok(store.every((k) => k === 'zoomy.car'), 'browser storage: only the picked car (' + store.join(',') + ')');
  ok(!fake.calls.some((c) => !/^(zoomy\/|unsubscribe)/.test(c.type)), 'asks Home Assistant only zoomy/... questions');
  ok(cards.every((c) => !/webhook/i.test(c.shadowRoot.textContent)), 'no webhook mentioned on any page');
  const res = performance.getEntriesByType('resource').map((r) => r.name);
  ok(res.every((u) => u.indexOf(location.origin) === 0), 'nothing loaded from another host');
  ok(res.filter((u) => /\/zoomy_static\//.test(u)).every((u) => u.indexOf('/zoomy_static/' + V + '/') > 0), 'every file from the versioned folder');
};

// ---- run --------------------------------------------------------------------------------------------------------
(async function () {
  try {
    await import(BASE + 'zoomy.js');
    if (!CASES[NAME]) throw new Error('no case ' + NAME);
    await CASES[NAME]();
  } catch (e) {
    results.push([false, 'the case stopped: ' + (e && e.stack ? e.stack : e)]);
  }
  window.result = { case: NAME, results: results, errors: window.__errors.slice(), logs: window.__logs.slice() };
  window.done = true;
})();

window.ZOOMY_CASES = Object.keys(CASES);

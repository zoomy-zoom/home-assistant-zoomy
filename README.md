# Zoomy for Home Assistant

See your car's trips, charges, dyno runs, charge curves and trip routes in Home Assistant.
The Zoomy app in the car sends them to Home Assistant over your home Wi-Fi. Nothing goes
through the internet and nothing leaves your house.

## Install

1. In HACS, add this repository as a custom repository (type: Integration), then install **Zoomy**.
2. Restart Home Assistant.
3. Go to **Settings > Devices & services > Add integration > Zoomy**.

## Add a car

Choose one of two ways:

| Way | When | What you do |
|---|---|---|
| **Pair a car with the code it shows** | New cars | Start pairing in the Zoomy app in the car (the car must be on your home Wi-Fi). The car shows a 6-digit code. Type it in Home Assistant within 10 minutes. |
| **I already have a car sending to this Home Assistant** | Cars that already post to a webhook | Paste the webhook id the car sends to (or the whole webhook address). It is kept secret and never shown again. |

Each car gets its own device, called "Zoomy" and the car's name, with its sensors.
Add as many cars as you like. If the Zoomy app ever makes a new webhook id, use
**Reconfigure** on the car to paste the new one (or pair the car again).

## What you get

* **Sensors** for the last trip, the last charge, this month, last month and the battery:
  distance, duration, energy, regen, consumption, battery levels, outside temperature,
  charge cost and price, off-peak share, charger, battery health and more. They work in
  automations and history like any other sensor.
* **The ZOOMY dashboard** in the sidebar, added the first time you add a car. Six tabs:

  | Tab | What it shows |
  |---|---|
  | Summary | Last trip, last charge, this month, last month and the battery |
  | Trips | Every trip: totals, charts and a full table, for the last 30 days, a month or all |
  | Charges | Every charge, the same way, with cost and off-peak share |
  | Trip map | A trip's route on the map, from the car's own GPS route |
  | Performance | Power at each speed (dyno pulls), timed runs and battery health |
  | Charge sheet | One charge minute by minute: charging power and battery level |

  With two or more cars, each tab has a car picker. The dashboard updates itself when Zoomy is
  updated. You can rename it, hide it, delete it or take control and change it like any dashboard.
  If you delete it, it is not added again. If it could not be added, Repairs tells you how
  to add it (Settings > Dashboards > Add dashboard > Zoomy).
* **Six cards** for your own dashboards (search "Zoomy" in the card picker). Options:
  `entry_id` (one car only), `map_view` (summary: the tab its map button opens),
  `list_side: left` (trip map). See `custom_components/zoomy/frontend/README.md`.

## Privacy

* **Routes show where the car went.** They are kept only on this Home Assistant, in its
  cache folder (`.cache/zoomy/` in the config folder), one private file per trip. They are
  never in a sensor, an attribute, the logbook, the log or the `www` folder.
* **Routes are left out of backups.** Home Assistant and the Supervisor both skip the
  cache folder when they make a backup. After restoring a backup the car sends the routes
  it still has again.
* **One click turns routes off.** On the car's entry choose **Configure**: turn off
  **Keep GPS routes** to throw away every route the car sends (on by default), and tick
  **Delete the stored routes now** to remove the ones already kept.
* The dashboard reads routes over Home Assistant's signed-in connection, one trip at a time, and keeps
  them only on the screen. It logs nothing and keeps nothing in the browser but the car you picked.
* The webhook only answers the home network. The car posts plain HTTP on your Wi-Fi only.
* **Download diagnostics** has no webhook id, car name, route, trip time or trip value in it.
* Home Assistant's own web server writes webhook addresses to its log when debug logging
  is on for `homeassistant.components.webhook` or `homeassistant.components.http`, and
  warns with the address when a device outside your network tries a webhook. Do not share
  such logs.
* Removing a car deletes everything stored for it, its routes too.

## Remove

Delete the car under **Settings > Devices & services > Zoomy**. When the last car goes,
the ZOOMY dashboard goes too (unless you changed it).

---

## For the Zoomy app: what the car sends

Every post is one JSON object, `POST http://<home-assistant>:8123/api/webhook/<webhook id>`,
from the home Wi-Fi. Every post has `"source": "zoomy"`, `"version"` (the app version) and
`"sent_at"` (local ISO time). Optional, accepted when present or absent: `"car_id"` (1 to
128 printable characters; once Home Assistant knows a car's id, a post with another id is
refused with 409) and `"format"` (a number; additive, only recorded).

| `kind` | Body | Reply (HTTP 200) |
|---|---|---|
| none, `""`, `"snapshot"` | the snapshot (`last_trip`, `last_charge`, `this_month`, `last_month`, `trips`, `charges`, `health`, `runs`, `drain`, ...) | `{"ok": true, "kind": "snapshot"}` |
| `trips`, `charges` | `{"rows": [...]}`, key `start`, at most 1000 rows | `{"ok": true, "kind", "stored", "skipped", "have"}` |
| `dyno` | `envelope`, `regen_envelope`, `best`, `sag` replaced; `pulls` merged by `when` | `{"ok": true, "kind": "dyno", "stored", "skipped", "have"}` |
| `charge_curve` | `{"charge_start", "points": [[minutes, soc, kw], ...]}` | `{"ok": true, "kind": "charge_curve", "stored": 1, "n", "have"}` |
| `route` | `{"trip_start", "trip_end", "km", "points": [[lat, lon], ...]}` | `{"ok": true, "kind": "route", "stored": 1, "n", "have"}`; with routes turned off `{"ok": true, "stored": 0, "discarded": 1, "store_routes": false, ...}` |
| `have` | `{"what": "trips" \| "charges" \| "charge_curves" \| "routes"}` | `{"ok": true, "kind": "have", "what", "keys": [...]}` (routes add `"store_routes"`; with routes off the keys include the routes thrown away, so the car stops sending them) |

Refused: 400 / 409 / 413 / 500 with `{"ok": false, "error": "<under 120 characters>"}`.
An **empty 200** means the post did not reach Zoomy (unknown webhook id, or a sender outside
the home network). Limits: body 2 MB, nesting 32 levels, keys 200 characters, 2000 points
per curve or pull, 60,000 route points.

### Pairing (car side, to be built)

1. Find Home Assistant by mDNS (`_home-assistant._tcp`), private IPv4 only.
2. Make a webhook id (16 to 128 of `A-Z a-z 0-9 - _`, random) and a 6-digit code; show the code.
3. `POST /api/webhook/zoomy_pair` with `{"code": "123456", "car_id": "...", "webhook_id": "...", "name": "...", "version": "..."}`
   (`code` as text; `name` and `version` optional). Replies: 200 `{"ok": true, "kind": "pair", "status": "waiting", "expires_in": 600}`;
   409 when Home Assistant is not waiting; 429 when too many cars pair or posts come too fast;
   400 for a bad body; an empty 200 when no "Pair a car" step is open (keep showing the code and try again).
4. Post `have` to your own webhook every few seconds: a JSON reply means you are paired.

Pairing a car that is already added moves it to its new webhook id.

## For the pages: websocket commands

The dashboard reads everything over Home Assistant's signed-in websocket. Every command
takes an optional `entry_id` (required when there are two or more cars).

| Command | Answer |
|---|---|
| `zoomy/cars` | `{"cars": [{entry_id, title, device_id, app_version, last_update, store_routes, counts, entities: {sensor key: entity id}}]}` |
| `zoomy/status` | counts, last post times, errors (no payload) |
| `zoomy/snapshot` | `{"snapshot", "received"}` (runs, health, drain, ...) |
| `zoomy/trips`, `zoomy/charges` | `{"rows": [...], "source": "store" \| "snapshot"}` newest first |
| `zoomy/dyno` | `{envelope, regen_envelope, best, sag, pulls}` |
| `zoomy/curve_keys`, `zoomy/charge_curve` (`charge_start`) | the stored charge curves |
| `zoomy/route_keys`, `zoomy/route` (`trip_start`) | route list (no coordinates); one route's points |
| `zoomy/subscribe` | an event `{entry_id, changed, counts}` after each post that changed something |

Users who may read the car's sensors may read its data (administrators always may).

## For developers

```
custom_components/zoomy/
  __init__.py       set-up per car, unload, removal
  car.py            one car: .storage sets, route files, the webhook handler
  logic.py          the rules for every post (pure Python)
  summary.py        the sensor maths (pure Python)
  pairing.py        pairing codes, expiry, rate limits (pure Python)
  pair_webhook.py   the zoomy_pair webhook while a pairing step waits
  config_flow.py    pair / existing car / reconfigure / options
  sensor.py         40 sensors
  websocket_api.py  zoomy/... commands
  diagnostics.py    redacted diagnostics
  frontend.py       serves frontend/ at /zoomy_static/<version>/ + loads frontend/zoomy.js
  dashboard.py      adds the ZOOMY dashboard once (strategy custom:zoomy)
  frontend/         the pages, cards and the dashboard strategy (see frontend/README.md)
```

Tests: `pip install -r requirements_test.txt` in a virtual environment, then `python run_tests.py`. The pure tests also run with plain Python:
`python -m unittest discover -s tests/pure -t .`

Frontend tests (Node 20 or later; the browser tests need Chrome or Chromium, always run headless with a fresh profile):

* `node --test tests/frontend/unit.test.mjs`
* `node tests/frontend/run.js` (cases and layout; add `shots` for screenshots in `tests/frontend/shots/`)

### Home Assistant APIs this relies on (checked against 2026.10.0)

| What | Where |
|---|---|
| `webhook.async_register(..., local_only=True, allowed_methods=["POST"])`; unknown id or non-local sender gets a bare 200 | `homeassistant/components/webhook/__init__.py:54-95, 164-174, 190-207` |
| Serving a folder: `hass.http.async_register_static_paths([StaticPathConfig(url, path, cache_headers=True)])` (31-day cache) | `components/http/server.py:77-82, 367`; `components/http/static.py:13-15` |
| Loading a module on every page: `frontend.add_extra_js_url` | `components/frontend/__init__.py:427-433` |
| Custom dashboard strategy `custom:zoomy` = element `ll-strategy-dashboard-zoomy` (waited for up to 5 s); `window.customStrategies` | frontend `20260930.3`: `src/panels/lovelace/strategies/get-strategy.ts:30-31, 100-116, 133-150`; `src/data/lovelace_custom_strategies.ts:3-25` |
| Strategy class: static `generate(config, hass)`, `registryDependencies` (default: entities, devices, areas, floors), `getCreateSuggestions` | `src/panels/lovelace/strategies/types.ts:13-19, 29-35`; `get-strategy.ts:282-308, 349-358`; `src/data/lovelace/dashboard.ts:37-40` |
| Add dashboard lists custom strategies by `type` without `custom:` | `src/panels/config/dashboard/dialog-new-dashboard.ts:111, 191, 256` |
| Panel view: one card, `layout = "panel"`, host `height: 100%` | `src/panels/lovelace/views/hui-panel-view.ts:102-125, 127-131` |
| Custom cards: `window.customCards` entries | `src/data/lovelace_custom_cards.ts:21-31, 67-84` |
| `hass.formatEntityStateToParts` (money as currency parts, else value / blank / unit) | `src/types.ts:273-293`; `src/common/entity/compute_state_display.ts:29-38, 137-193` |
| The map: `ha-map` (2026.10: no Leaflet, no `layers`; `paths`, `fitBounds`, `themeMode`; a marker at every path point; reads states and config from context) | `src/components/map/ha-map.ts:322-394, 983-1012, 1204-1300`; loaded by the map card `src/panels/lovelace/cards/hui-map-card.ts:30, 184-197`; `window.loadCardHelpers` `src/panels/lovelace/ha-panel-lovelace.ts:46` |
| The map in 2026.9 (Leaflet, `layers`, `leafletMap`) | frontend `20260826.7` (Home Assistant 2026.9.4): `src/components/map/ha-map.ts:128-161`; same strategy tags `get-strategy.ts:111-112` |
| Subscriptions: `connection.subscribeMessage(cb, msg, {resubscribe: false})` are dropped on a reconnect; `ready` fires after it | home-assistant-js-websocket `lib/connection.ts:138-161, 303-341, 441-458` (master 84185e8) |
| Creating a dashboard then saving a strategy config (as Home Assistant does for its Map dashboard) | `components/lovelace/__init__.py:415-434`; collection not kept in `LovelaceData` `:109-116`, made at `:291-308`; reached via the list handler `helpers/collection.py:572, 592`; single-word url `components/lovelace/dashboard.py:289-306` |
| Cache folder, not in backups | `core_config.py:637-645`; `components/backup/const.py:16-28` (`.cache/*`), used at `components/backup/manager.py:1913`; Supervisor `supervisor/homeassistant/module.py:62-75` (main, a2627a1) |
| `probatio` replaces voluptuous (voluptuous is an alias) | `homeassistant/__init__.py:3-11`; `pyproject.toml:81` |
| `OptionsFlowWithReload`; update listeners with reload helpers break in 2026.12 | `config_entries.py:4209`, `:3301`, `:3721` |
| Flow ended or closed: `FlowHandler.async_remove` | `data_entry_flow.py:905`, called at `:464-474` |
| Sensor state classes per device class (energy and money: totals only) | `components/sensor/const.py:816-871` |
| `kWh/100km` | `const.py:548-554` |

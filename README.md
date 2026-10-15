# Zoomy for Home Assistant

See your car's trips, charges, dyno runs, charge curves and trip routes in Home Assistant.
The Zoomy app in the car sends them straight to Home Assistant over your home Wi-Fi. The
car's data never goes through the internet, and it is kept only on your Home Assistant.

You need Home Assistant 2026.9 or later, [HACS](https://hacs.xyz), and a car with the
Zoomy app that joins your home Wi-Fi.

## Install

1. **Download Zoomy in HACS.**
   [![Open in HACS](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=zoomy-zoom&repository=home-assistant-zoomy&category=integration)
   If the button does not work: in HACS, open the menu (three dots) > **Custom repositories**,
   add `https://github.com/zoomy-zoom/home-assistant-zoomy` with type **Integration**, then
   search for **Zoomy** and press **Download**.
2. **Restart Home Assistant** (Settings > System > Restart).
3. **Add a car.**
   [![Add Zoomy](https://my.home-assistant.io/badges/config_flow_start.svg)](https://my.home-assistant.io/redirect/config_flow_start/?domain=zoomy)
   or go to **Settings > Devices & services > Add integration > Zoomy**.

That is all: no YAML, no files to edit. The ZOOMY dashboard appears in the sidebar as soon as
the first car is added.

## Screenshots

<!--
  Screenshot placeholders. Take them from a test car or with made-up data,
  never from a real car's route (a route shows where someone lives).
  Save them in docs/images/ and remove the comment marks:

  ![The Summary tab](docs/images/summary.png)
  ![The Trips tab](docs/images/trips.png)
  ![The Trip map tab](docs/images/trip-map.png)
  ![The Performance tab](docs/images/performance.png)
  ![Add integration > Zoomy](docs/images/add-integration.png)
-->

_Screenshots will be added here._

## Add a car

Choose one of two ways:

| Way | When | What you do |
|---|---|---|
| **Pair a car with the code it shows** | New cars (a Zoomy app version with Home Assistant pairing) | Start pairing in the Zoomy app in the car (the car must be on your home Wi-Fi). The car shows a 6-digit code. Type it in Home Assistant within 10 minutes. |
| **I already have a car sending to this Home Assistant** | Cars that already post to a webhook | Paste the webhook id the car sends to (or the whole webhook address). It is kept secret and never shown again. |

Each car gets its own device, called "Zoomy" and the car's name, with its sensors.
Add as many cars as you like. If the Zoomy app ever makes a new webhook id, use
**Reconfigure** on the car to paste the new one (or pair the car again). The car keeps its
history either way.

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

## What stays at home

* **The car sends its data straight to your Home Assistant** over your home Wi-Fi, never
  over the internet. This integration sends none of it anywhere else and makes no internet
  connections of its own.
* **Everything the car sends is kept in your Home Assistant's own folders** (`.storage`
  and `.cache/zoomy`), and is deleted when you remove the car.
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
  The map pictures under a route come from the same map service as Home Assistant's own maps, so
  that service sees which area is on screen (as with any map in Home Assistant).
* Anyone who may see the car's sensors in Home Assistant may also see its routes on the dashboard.
* The webhook only answers the home network. The car posts plain HTTP on your Wi-Fi only.
* **Download diagnostics** has no webhook id, car name, route, trip time or trip value in it.
* Home Assistant's own web server writes webhook addresses to its log when debug logging
  is on for `homeassistant.components.webhook` or `homeassistant.components.http`, and
  warns with the address when a device outside your network tries a webhook. With debug
  logging on for `homeassistant.components.websocket_api` it also writes every message it
  sends to the browser, routes included. Do not share such logs.
* Removing a car deletes everything stored for it, its routes too.

## Remove

1. Delete each car under **Settings > Devices & services > Zoomy**. This deletes everything
   stored for it, its routes too. When the last car goes, the ZOOMY dashboard goes too
   (unless you changed it).
2. Then remove **Zoomy** in HACS and restart Home Assistant.

---

## For the Zoomy app: pairing and posts

The exact contract for the car side (finding Home Assistant, the `zoomy_pair` webhook, codes,
expiry, replies, and every post kind with its limits) is in [PAIRING.md](PAIRING.md).

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
| `zoomy/runs` | `{"rows": [...], "source": "store" \| "snapshot"}` timed runs, newest first |
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
  brand/            icon.png (256 px) and icon@2x.png (512 px), drawn by scripts/make_brand_images.py
PAIRING.md          the car-side contract (pairing and posts)
CHANGELOG.md        what changed in each version
.github/workflows/  hassfest, the HACS check and the tests, run on GitHub
```

Tests: `pip install -r requirements_test.txt` in a virtual environment, then `python run_tests.py`. The pure tests also run with plain Python:
`python -m unittest discover -s tests/pure -t .` (they include `tests/pure/test_packaging.py`, offline
checks of the manifest, `hacs.json`, the translations, the icons and the brand images in the
style of hassfest and the HACS check, and of the numbers in PAIRING.md). Before a push, put
any names, places and addresses that must never be published in `tests/private_words.txt`
(one per line; git ignores the file): the tests then fail if any file holds one of them.

A new version: change `version` in `custom_components/zoomy/manifest.json` (the pages are
served under that version, so browsers fetch them fresh), add a section to CHANGELOG.md, and
make a GitHub release whose tag is that version.

Frontend tests (Node 20 or later; the browser tests need Chrome or Chromium, always run headless with a fresh profile):

* `node --test tests/frontend/unit.test.mjs`
* `node tests/frontend/run.js` (cases and layout; add `shots` for screenshots in `tests/frontend/shots/`; `ZOOMY_CASES=hostile,privacy` runs only those cases)

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
| A custom integration's own brand images: `custom_components/<domain>/brand/icon.png` etc., served at `/api/brands/integration/<domain>/<image>`; logo and dark images fall back to `icon.png` (2026.9.0 and 2026.10.1) | `components/brands/__init__.py:136-156, 243-274`; `components/brands/const.py:27-55`; `loader.py:699-707, 903-905`; frontend `20260930.2` builds `/api/brands/integration/${domain}/${dark_}${type}.png` |
| HACS accepts `custom_components/<domain>/brand/icon.png` in place of an entry in home-assistant/brands | hacs/integration `custom_components/hacs/validate/brands.py:32-40` (main) |

## Licence

Copyright (C) 2026 Zoomy. This program is free software under the GNU General Public License, version 3 (GPL-3.0): see [LICENSE](LICENSE).

This licence covers only the Home Assistant integration in this repository. The Zoomy app in the car is a separate, paid product under its own private licence (see zoomyzoom.com.au).

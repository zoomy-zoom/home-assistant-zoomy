# frontend/: the ZOOMY dashboard and its cards

Everything in this folder is served by the integration at `/zoomy_static/<integration version>/`
(`frontend.py`), with a 31-day browser cache: a new version gets a new address, so nothing needs a
`?v=`. `zoomy.js` is loaded as a module on every Home Assistant page (`add_extra_js_url`). The files hold
no secrets and no personal data, and load nothing from any other host.

| File | What it is |
|---|---|
| `zoomy.js` | The entry module: imports the rest, defines the dashboard strategy, offers "Zoomy" in Settings > Dashboards > Add dashboard (`window.customStrategies`). |
| `strategy.js` | The dashboard strategy `custom:zoomy` (element `ll-strategy-dashboard-zoomy`): six panel views, one card each. |
| `core.js` | What every card shares: the HOME look, the list of cars, the car picker, one live subscription per car, the card base class. |
| `summary.js` | `custom:zoomy-summary-card`: last trip, last charge, this month, last month, battery (the integration's sensors). |
| `charts.js` | `custom:zoomy-trips-card` and `custom:zoomy-charges-card`: totals, four charts and a full table for a period. |
| `trip-map.js` | `custom:zoomy-route-map-card`: the trips with a stored route, and the chosen route on Home Assistant's own map. |
| `performance.js` | `custom:zoomy-performance-card`: power against speed (dyno pulls), timed runs, battery health. |
| `charge-sheet.js` | `custom:zoomy-charge-sheet-card`: one charge minute by minute, three figures, the charges with a curve. |

## The dashboard

The integration adds a storage dashboard (sidebar "ZOOMY", url `/zoomy`) whose whole saved config is
`{"strategy": {"type": "custom:zoomy"}}` (see `../dashboard.py`). The strategy builds the views each time
the dashboard opens, so they always match the installed version:

| Tab | Path | Card |
|---|---|---|
| Summary | `summary` | `custom:zoomy-summary-card` (`map_view: map`) |
| Trips | `trips` | `custom:zoomy-trips-card` |
| Charges | `charges` | `custom:zoomy-charges-card` |
| Trip map | `map` | `custom:zoomy-route-map-card` |
| Performance | `dyno` | `custom:zoomy-performance-card` |
| Charge sheet | `charge-sheet` | `custom:zoomy-charge-sheet-card` |

Strategy option `entry_id` (`{"strategy": {"type": "custom:zoomy", "entry_id": "..."}}`) makes a dashboard
for one car. The views do not depend on the registries (`registryDependencies: []`).

## The cards

Every card can also be put on any other dashboard (they are in the card picker). Options:

| Option | Cards | Meaning |
|---|---|---|
| `entry_id` | all | Show this car only (its config entry id). Left out: the car the viewer picked, with a car picker when there are two or more cars. |
| `map_view` | summary | The view path the "Show on the map" button opens on the same dashboard (no button when left out). |
| `list_side` | trip map | `left` puts the list of trips on the left of the map (default right). |

The cards paint their own page in the HOME look (dark, like the HOME overview page they come from), so the
dashboard looks the same in a light or a dark theme. Sizes follow the card's own width (container queries),
so a card works full width in a panel view and narrower in a sections view or on a phone.

## Where the data comes from

Only Home Assistant's signed-in websocket, never `/local`, never `www`, never a sensor attribute:

| Card | Asks |
|---|---|
| all | `zoomy/cars` (the cars this user may read, their sensors' entity ids), `zoomy/subscribe` (an event after every post that changed something), `zoomy/status` (once a minute, a safety net for a missed event) |
| summary | the integration's sensors (`hass.states`), written by Home Assistant's own formatter |
| trips, charges | `zoomy/trips`, `zoomy/charges` (read again after a change to that kind, or a new snapshot) |
| performance | `zoomy/dyno`, `zoomy/snapshot` (runs, health) |
| charge sheet | `zoomy/curve_keys`, `zoomy/charges`, `zoomy/charge_curve` (the chosen charge only) |
| trip map | `zoomy/route_keys`, `zoomy/trips`, `zoomy/route` (the chosen trip only) |

Each card sends its car's `entry_id` with every question. The subscription is shared by every card of a
car and ends 30 s after the last of them leaves the screen; it is made again after a reconnect or when the
car's entry is reloaded. Repeating timers skip their turn while a card is off screen.

Privacy: a route's points are held only inside the line on the map, for the trip on screen; nothing is
logged; the only thing kept in the browser is the picked car's entry id (`localStorage` key `zoomy.car`).

## Where the pages came from

The Trips / Charges, Performance, Charge sheet and Trip map cards are the HOME-styled pages of the first
ZOOMY dashboard (iframe pages and one card), ported to cards: the same look, words, numbers and maths, now
reading `zoomy/...` for the car the card shows. The trip map draws only the car's own stored route (no cloud
tracker, no history). Home Assistant 2026.10's map has no Leaflet: there the route is drawn with `paths`
only (thinned to 400 points, start and end as one-point paths); an older map is drawn with Leaflet layers.

## Tests

* `python -m unittest tests.pure.test_frontend_static` - every import resolves, the names match the backend,
  no web address, secret, coordinate, log line or storage use, `node --check` on each file.
* `node --test tests/frontend/unit.test.mjs` - the pure helpers (strategy, car choice, status marks, route list,
  thinning).
* `node tests/frontend/run.js [cases] [layout] [compare] [shots]` - headless Chrome against a fake Home
  Assistant (`tests/frontend/www/fake-hass.js`, made-up data): taps, live changes, several cars, privacy,
  layout at seven widths, and (with `ZOOMY_ORIGINALS` set to the folder of the original pages) the same words,
  numbers and chart scales as the original pages.

# frontend/ : the ZOOMY pages, cards and dashboard strategy (TO BE WRITTEN)

This folder is the hook for the frontend. The backend is done and waits for these files.

* Everything here is served at `/zoomy_static/<integration version>/` (frontend.py), with a
  31-day browser cache: a new version gets a new address, so no `?v=` is needed. Use
  relative addresses (`new URL("./charts.html", import.meta.url)`, `import "./cards.js"`).
  Do not put anything secret or personal here: the folder is public to the local network.
* `zoomy.js` (const.FRONTEND_ENTRY) is loaded as a module on every Home Assistant page once
  it exists. It must:
  * define `ll-strategy-dashboard-zoomy` with a static `generate(config, hass)` that returns
    the views Summary, Trips, Charges, Trip map, Dyno, Charge sheet (the dashboard the
    integration adds is `{"strategy": {"type": "custom:zoomy"}}`, url `/zoomy`);
  * get the cars with `hass.callWS({type: "zoomy/cars"})`: each car has `entry_id`, `title`
    and `entities` (sensor key -> entity id; never build entity ids by hand, users rename them);
    with two or more cars, show one set of tabs per car or a car picker, and pass `entry_id`;
  * define the custom cards it uses (trip map on HA's own `ha-map`, from `zoomy/route_keys` +
    `zoomy/route`, never the MG cloud tracker);
  * push `{type: "zoomy", name: "Zoomy", description: "...", strategyType: "dashboard"}` onto
    `window.customStrategies` (create the array if missing) so "Zoomy" shows in
    Settings > Dashboards > Add dashboard.
* Data only from the websocket commands listed in ../websocket_api.py and the README
  (`zoomy/trips`, `zoomy/charges`, `zoomy/dyno`, `zoomy/curve_keys`, `zoomy/charge_curve`,
  `zoomy/snapshot` for runs / health / drain, `zoomy/status`, `zoomy/subscribe` for live updates).
  No `/local` files, nothing under `www`, no tokens in pages.
* Sensor keys for the Summary tiles: see summary.py `sensor_values()` (40 keys) and
  strings.json `entity.sensor`.

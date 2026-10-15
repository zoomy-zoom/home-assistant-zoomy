# Changelog

All notable changes to the Zoomy integration. Versions follow
[semantic versioning](https://semver.org); the version is the one in
`custom_components/zoomy/manifest.json`.

## 0.1.0 (not released yet)

The first version.

### Added

* **Add integration > Zoomy**, two ways to add a car:
  * **Pair a car with the code it shows.** The car offers a 6-digit code on the
    `zoomy_pair` webhook. The webhook is open only while the step waits, answers
    only the home network, and is rate-limited. Codes expire after 10 minutes,
    and the step ends after 5 wrong codes. See PAIRING.md.
  * **I already have a car sending to this Home Assistant.** Paste the webhook id
    (or the whole address) into a password field. The id is never shown again.
* One entry and one device ("Zoomy" plus the car's name) per car. Several cars
  can be added.
* The car's webhook takes today's posts unchanged: the snapshot (no `kind`),
  `trips`, `charges`, `dyno`, `charge_curve`, `route`, `runs` (Home Assistant
  keeps the best 500) and `have`. `car_id` and `format` are optional.
* 40 sensors from the snapshot: last trip, last charge, this month, last month,
  battery, battery health, app version and last update.
* Storage in `.storage`. GPS routes are kept as one private file per trip under
  `.cache/zoomy`, which backups leave out. Routes never appear in states,
  attributes or the log.
* **Options:** "Keep GPS routes" (on by default) and "Delete the stored routes now".
* **Reconfigure:** give a car a new webhook id and keep its history.
* **The ZOOMY dashboard**, added once when the first car is set up. It is built
  by the integration's own dashboard strategy (`custom:zoomy`), so it always
  matches the installed version. Tabs: Summary, Trips, Charges, Trip map,
  Performance, Charge sheet. A car picker appears when there are two or more cars.
* Six cards for your own dashboards. They read data only over Home Assistant's
  signed-in websocket (`zoomy/...` commands).
* Diagnostics with no webhook id, car name, route, trip time or trip value in them.
* A Repairs issue when the dashboard could not be added by itself.
* The integration's own icon (`brand/icon.png`).

# Zoomy and Home Assistant: the car-side contract

This is for whoever builds the Home Assistant sender in the Zoomy app. It
describes exactly what the Zoomy integration (domain `zoomy`, version 0.1.0)
accepts and how it answers. The Home Assistant side is built and tested. The car
side is not built yet.

Contents:

1. [Ground rules](#1-ground-rules)
2. [Pairing a car](#2-pairing-a-car)
3. [The posts the car sends](#3-the-posts-the-car-sends)
4. [What the car should do with each reply](#4-what-the-car-should-do-with-each-reply)
5. [Changes to this contract](#5-changes-to-this-contract)

Values in this file come from `custom_components/zoomy/pairing.py`,
`logic.py`, `car.py` and `config_flow.py`. `tests/pure/test_packaging.py`
checks that the numbers here still match the code.

---

## 1. Ground rules

* **Plain HTTP on the home Wi-Fi only.** The car posts to a private IPv4
  address of Home Assistant on the saved home network. It never posts over
  mobile data or the internet. Both webhooks are registered `local_only`, so
  Home Assistant ignores a sender outside the home network and answers it with
  an empty 200.
* **Method:** `POST` only. Body: one JSON object, UTF-8. The `Content-Type` header
  is not checked; send `application/json`.
* **One post at a time.** Wait for each reply before sending the next post.
* **The car's webhook id is its password.** Never show it, never log it, never
  send it anywhere except in the pairing post below.
* **Empty 200 = "did not reach Zoomy".** Home Assistant gives a bare `200` with
  no body when it does not know the webhook id, or when the sender is not on
  the home network. Every answer from Zoomy itself is JSON, even when Zoomy
  refuses a post. So an empty 200 never means success.

---

## 2. Pairing a car

### 2.1 Steps

| # | Car | Customer in Home Assistant |
|---|---|---|
| 1 | | Settings > Devices & services > Add integration > **Zoomy** > **Pair a car with the code it shows**. While this step is open (at most 10 minutes since it was last shown), Home Assistant listens on the webhook `zoomy_pair`. |
| 2 | Finds Home Assistant by mDNS (see 2.2). | |
| 3 | Makes its own webhook id and a 6-digit code, and shows the code on screen. | |
| 4 | `POST /api/webhook/zoomy_pair` with the offer (2.3). Repeats every 15 s until the reply is `"status": "waiting"`. | |
| 5 | | Types the code and presses Submit. |
| 6 | Polls its own webhook with a `have` post every 5 s. A JSON reply with `"ok": true` means it is paired (2.6). | Home Assistant makes the car's entry (title = the car's name, else "Zoomy car"). The car's device is called "Zoomy" plus that name. |
| 7 | Starts a normal pass: the snapshot, then the detail posts (section 3). | The ZOOMY dashboard appears in the sidebar the first time a car is added. |

### 2.2 Finding Home Assistant

Home Assistant announces itself as `_home-assistant._tcp.local.` (from the
`zeroconf` integration, which is part of the default set-up):

* **Address and port:** the service's addresses and port. The port is usually 8123.
  Use only a private IPv4 address: `10.0.0.0/8`, `172.16.0.0/12` or `192.168.0.0/16`.
* **TXT properties:** `location_name`, `uuid`, `version`, `internal_url`,
  `external_url`, `base_url`. Keep `uuid`. If the address changes later,
  find the announcement with the same `uuid` again.
* If Home Assistant is set up for HTTPS only, plain HTTP will not reach it. The car
  should then say so, and not fall back to the internet.
* If nothing is announced (some set-ups turn mDNS off), let the customer type
  the address and port.

Source: `homeassistant/components/zeroconf/__init__.py:246-282`,
`homeassistant/components/zeroconf/const.py:13` (Home Assistant 2026.10.1).

### 2.3 The pairing post

`POST http://<address>:<port>/api/webhook/zoomy_pair`

```json
{
  "code": "042917",
  "car_id": "zc-7f3a9c2e51d04b8e",
  "webhook_id": "kq3VZ1uYw0a8Hf2Lr9Tn5Xc7Pe4Ms6Dj",
  "name": "Blue car",
  "version": "4.19.0"
}
```

| Field | Required | Rule |
|---|---|---|
| `code` | yes | Exactly 6 digits **as text** (`"042917"`, not `42917`). A number is refused. Use a random code. |
| `car_id` | yes | 1 to 128 printable ASCII characters, no spaces (`!` to `~`). Must stay the same for the car for good, also after the app is reinstalled. It keeps two cars' data apart. |
| `webhook_id` | yes | 16 to 128 characters from `A-Z a-z 0-9 - _`, random. Advice: 32 or more characters from a secure random source. Make a new one each time the car pairs. |
| `name` | no | The car's name for Home Assistant. Control characters become spaces, extra spaces are dropped, and it is cut to 40 characters. Leave it out to get "Zoomy car". |
| `version` | no | The app version (text). Accepted, not used yet. |

Body: at most 4096 bytes. Other fields are ignored.

### 2.4 Replies to the pairing post

| HTTP | Body | Meaning | Car does |
|---|---|---|---|
| 200 | `{"ok": true, "kind": "pair", "status": "waiting", "expires_in": 600}` | The offer is held for 600 s. | Stop posting the offer. Keep showing the code. Poll its own webhook (2.6). |
| 200 | *(empty)* | Home Assistant is not waiting for a car: no "Pair a car" step is open. It can also mean the sender is not on the home network. | Keep showing the code. Post the offer again in 15 s. |
| 409 | `{"ok": false, "error": "Home Assistant is not waiting for a car. ..."}` | A step was open but has just timed out. | Same as the empty 200. |
| 429 | `{"ok": false, "error": "too many pairing posts, wait a minute"}` | More than 5 offers from this address in a minute, or more than 30 from everyone in 10 minutes. | Wait 60 s, then post again. |
| 429 | `{"ok": false, "error": "too many cars are pairing, try again in a few minutes"}` | 10 different cars hold offers already. | Wait 2 minutes, then post again. |
| 400 | `{"ok": false, "error": "..."}` | The body is wrong: not JSON, not an object, or a bad `code`, `car_id` or `webhook_id`. The text says which. | Show the error. This is a bug in the car: do not repeat the same body. |
| 413 | `{"ok": false, "error": "body too large"}` | The body is over 4096 bytes. | A bug in the car. |
| 500 | `{"ok": false, "error": "internal error"}` | Unexpected error in Home Assistant. | Try again in 15 s. |

Every `error` text is under 120 characters, in plain English and safe to show
on screen. It never repeats the webhook id.

### 2.5 Timing and limits

| What | Value |
|---|---|
| An offer is kept | 600 s from the post that made it (`expires_in`). A new post from the same `car_id` replaces its offer and starts the 600 s again. |
| Home Assistant listens on `zoomy_pair` | Only while a "Pair a car" step is open, for at most 600 s after the step was last shown. When the last step closes, every held offer is dropped. |
| Offers per sender | 5 a minute (by IP address) |
| Offers from everyone | 30 per 10 minutes |
| Offers held at once | 10 cars |
| Wrong codes typed | 5 per step; the fifth ends the step ("Too many wrong codes. Start again.") |
| Two cars offer the same code | Neither is taken. The customer is told to start pairing again in the car. |
| Code check | Every held code is compared in constant time. |

If the car is not paired within `expires_in` seconds, it should make a **new
code** (and may keep its webhook id), show it, and post again.

### 2.6 How the car learns it is paired

After the `"waiting"` reply, the car posts to **its own** webhook every 5 s:

`POST /api/webhook/<its webhook_id>` with `{"source": "zoomy", "kind": "have", "what": "trips", "version": "...", "sent_at": "...", "car_id": "..."}`

* **Empty 200:** not paired yet. Home Assistant does not know this webhook id
  yet.
* **`{"ok": true, "kind": "have", "what": "trips", "keys": [...]}`:** paired.
  Save the address, the `uuid`, the `webhook_id` and the `car_id`. Stop showing
  the code.
* **Stop polling** when the offer has expired (600 s). At Home Assistant's
  `info` log level, each poll to an unknown webhook id writes that id to
  Home Assistant's log. `info` is off by default, but keep the polling short.

### 2.7 Pairing again

* **The same car pairs again** (same `car_id`, for example after a reinstall):
  Home Assistant moves the car's entry to the new webhook id and keeps all its
  history. The customer sees "This car is paired again". The old webhook id
  stops working at once.
* **The new webhook id is already in use** by something else in
  Home Assistant: the step ends with "Start pairing again in the car". The car
  then makes a new webhook id.
* **A different car:** a new entry and a new device. Each car's data is kept apart.
* **The customer deletes the car in Home Assistant:** the car's posts get
  empty 200s from then on. After a few passes like that, the car should
  offer to pair again.

### 2.8 Cars that already send (no pairing)

Admin-build cars that already post to a webhook id do not need pairing. The
customer chooses **I already have a car sending to this Home Assistant** and
pastes the id (8 to 200 characters from `A-Z a-z 0-9 - _ . ~`, or the whole
`.../api/webhook/<id>` address). Until such a car sends a `car_id`, the
first `car_id` it sends is kept for its entry.

### 2.9 Security notes

* Pairing uses plain HTTP, so someone on the home Wi-Fi could read the
  pairing post. That is no worse than reading any normal post, which carries the
  same webhook id in its address.
* A 6-digit code allows 1,000,000 values, and only 5 guesses per step are
  allowed. The code only pairs a car that has already posted from the home
  network.
* The pairing reply never repeats the webhook id. Home Assistant never shows
  the id again after pairing.

---

## 3. The posts the car sends

`POST http://<address>:<port>/api/webhook/<the car's webhook_id>`

### 3.1 Fields in every post

| Field | Today's app | Rule |
|---|---|---|
| `source` | `"zoomy"` | Sent by the car, not checked. |
| `version` | the app version, e.g. `"4.18.20"` | Text of 1 to 40 characters (a number is turned into text). It shows as the device's software version. |
| `sent_at` | local ISO time, e.g. `"2026-10-15T07:45:00"` | The time with or without an offset. A time without one is read in Home Assistant's time zone. |
| `kind` | missing for the snapshot | See 3.2. |
| `car_id` | not sent yet | Optional. Same rule as in pairing. Once the entry knows a `car_id`, a post with a different one gets **409** (two cars never mix). Leave it out, or always send the same one. |
| `format` | not sent yet | Optional number. Changes are additive, so it is only recorded. Send `1` once it is used. |

### 3.2 Kinds and replies

| `kind` | Body (besides the fields above) | Reply (HTTP 200) |
|---|---|---|
| missing, `null`, `""` or `"snapshot"` | The snapshot: `last_trip`, `last_charge`, `this_month`, `last_month`, `health`, `trips`, `charges`, `runs`, `drain`, ... | `{"ok": true, "kind": "snapshot"}` |
| `"trips"`, `"charges"` | `{"rows": [...]}`, merged by `start` (a newer row with the same `start` replaces the old one) | `{"ok": true, "kind", "stored", "skipped", "have"}` |
| `"dyno"` | `envelope`, `regen_envelope`, `best`, `sag` (each replaced when sent); `pulls: [...]` merged by `when` | `{"ok": true, "kind": "dyno", "stored", "skipped", "have"}` |
| `"charge_curve"` | `{"charge_start", "points": [[minutes, soc, kw], ...]}` | `{"ok": true, "kind": "charge_curve", "stored": 1, "n", "have"}` |
| `"route"` | `{"trip_start", "trip_end", "km", "points": [[lat, lon], ...]}` | `{"ok": true, "kind": "route", "stored": 1, "n", "have"}` |
| `"route"`, with routes turned off | the same body | `{"ok": true, "kind": "route", "stored": 0, "discarded": 1, "store_routes": false, "have"}` (the route is thrown away unread) |
| `"runs"` | `{"rows": [{"when", "s_0_60", "s_0_80", "s_0_100", "s_400m", "trap_kmh", "peak_g"}, ...]}`, merged by `when` | `{"ok": true, "kind": "runs", "stored", "skipped", "dropped", "have"}` |
| `"have"` | `{"what": "trips" \| "charges" \| "charge_curves" \| "routes" \| "runs"}` | `{"ok": true, "kind": "have", "what", "keys": [...]}`, newest first. For routes also `"store_routes": true \| false` |

* `stored` = rows taken, `skipped` = rows without a usable key (left out, not an
  error), `have` = how many Home Assistant now holds of that kind.
* **Keys** (`start`, `when`, `charge_start`, `trip_start`) are non-empty texts of
  at most 200 characters, normally the local ISO start time. Unknown fields in
  rows are kept as sent.
* **`have routes`** also lists the routes thrown away while routes were turned
  off, so the car does not send them again. When the customer turns routes
  back on, that list is cleared and the car sends the routes it still has.
* **Timed runs:** Home Assistant keeps 500. The best 125 by `s_0_60`, the best
  125 by `s_0_100` and the best 125 by `s_400m` always stay (a missing time does
  not count). Of the others, the slowest `s_0_60` goes first (a missing time
  counts as slowest), and the oldest goes first among equals. `dropped` counts
  the runs the cap removed. `have runs` still lists them, so the car does not
  send them again.
* A route that is refused is not stored at all. A route is never stored halfway.

### 3.3 Snapshot fields Home Assistant reads

The sensors are worked out from these fields. A missing field shows as
"unknown", not as an error.

| Object | Fields |
|---|---|
| `last_trip` | `start`, `end`, `minutes`, `km`, `kwh_net`, `kwh_regen`, `kwh_per_100km`, `soc_start`, `soc_end`, `outside_c` |
| `last_charge` | `start`, `end`, `minutes`, `kwh_added`, `soc_start`, `soc_end`, `avg_kw`, `type`, `place`, `cost`, `offpeak_kwh` |
| `this_month`, `last_month` | `month` (`"YYYY-MM"`), `km`, `trips`, `charges`, `charges_without_price`, `kwh_charged_home`, `kwh_charged_public`, `kwh_per_100km`, `cost` |
| `health` | `usable_kwh`, `soh_pct` |
| `trips`, `charges`, `runs`, `drain` | shown on the dashboard pages until the detail posts fill the store |

A snapshot over 64 KiB is cut down to fit: first the `trips` and `charges`
lists, newest rows kept.

### 3.4 Refusals and limits

| HTTP | When |
|---|---|
| 400 | Not JSON (NaN and Infinity count as not JSON), not an object, nested more than 32 levels, an unknown `kind`, a bad field. The `error` text says which. |
| 409 | `car_id` differs from the one this entry knows. |
| 413 | The body is over 2 MB. |
| 500 | Unexpected error, or a route file could not be written. |
| 503 | The car's entry is being reloaded or removed. Try again on the next pass. |

Each refusal body is `{"ok": false, "error": "<under 120 characters>"}`.

| Limit | Value |
|---|---|
| Body | 2 MB |
| Nesting | 32 levels (the body is level 1) |
| Rows, or dyno pulls, in one post | 1000 |
| Points in one dyno pull or charge curve | 2000; each point is a list of numbers or nulls |
| Points in one route | 60,000 `[lat, lon]` pairs; lat -90 to 90, lon -180 to 180 |
| Key length | 200 characters |
| `version` | 40 characters |

---

## 4. What the car should do with each reply

| Reply | Car does |
|---|---|
| 200 with `"ok": true` | Carry on with the pass. |
| Empty 200 | Stop the pass. The webhook is unknown (the car is not paired, or was deleted) or the car is not on the home network. |
| 400, 413 | Skip this post, log the `error` text in the car, and carry on with the next post. |
| 409 | Stop the pass. Another car owns this webhook: pair again. |
| 500 | Stop the pass. Try again on the next pass. |
| 503 | Stop the pass. Try again on the next pass. |
| No answer or timeout | Stop the pass. Try again on the next pass. |

Today's app ends its pass on any reply that is not `"ok": true`. That is also
safe. It only means one bad post holds back the posts after it until the bug
is fixed.

---

## 5. Changes to this contract

* Home Assistant accepts posts without `car_id` and `format` now and will keep
  doing so.
* New fields and new kinds are added. Nothing is renamed or removed while
  `format` is 1.
* A change that is not additive gets a new `format` number and a new section here.
  Home Assistant keeps accepting the older format.

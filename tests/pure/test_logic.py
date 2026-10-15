"""Tests for custom_components/zoomy/logic.py (plain Python, no Home Assistant).

Ported from the zoomy_store tests (99 tests), plus the package changes:
car_id / version / format, route storage off, the kept snapshot, the
"have routes" answer, key length and deleting route files
(test_logic_package.py).

Run with plain Python (nothing to install):

    python -m unittest discover -s tests/pure -t . -v

All coordinates here are made up (around lat 10, lon 20).
"""

import importlib.util
import json
import math
import os
import re
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
CORE_PATH = os.path.join(HERE, "..", "..", "custom_components", "zoomy", "logic.py")


def load_core():
    """Import logic.py by its path, without importing the package (__init__ needs HA)."""
    spec = importlib.util.spec_from_file_location("zoomy_logic_under_test", CORE_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


core = load_core()

NOW = "2030-01-02T03:04:05+00:00"


def fresh(**kwargs):
    """A store that already knows the app version the test posts carry.

    (A post with a new app version adds a "version" effect; most tests look
    at the other effects only.)
    """
    data = core.ZoomyData(**kwargs)
    data.app_version = "9.9"
    return data


def post(kind=None, **fields):
    """Build a post body the way the car does."""
    body = {"source": "zoomy", "version": "9.9", "sent_at": "2030-01-02T03:04:00"}
    if kind is not None:
        body["kind"] = kind
    body.update(fields)
    return body


def trip(start, **fields):
    """Build one trip row."""
    row = {"start": start, "end": start[:11] + "23:59", "km": 12.3, "kwh_used": 2.1,
           "kwh_regen": 0.4, "kwh_net": 1.7, "kwh_per_100km": 13.8, "soc_start": 80,
           "soc_end": 76, "outside_c": None, "minutes": 21, "feels_c": 18.5,
           "humidity_pct": 40}
    row.update(fields)
    return row


def charge(start, **fields):
    """Build one charge row."""
    row = {"start": start, "end": start[:11] + "23:59", "kwh_added": 20.5,
           "soc_start": 30, "soc_end": 80, "avg_kw": 6.8, "peak_kw": 7.2, "type": "AC",
           "place": "home", "cost": 3.21, "offpeak_kwh": 20.5, "minutes": 181,
           "cost_typed": False, "breakdown": "all off peak"}
    row.update(fields)
    return row


def route_points(count, lat=10.0, lon=20.0):
    """Build count made-up [lat, lon] pairs."""
    return [[round(lat + i * 0.00001, 5), round(lon + i * 0.00002, 5)] for i in range(count)]


class Base(unittest.TestCase):
    """Common helpers."""

    def setUp(self):
        self.data = fresh()

    def ok(self, body):
        """Handle a post that must be accepted; return (reply, effects)."""
        status, reply, effects = self.data.handle(body, NOW)
        self.assertEqual(status, 200, reply)
        self.assertIs(reply["ok"], True)
        return reply, effects

    def refused(self, body, status=400):
        """Handle a post that must be refused; return the error text."""
        got, reply, effects = self.data.handle(body, NOW)
        self.assertEqual(got, status, reply)
        self.assertEqual(set(reply), {"ok", "error"})
        self.assertIs(reply["ok"], False)
        self.assertIsInstance(reply["error"], str)
        self.assertTrue(0 < len(reply["error"]) < 120)
        self.assertEqual(effects, {})
        return reply["error"]


class TestRows(Base):
    """Trips and charges."""

    def test_trips_merge_and_reply(self):
        reply, effects = self.ok(post("trips", rows=[trip("2030-01-02T08:00"), trip("2030-01-01T08:00")]))
        self.assertEqual(reply, {"ok": True, "kind": "trips", "stored": 2, "skipped": 0, "have": 2})
        self.assertEqual(effects, {"save": ("trips",)})
        reply, _ = self.ok(post("trips", rows=[trip("2030-01-03T08:00")]))
        self.assertEqual((reply["stored"], reply["have"]), (1, 3))
        # newest first for the dashboard
        self.assertEqual([r["start"] for r in self.data.rows("trips")],
                         ["2030-01-03T08:00", "2030-01-02T08:00", "2030-01-01T08:00"])
        self.assertEqual(self.data.charges, {})

    def test_trip_resend_replaces_whole_row(self):
        self.ok(post("trips", rows=[trip("2030-01-01T08:00", km=1.0, note="old")]))
        reply, _ = self.ok(post("trips", rows=[{"start": "2030-01-01T08:00", "km": 2.5}]))
        self.assertEqual((reply["stored"], reply["have"]), (1, 1))
        self.assertEqual(self.data.trips["2030-01-01T08:00"], {"start": "2030-01-01T08:00", "km": 2.5})

    def test_no_post_deletes_rows(self):
        self.ok(post("trips", rows=[trip("2030-01-01T08:00"), trip("2030-01-02T08:00")]))
        reply, effects = self.ok(post("trips", rows=[]))
        self.assertEqual((reply["stored"], reply["skipped"], reply["have"]), (0, 0, 2))
        self.assertEqual(effects, {})  # nothing changed, nothing to save

    def test_unknown_fields_kept_exactly(self):
        row = trip("2030-01-01T08:00", future_field={"a": [1, None, "x"]}, km=None)
        self.ok(post("trips", rows=[row]))
        self.assertEqual(self.data.trips["2030-01-01T08:00"], row)
        self.assertEqual(self.data.rows("trips")[0]["future_field"], {"a": [1, None, "x"]})

    def test_charges_merge_and_replace(self):
        reply, effects = self.ok(post("charges", rows=[charge("2030-01-01T22:00"), charge("2030-01-02T22:00")]))
        self.assertEqual(reply, {"ok": True, "kind": "charges", "stored": 2, "skipped": 0, "have": 2})
        self.assertEqual(effects, {"save": ("charges",)})
        reply, _ = self.ok(post("charges", rows=[charge("2030-01-01T22:00", cost=9.99, cost_typed=True)]))
        self.assertEqual((reply["stored"], reply["have"]), (1, 2))
        self.assertEqual(self.data.charges["2030-01-01T22:00"]["cost"], 9.99)
        self.assertIs(self.data.charges["2030-01-01T22:00"]["cost_typed"], True)
        self.assertEqual(self.data.trips, {})
        self.assertEqual([r["start"] for r in self.data.rows("charges")],
                         ["2030-01-02T22:00", "2030-01-01T22:00"])

    def test_skipped_rows(self):
        rows = [
            trip("2030-01-01T08:00"),
            "not an object",
            None,
            17,
            ["start", "2030-01-01T09:00"],
            {"km": 3},                      # no start
            {"start": ""},                  # empty start
            {"start": None},
            {"start": 20300101},            # not text
            trip("2030-01-02T08:00"),
        ]
        reply, _ = self.ok(post("trips", rows=rows))
        self.assertEqual((reply["stored"], reply["skipped"], reply["have"]), (2, 8, 2))
        self.assertEqual(sorted(self.data.trips), ["2030-01-01T08:00", "2030-01-02T08:00"])

    def test_any_short_non_empty_text_is_a_key(self):
        # a key is a non-empty string of at most MAX_KEY_LEN characters: any
        # such text is kept, and "have" lists it, so the car does not send the
        # row on every pass; a longer one is skipped (it is not a start time)
        long_key = "2030-01-01T08:00 " + "x" * (core.MAX_KEY_LEN - 17)
        too_long = long_key + "x"
        self.assertEqual(len(long_key), core.MAX_KEY_LEN)
        for kind in ("trips", "charges"):
            reply, _ = self.ok(post(kind, rows=[{"start": long_key}, {"start": " "}, {"start": too_long}]))
            self.assertEqual((reply["stored"], reply["skipped"], reply["have"]), (2, 1, 2))
            self.assertEqual(self.ok(post("have", what=kind))[0]["keys"], [long_key, " "])

    def test_thousand_row_limit(self):
        rows = [trip(f"2030-01-01T00:{i:04d}") for i in range(1000)]
        reply, _ = self.ok(post("trips", rows=rows))
        self.assertEqual((reply["stored"], reply["have"]), (1000, 1000))
        other = fresh()
        status, reply, effects = other.handle(post("charges", rows=rows + [trip("2030-01-02T00:00")]), NOW)
        self.assertEqual(status, 400)
        self.assertIs(reply["ok"], False)
        self.assertEqual(other.charges, {})  # nothing stored from a refused post
        self.assertEqual(effects, {})

    def test_rows_must_be_a_list(self):
        for rows in (None, {}, "rows", 5):
            self.refused(post("trips", rows=rows))
        self.refused(post("charges"))  # no rows at all
        self.assertEqual(self.data.trips, {})


class TestDyno(Base):
    """Dyno: envelope and friends replace, pulls merge."""

    def pull(self, when, **fields):
        row = {"when": when, "mode": "sport", "soc": 80, "peak_kw": 150.5, "peak_at_kmh": 70,
               "start_kmh": 20, "end_kmh": 110, "secs": 6.5, "outside_c": None,
               "points": [[20, 60.0], [70, 150.5], [110, None]]}
        row.update(fields)
        return row

    def test_replace_versus_merge(self):
        first = post("dyno", envelope=[[20, 60], [70, 150]], regen_envelope=[[60, -40]],
                     best={"kw": 150, "kmh": 70}, sag={"volts": 12.5, "at_kw": 150},
                     pulls=[self.pull("2030-01-01T10:00"), self.pull("2030-01-01T10:05")])
        reply, effects = self.ok(first)
        self.assertEqual(reply, {"ok": True, "kind": "dyno", "stored": 2, "skipped": 0, "have": 2})
        self.assertEqual(effects, {"save": ("dyno",)})

        second = post("dyno", envelope=[[20, 61], [70, 152]], regen_envelope=[[60, -45]],
                      best={"kw": 152, "kmh": 70}, sag={"volts": 13.0, "at_kw": 152},
                      pulls=[self.pull("2030-01-01T10:05", peak_kw=152.0), self.pull("2030-01-02T09:00")])
        reply, _ = self.ok(second)
        self.assertEqual((reply["stored"], reply["have"]), (2, 3))

        view = self.data.dyno_view()
        self.assertEqual(view["envelope"], [[20, 61], [70, 152]])      # replaced
        self.assertEqual(view["regen_envelope"], [[60, -45]])
        self.assertEqual(view["best"], {"kw": 152, "kmh": 70})
        self.assertEqual(view["sag"], {"volts": 13.0, "at_kw": 152})
        self.assertEqual([p["when"] for p in view["pulls"]],          # merged, newest first
                         ["2030-01-02T09:00", "2030-01-01T10:05", "2030-01-01T10:00"])
        self.assertEqual(view["pulls"][1]["peak_kw"], 152.0)           # resend replaced

    def test_absent_key_leaves_stored_value(self):
        self.ok(post("dyno", envelope=[[20, 60]], best={"kw": 150, "kmh": 70}, pulls=[]))
        reply, effects = self.ok(post("dyno", sag={"volts": 12.0, "at_kw": 100}))
        self.assertEqual((reply["stored"], reply["have"]), (0, 0))
        self.assertEqual(effects, {"save": ("dyno",)})
        view = self.data.dyno_view()
        self.assertEqual(view["envelope"], [[20, 60]])
        self.assertEqual(view["best"], {"kw": 150, "kmh": 70})
        self.assertEqual(view["sag"], {"volts": 12.0, "at_kw": 100})
        self.assertIsNone(view["regen_envelope"])
        # a post carrying nothing changes nothing
        _, effects = self.ok(post("dyno"))
        self.assertEqual(effects, {})

    def test_bad_pulls_are_skipped(self):
        pulls = [
            self.pull("2030-01-01T10:00"),
            "nope",
            {"mode": "eco"},                                               # no when
            self.pull(""),
            self.pull("2030-01-01T10:01", points=[[1, 2]] * 2001),         # too many points
            self.pull("2030-01-01T10:02", points=[[1, 2], "x"]),           # point not a list
            self.pull("2030-01-01T10:03", points=[[1, "2"]]),              # not a number
            self.pull("2030-01-01T10:04", points=[[1, True]]),             # true is not a number
            self.pull("2030-01-01T10:05", points=[[1, float("nan")]]),
            self.pull("2030-01-01T10:06", points={"0": [1, 2]}),           # points not a list
            self.pull("2030-01-01T10:07", points=[[1, 2]] * 2000),         # exactly the limit
            self.pull("2030-01-01T10:08", points=[[None, None]]),          # nulls are fine
            # the only rule for a point is "a list of numbers / nulls"
            self.pull("2030-01-01T10:09", points=[[1, 2, 3, 4, 5, 6, 7, 8, 9], []]),
            self.pull("w" * core.MAX_KEY_LEN, points=[[20, 60]]),          # any short text
            self.pull("w" * (core.MAX_KEY_LEN + 1), points=[[20, 60]]),    # too long a key
        ]
        reply, _ = self.ok(post("dyno", pulls=pulls))
        self.assertEqual((reply["stored"], reply["skipped"], reply["have"]), (5, 10, 5))
        self.assertEqual(sorted(self.data.dyno["pulls"]),
                         ["2030-01-01T10:00", "2030-01-01T10:07", "2030-01-01T10:08",
                          "2030-01-01T10:09", "w" * core.MAX_KEY_LEN])
        # points are kept exactly as sent
        self.assertEqual(self.data.dyno["pulls"]["2030-01-01T10:00"]["points"],
                         [[20, 60.0], [70, 150.5], [110, None]])

    def test_pulls_must_be_a_list(self):
        self.refused(post("dyno", pulls={"when": "2030-01-01T10:00"}))
        self.refused(post("dyno", pulls=[self.pull(f"2030-01-01T10:{i:04d}", points=[]) for i in range(1001)]))
        self.assertEqual(self.data.dyno["pulls"], {})


class TestCurves(Base):
    """Charge curves."""

    def test_store_and_replace(self):
        points = [[0, 30, 7.1], [5, 31, None], [10, None, 7.0]]
        reply, effects = self.ok(post("charge_curve", charge_start="2030-01-01T22:00", points=points))
        self.assertEqual(reply, {"ok": True, "kind": "charge_curve", "stored": 1, "n": 3, "have": 1})
        self.assertEqual(effects, {"save": ("curves",)})
        self.assertEqual(self.data.curves["2030-01-01T22:00"],
                         {"points": points, "received": "2030-01-02T03:04:00"})
        self.ok(post("charge_curve", charge_start="2030-01-01T22:00", points=[[0, 30, 7.5]]))
        self.assertEqual(self.data.curve_view("2030-01-01T22:00")["points"], [[0, 30, 7.5]])
        self.assertEqual(len(self.data.curves), 1)
        self.assertIsNone(self.data.curve_view("2030-01-09T22:00"))
        self.assertIsNone(self.data.curve_view(None))

    def test_received_is_null_without_sent_at(self):
        body = post("charge_curve", charge_start="2030-01-01T22:00", points=[])
        del body["sent_at"]
        self.ok(body)
        self.assertEqual(self.data.curves["2030-01-01T22:00"], {"points": [], "received": None})

    def test_limits(self):
        self.ok(post("charge_curve", charge_start="a", points=[[i, 50, 7.0] for i in range(2000)]))
        self.refused(post("charge_curve", charge_start="b", points=[[i, 50, 7.0] for i in range(2001)]))
        for bad in (None, "points", {"a": 1}, [1, 2, 3], [[0, 30, "7"]], [[0, 30, True]],
                    [[0, 30, float("inf")]], [[0, 30, [7]]], [[0, 30, 7.0], "x"]):
            self.refused(post("charge_curve", charge_start="c", points=bad))
        for bad_key in (None, "", 5, ["x"]):
            text = self.refused(post("charge_curve", charge_start=bad_key, points=[[0, 30, 7.0]]))
            self.assertEqual(text, "charge_start must be a non-empty text")
        self.refused(post("charge_curve", points=[[0, 30, 7.0]]))
        self.assertEqual(self.data.curve_keys(), ["a"])

    def test_nothing_is_refused_that_the_rules_allow(self):
        # a point is "a list of numbers / nulls" and a key "a non-empty string"
        # of at most MAX_KEY_LEN characters
        long_key = "k" * core.MAX_KEY_LEN
        points = [[0, 30, 7.0], [], [1, 2, 3, 4, 5, 6, 7, 8, 9], [None]]
        self.ok(post("charge_curve", charge_start=long_key, points=points))
        self.assertEqual(self.data.curve_view(long_key)["points"], points)
        self.assertEqual(self.ok(post("have", what="charge_curves"))[0]["keys"], [long_key])


class TestRoutes(Base):
    """Routes: validation, the index and the files."""

    def route(self, start="2030-01-01T08:00", **fields):
        body = post("route", trip_start=start, trip_end="2030-01-01T08:30", km=12.3,
                    points=route_points(5))
        body.update(fields)
        return body

    def test_good_route_is_two_step(self):
        reply, effects = self.ok(self.route())
        self.assertEqual(reply, {"ok": True, "kind": "route", "stored": 1, "n": 5, "have": 1})
        self.assertEqual(effects["save"], ("routes",))
        route = effects["route"]
        self.assertEqual(route["file"], core.route_file_name("2030-01-01T08:00"))
        self.assertEqual(route["record"], {
            "trip_start": "2030-01-01T08:00", "trip_end": "2030-01-01T08:30", "km": 12.3,
            "points": route_points(5), "received": "2030-01-02T03:04:00"})
        # not in the index until the glue says the file is written
        self.assertEqual(self.data.routes, {})
        self.assertEqual(self.data.have("routes"), [])
        self.assertIsNone(self.data.route_file("2030-01-01T08:00"))
        self.data.commit_route(route)
        self.assertEqual(self.data.routes, {"2030-01-01T08:00": {
            "file": route["file"], "km": 12.3, "n": 5, "trip_end": "2030-01-01T08:30"}})
        self.assertEqual(self.data.route_file("2030-01-01T08:00"), route["file"])
        self.assertEqual(self.data.status()["last"]["route"], NOW)

    def test_resend_replaces(self):
        _, effects = self.ok(self.route())
        self.data.commit_route(effects["route"])
        reply, effects = self.ok(self.route(km=15.0, points=route_points(7)))
        self.assertEqual((reply["n"], reply["have"]), (7, 1))
        self.data.commit_route(effects["route"])
        self.assertEqual(len(self.data.routes), 1)
        self.assertEqual(self.data.routes["2030-01-01T08:00"]["n"], 7)
        self.assertEqual(self.data.route_list(), [
            {"trip_start": "2030-01-01T08:00", "trip_end": "2030-01-01T08:30", "km": 15.0, "n": 7}])

    def test_bad_lat_lon(self):
        for bad in ([90.00001, 20.0], [-90.5, 20.0], [10.0, 180.00001], [10.0, -181], [91, 181],
                    [float("nan"), 20.0], [10.0, float("nan")], [float("inf"), 20.0],
                    [10.0, float("-inf")], ["10.0", 20.0], [10.0, None], [None, None],
                    [True, 20.0], [10.0, False], [10.0], [10.0, 20.0, 5.0], [], (10.0, 20.0),
                    {"lat": 10.0, "lon": 20.0}, "10.0,20.0", 10.0, None):
            points = route_points(3) + [bad] + route_points(2)
            self.refused(self.route(points=points))
        self.assertEqual(self.data.routes, {})

    def test_edges_are_valid(self):
        _, effects = self.ok(self.route(points=[[90, 180], [-90, -180], [0, 0], [10.12345, 20.54321]]))
        self.assertEqual(effects["route"]["entry"]["n"], 4)
        _, effects = self.ok(self.route(points=[]))
        self.assertEqual(effects["route"]["entry"]["n"], 0)

    def test_too_many_points(self):
        self.ok(self.route(points=[[10.0, 20.0]] * 60000))
        self.refused(self.route(points=[[10.0, 20.0]] * 60001))

    def test_points_not_a_list(self):
        for bad in (None, "points", 5, {"0": [10.0, 20.0]}, 10.5):
            self.refused(self.route(points=bad))
        body = self.route()
        del body["points"]
        self.refused(body)

    def test_bad_keys(self):
        for bad in (None, "", 20300101, ["2030"]):
            self.assertEqual(self.refused(self.route(start=bad)),
                             "trip_start must be a non-empty text")
        body = self.route()
        del body["trip_start"]
        self.refused(body)
        self.assertEqual(self.refused(self.route(start="t" * (core.MAX_KEY_LEN + 1))),
                         "trip_start must be a non-empty text")
        # any short non-empty text is a key; the file name stays short and safe
        long_key = "t" * core.MAX_KEY_LEN
        _, effects = self.ok(self.route(start=long_key))
        self.assertEqual(effects["route"]["key"], long_key)
        self.assertLessEqual(len(effects["route"]["file"]), 100)
        self.assertTrue(core.is_route_file_name(effects["route"]["file"]))

    def test_odd_km_and_end_become_null(self):
        _, effects = self.ok(self.route(km="far", trip_end=5))
        self.assertIsNone(effects["route"]["record"]["km"])
        self.assertIsNone(effects["route"]["record"]["trip_end"])
        _, effects = self.ok(self.route(km=None, trip_end=None))
        self.assertIsNone(effects["route"]["entry"]["km"])

    def test_errors_never_quote_the_payload(self):
        text = self.refused(self.route(start="2030-01-01T08:00", points=[[12.34567, 123.45678], [99.0, 20.0]]))
        for secret in ("12.34567", "123.45678", "99", "2030"):
            self.assertNotIn(secret, text)

    def test_files_round_trip(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = os.path.join(tmp, "new", "routes")       # made when missing
            _, effects = self.ok(self.route())
            route = effects["route"]
            core.write_route_file(folder, route["file"], route["record"])
            self.data.commit_route(route)
            self.assertEqual(os.listdir(folder), [route["file"]])     # no part file left
            with open(os.path.join(folder, route["file"]), encoding="utf-8") as handle:
                on_disk = json.load(handle)
            self.assertEqual(set(on_disk), {"trip_start", "trip_end", "km", "points", "received"})
            name = self.data.route_file("2030-01-01T08:00")
            self.assertEqual(core.read_route_file(folder, name, None, "2030-01-01T08:00"), route["record"])
            # resend replaces the file
            _, effects = self.ok(self.route(points=route_points(9)))
            core.write_route_file(folder, effects["route"]["file"], effects["route"]["record"],
                                  lambda record: json.dumps(record).encode())   # bytes are fine too
            self.assertEqual(os.listdir(folder), [route["file"]])
            self.assertEqual(len(core.read_route_file(folder, name)["points"]), 9)
            # missing, wrong trip, not a route
            self.assertIsNone(core.read_route_file(folder, core.route_file_name("other")))
            with self.assertRaises(ValueError):
                core.read_route_file(folder, name, None, "2030-01-05T08:00")
            with open(os.path.join(folder, name), "w", encoding="utf-8") as handle:
                handle.write("{broken")
            with self.assertRaises(ValueError):
                core.read_route_file(folder, name)
            with open(os.path.join(folder, name), "w", encoding="utf-8") as handle:
                handle.write('{"points": 5}')
            with self.assertRaises(ValueError):
                core.read_route_file(folder, name)
            self.assertEqual(core.prepare_routes_dir(folder), {name})

    def test_start_up_check_of_the_folder(self):
        # what a power cut or a killed write can leave behind
        with tempfile.TemporaryDirectory() as tmp:
            good = core.route_file_name("2030-01-01T08:00")
            empty = core.route_file_name("2030-01-02T08:00")
            core.write_route_file(tmp, good, {"trip_start": "2030-01-01T08:00", "points": []})
            for name in (empty, ".zoomy-abc123.part", ".zoomy-other.part"):
                with open(os.path.join(tmp, name), "wb") as handle:
                    handle.write(b"" if name == empty else b'{"points":[[10.0,20.')
            with open(os.path.join(tmp, "notes.txt"), "w", encoding="utf-8") as handle:
                handle.write("not ours")
            os.mkdir(os.path.join(tmp, "folder.json"))
            # the empty file does not count as a stored route ...
            self.assertEqual(core.prepare_routes_dir(tmp), {good})
            # ... the part files are gone, and nothing else was touched
            self.assertEqual(sorted(os.listdir(tmp)), sorted([good, empty, "notes.txt", "folder.json"]))
            # so the index forgets that route and the car sends it again
            for start in ("2030-01-01T08:00", "2030-01-02T08:00"):
                _, effects = self.ok(self.route(start=start))
                self.data.commit_route(effects["route"])
            self.assertEqual(self.data.prune_routes(core.prepare_routes_dir(tmp)), 1)
            self.assertEqual(self.data.have("routes"), ["2030-01-01T08:00"])

    def test_route_is_on_the_disk_before_the_rename(self):
        calls = []
        real_fsync, real_replace = core.os.fsync, core.os.replace
        self.addCleanup(setattr, core.os, "fsync", real_fsync)
        self.addCleanup(setattr, core.os, "replace", real_replace)

        def fsync(handle):
            calls.append("fsync")
            return real_fsync(handle)

        def replace(src, dst):
            calls.append(("replace", os.path.getsize(src)))
            return real_replace(src, dst)

        core.os.fsync, core.os.replace = fsync, replace
        with tempfile.TemporaryDirectory() as tmp:
            name = core.route_file_name("2030-01-01T08:00")
            core.write_route_file(tmp, name, {"points": route_points(3)})
            size = os.path.getsize(os.path.join(tmp, name))
        self.assertGreater(size, 0)
        self.assertEqual(calls, ["fsync", ("replace", size)])

    def test_file_functions_refuse_unsafe_names(self):
        with tempfile.TemporaryDirectory() as tmp:
            for bad in ("../x.json", "..\\x.json", "a/b.json", "x.txt", ".json", "", "a..json",
                        "/etc/passwd", "C:\\x.json", "x.json/", None):
                with self.assertRaises(ValueError):
                    core.write_route_file(tmp, bad, {"points": []})
                with self.assertRaises(ValueError):
                    core.read_route_file(tmp, bad)
            self.assertEqual(os.listdir(tmp), [])

    def test_failed_write_leaves_no_part_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            def explode(record):
                raise OSError("disk full")
            name = core.route_file_name("2030-01-01T08:00")
            with self.assertRaises(OSError):
                core.write_route_file(tmp, name, {"points": []}, explode)
            self.assertEqual(os.listdir(tmp), [])
            # a rename that fails (the target is a folder) also cleans up
            os.mkdir(os.path.join(tmp, name))
            with self.assertRaises(OSError):
                core.write_route_file(tmp, name, {"points": []})
            self.assertEqual(os.listdir(tmp), [name])

    def test_prune_and_forget(self):
        for start in ("2030-01-01T08:00", "2030-01-02T08:00", "2030-01-03T08:00"):
            _, effects = self.ok(self.route(start=start))
            self.data.commit_route(effects["route"])
        keep = core.route_file_name("2030-01-02T08:00")
        self.assertEqual(self.data.prune_routes({keep, "stray.json"}), 2)
        self.assertEqual(self.data.have("routes"), ["2030-01-02T08:00"])
        self.assertTrue(self.data.forget_route("2030-01-02T08:00"))
        self.assertFalse(self.data.forget_route("2030-01-02T08:00"))
        self.assertEqual(self.data.have("routes"), [])

    def test_routes_dir_must_not_be_under_www(self):
        with tempfile.TemporaryDirectory() as tmp:
            www = os.path.join(tmp, "www")
            os.mkdir(www)
            for inside in (www, os.path.join(www, "routes"), os.path.join(www, "a", "..", "b")):
                with self.assertRaises(core.Refused):
                    core.prepare_routes_dir(inside, www)
            self.assertEqual(os.listdir(www), [])
            outside = os.path.join(tmp, "wwwroutes")       # only looks alike
            self.assertEqual(core.prepare_routes_dir(outside, www), set())
            self.assertTrue(os.path.isdir(outside))


class TestRouteFileNames(unittest.TestCase):
    """route_file_name can never leave the folder and never collides."""

    SAFE = re.compile(r"[0-9A-Za-z-]+\.json")

    def check(self, key):
        name = core.route_file_name(key)
        self.assertRegex(name, self.SAFE)
        self.assertTrue(self.SAFE.fullmatch(name), name)
        self.assertTrue(core.is_route_file_name(name), name)
        self.assertNotIn("..", name)
        self.assertNotIn("/", name)
        self.assertNotIn("\\", name)
        self.assertNotIn(":", name)
        self.assertEqual(os.path.basename(name), name)
        self.assertLessEqual(len(name), 100)
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, name)
            self.assertEqual(os.path.dirname(os.path.abspath(path)), os.path.abspath(tmp))
        self.assertEqual(name, core.route_file_name(key))      # stable
        return name

    def test_path_separators_and_dots(self):
        for key in ("../../etc/passwd", "..\\..\\windows\\system32", "/absolute/path",
                    "C:\\Users\\x", "..", ".", "a/b", "a\\b", "x\x00y", "con", "nul.txt",
                    "~/.ssh/id", "%2e%2e%2f", "....//", "\n", " ", "*?<>|\""):
            self.check(key)

    def test_usual_key_stays_readable(self):
        name = self.check("2030-01-02T08:15:30+10:00")
        self.assertTrue(name.startswith("2030-01-02T08-15-30-10-00-"), name)

    def test_very_long_keys(self):
        one = self.check("a" * 5000)
        two = self.check("a" * 4999 + "b")
        self.assertNotEqual(one, two)
        self.assertNotEqual(self.check("a" * 48), self.check("a" * 49))

    def test_unicode(self):
        names = {self.check(key) for key in ("café", "cafe", "東京", "京東", "😀", "٢٠٣٠", "２０３０",
                                             "e\u0301", "\u00e9", "\ud800")}
        self.assertEqual(len(names), 10)

    def test_punctuation_only_differences(self):
        keys = ["2030-01-02T08:15", "2030-01-02T08-15", "2030-01-02 08:15", "2030/01/02T08:15",
                "2030.01.02T08.15", "2030-01-02T08:15 ", "2030_01_02T08_15", "2030-01-02t08:15"]
        names = [self.check(key) for key in keys]
        self.assertEqual(len(set(names)), len(keys))
        # ... also on a file system that ignores case
        self.assertEqual(len({name.lower() for name in names}), len(keys))

    def test_many_keys_never_collide(self):
        keys = [f"2030-{m:02d}-{d:02d}T{h:02d}:{q:02d}{sep}"
                for m in range(1, 13) for d in range(1, 29) for h in range(0, 24, 6)
                for q in (0, 30) for sep in ("", "Z", " ")]
        self.assertEqual(len({core.route_file_name(key) for key in keys}), len(keys))

    def test_method_on_the_class(self):
        self.assertEqual(fresh().route_file_name("x"), core.route_file_name("x"))


class TestHave(Base):
    """The car asks which keys are already here."""

    def fill(self):
        self.ok(post("trips", rows=[trip("2030-01-01T08:00"), trip("2030-01-03T08:00"), trip("2030-01-02T08:00")]))
        self.ok(post("charges", rows=[charge("2030-01-01T22:00"), charge("2030-01-02T22:00")]))
        self.ok(post("charge_curve", charge_start="2030-01-01T22:00", points=[[0, 30, 7.0]]))
        self.ok(post("charge_curve", charge_start="2030-01-02T22:00", points=[[0, 30, 7.0]]))
        for start in ("2030-01-01T08:00", "2030-01-03T08:00"):
            _, effects = self.ok(post("route", trip_start=start, points=route_points(3)))
            self.data.commit_route(effects["route"])

    def test_all_four(self):
        self.fill()
        expected = {
            "trips": ["2030-01-03T08:00", "2030-01-02T08:00", "2030-01-01T08:00"],
            "charges": ["2030-01-02T22:00", "2030-01-01T22:00"],
            "charge_curves": ["2030-01-02T22:00", "2030-01-01T22:00"],
            "routes": ["2030-01-03T08:00", "2030-01-01T08:00"],
        }
        for what, keys in expected.items():
            reply, effects = self.ok(post("have", what=what))
            extra = {"store_routes": True} if what == "routes" else {}
            self.assertEqual(reply, {"ok": True, "kind": "have", "what": what, "keys": keys, **extra})
            self.assertEqual(effects, {})
            self.assertEqual(self.data.have(what), keys)

    def test_keys_are_identical_strings(self):
        odd = " 2030-01-01T08:00:00.000+10:00 "
        self.ok(post("trips", rows=[trip(odd)]))
        reply, _ = self.ok(post("have", what="trips"))
        self.assertEqual(reply["keys"], [odd])

    def test_empty(self):
        for what in ("trips", "charges", "charge_curves", "routes"):
            reply, _ = self.ok(post("have", what=what))
            self.assertEqual(reply["keys"], [])

    def test_unknown_what(self):
        for what in (None, "", "dyno", "curves", "route", "TRIPS", 5, ["trips"], {"a": 1}):
            self.refused(post("have", what=what))
        self.refused(post("have"))


class TestKinds(Base):
    """Which kind goes where."""

    def test_unknown_kind(self):
        for kind in ("trip", "TRIPS", "routes", "delete", "snapshot ", 5, 0, False, True,
                     ["trips"], {"a": 1}, 1.5):
            text = self.refused(post(kind))
            self.assertEqual(text, "unknown kind")

    def test_unknown_kind_is_not_echoed(self):
        text = self.refused(post("secret-thing-12345"))
        self.assertNotIn("secret", text)
        self.assertNotIn("12345", text)

    def test_body_must_be_an_object(self):
        for body in (None, [], [post()], "text", 5, True):
            self.refused(body)

    def test_snapshot_kinds(self):
        for body in (post(), post("snapshot"), post(""), dict(post(), kind=None)):
            data = fresh()
            status, reply, effects = data.handle(body, NOW)
            self.assertEqual((status, reply), (200, {"ok": True, "kind": "snapshot"}))
            self.assertEqual(effects, {"snapshot": True, "save": ("snapshot",)})
            self.assertEqual(data.snapshot, body)
            self.assertIsNot(data.snapshot, body)
            self.assertEqual(data.snapshot_received, NOW)
            self.assertEqual(data.status()["last"]["snapshot"], NOW)

    def test_status(self):
        status = self.data.status()
        self.assertEqual(status["counts"], {"trips": 0, "charges": 0, "dyno_pulls": 0,
                                            "charge_curves": 0, "routes": 0, "runs": 0})
        self.assertEqual(set(status["last"]), {"snapshot", "trips", "charges", "dyno",
                                               "charge_curve", "route", "runs", "have"})
        self.assertTrue(all(value is None for value in status["last"].values()))
        self.ok(post(trips=[trip("2030-01-01T08:00")], charges=[]))
        self.ok(post("trips", rows=[trip("2030-01-01T08:00")]))
        self.ok(post("trips", rows=[trip("2030-01-02T08:00")]))
        self.ok(post("have", what="trips"))
        self.refused(post("nope"))
        status = self.data.status()
        self.assertEqual(status["counts"]["trips"], 2)
        self.assertEqual(status["posts"]["trips"], 2)
        self.assertEqual(status["posts"]["snapshot"], 1)
        self.assertEqual(status["last"]["trips"], NOW)
        self.assertEqual(status["last"]["have"], NOW)
        self.assertIsNone(status["last"]["route"])
        self.assertEqual(status["snapshot_rows"], {"trips": 1, "charges": 0})
        self.assertEqual((status["rejected"], status["last_error"], status["last_error_at"]),
                         (1, "unknown kind", NOW))
        json.dumps(status)  # plain data only

    def test_status_never_holds_payload(self):
        self.ok(post("route", trip_start="2030-01-01T08:00", points=[[12.34567, 23.45678]]))
        self.ok(post("trips", rows=[trip("2030-01-01T08:00", km=987.654)]))
        text = json.dumps(self.data.status())
        for secret in ("12.34567", "23.45678", "987.654", "2030-01-01T08:00"):
            self.assertNotIn(secret, text)


class TestRawBody(Base):
    """handle_raw: size limit and JSON parsing."""

    def raw(self, raw, status, loads=None):
        got, reply, effects = self.data.handle_raw(raw, NOW, loads)
        self.assertEqual(got, status, reply)
        if status != 200:
            self.assertEqual(set(reply), {"ok", "error"})
            self.assertIs(reply["ok"], False)
            self.assertTrue(0 < len(reply["error"]) < 120)
            self.assertEqual(effects, {})
        return reply, effects

    def test_good_body(self):
        reply, _ = self.raw(json.dumps(post("trips", rows=[trip("2030-01-01T08:00")])).encode(), 200)
        self.assertEqual(reply["have"], 1)
        reply, effects = self.raw(json.dumps(post()).encode(), 200)
        self.assertEqual(reply, {"ok": True, "kind": "snapshot"})
        self.assertEqual(effects, {"snapshot": True, "save": ("snapshot",)})
        self.assertEqual(self.data.snapshot, post())

    def test_too_large(self):
        self.raw(None, 413)                                   # the glue gave up reading
        self.raw(b" " * (core.MAX_BODY_BYTES + 1), 413)
        padded = json.dumps(post("have", what="trips")).encode().ljust(core.MAX_BODY_BYTES)
        self.raw(padded, 200)                                 # exactly the limit is fine

    def test_not_json(self):
        for raw in (b"", b"   ", b"hello", b"{", b'{"kind": }', b"\xff\xfe\x00", b"{'kind': 'trips'}",
                    b'{"kind": "trips", "rows": [NaN]}', b'{"a": Infinity}', b"[" * 100000):
            self.raw(raw, 400)

    def test_not_an_object(self):
        for raw in (b"[]", b"[1, 2]", b'"text"', b"5", b"null", b"true"):
            reply, _ = self.raw(raw, 400)
            self.assertEqual(reply["error"], "body must be a JSON object")

    def nested(self, levels, kind="list"):
        """Build a value of that many lists (or objects) inside each other."""
        value = [] if kind == "list" else {}
        for _ in range(levels - 1):
            value = [value] if kind == "list" else {"a": value}
        return value

    def test_nested_too_deep(self):
        for kind in ("list", "dict"):
            self.assertFalse(core.nested_too_deep(self.nested(1, kind), 1))
            self.assertTrue(core.nested_too_deep(self.nested(2, kind), 1))
            self.assertFalse(core.nested_too_deep(self.nested(core.MAX_DEPTH, kind)))
            self.assertTrue(core.nested_too_deep(self.nested(core.MAX_DEPTH + 1, kind)))
            self.assertTrue(core.nested_too_deep(self.nested(100000, kind)))   # no recursion
        for flat in (None, 5, "text", {}, [], {"a": 1, "b": "x"}, [1, 2, 3]):
            self.assertFalse(core.nested_too_deep(flat, 1))
        # numbers and texts at the last allowed level are not a level themselves
        self.assertFalse(core.nested_too_deep({"rows": [{"start": "a", "km": 1}]}, 3))
        self.assertTrue(core.nested_too_deep({"rows": [{"start": "a", "x": []}]}, 3))
        self.assertTrue(core.nested_too_deep([1, 2, [3, [4]], 5], 2))
        self.assertLess(core.MAX_DEPTH, 200)       # well under what Home Assistant can write

    def test_deeply_nested_body_is_refused(self):
        # body (1) > rows (2) > row (3) > the extra field: deep is level 4 and up
        def body_with(levels, kind="trips"):
            row = {"start": "2030-01-01T08:00", "extra": self.nested(levels)}
            return json.dumps(post(kind, rows=[row])).encode()

        for levels in (core.MAX_DEPTH - 2, 100, 300):
            reply, _ = self.raw(body_with(levels), 400)
            self.assertEqual(reply["error"], "body is nested too deeply")
        # 900 deep, as Home Assistant's parser would hand it over
        row = {"start": "2030-01-01T08:00", "extra": self.nested(900)}
        reply, _ = self.raw(b"{}", 400, lambda raw: post("trips", rows=[row]))
        self.assertEqual(reply["error"], "body is nested too deeply")
        self.assertEqual(self.data.trips, {})                     # nothing was merged
        reply, effects = self.raw(body_with(core.MAX_DEPTH - 3), 200)
        self.assertEqual((reply["stored"], effects), (1, {"save": ("trips",)}))
        # every kind, the snapshot too (it is kept, so it must be writable)
        deep = self.nested(300)
        for body in (post(health=deep), post("snapshot", trips=[deep]),
                     post("dyno", best=deep), post("dyno", pulls=[{"when": "a", "x": deep}]),
                     post("charges", rows=[{"start": "a", "x": deep}]),
                     post("charge_curve", charge_start="a", points=deep),
                     post("route", trip_start="a", points=deep), post("have", what=deep)):
            reply, _ = self.raw(json.dumps(body).encode(), 400)
            self.assertEqual(reply["error"], "body is nested too deeply")
        self.assertEqual(self.data.counts(), {"trips": 1, "charges": 0, "dyno_pulls": 0,
                                              "charge_curves": 0, "routes": 0, "runs": 0})
        self.assertIsNone(self.data.dyno["best"])
        # what the car really sends is nowhere near the limit
        pulls = [{"when": "2030-01-01T10:00", "points": [[20, 60.0]]}]
        self.raw(json.dumps(post("dyno", envelope=[[20, 60]], pulls=pulls)).encode(), 200)

    def test_parser_message_is_not_passed_on(self):
        def loads(raw):
            raise ValueError("unexpected token near secret-12.34567")
        reply, _ = self.raw(b"{}", 400, loads)
        self.assertNotIn("secret", reply["error"])
        self.assertNotIn("12.34567", reply["error"])

    def test_custom_parser_is_used(self):
        seen = []
        def loads(raw):
            seen.append(raw)
            return {"kind": "have", "what": "routes"}
        reply, _ = self.raw(b"anything", 200, loads)
        self.assertEqual((seen, reply["keys"]), ([b"anything"], []))


class TestSnapshotTrim(unittest.TestCase):
    """The snapshot that is kept is cut down when it is too big."""

    def snapshot(self, trips=20, charges=20, pad=0):
        return {
            "source": "zoomy", "version": "9.9", "sent_at": "2030-01-02T03:04:00",
            "last_trip": trip("2030-01-20T08:00"), "last_charge": charge("2030-01-20T22:00"),
            "this_month": {"km": 800.5, "kwh": 120.1, "cost": 31.5},
            "last_month": {"km": 950.0, "kwh": 140.9, "cost": None},
            "trips": [trip(f"2030-01-{20 - i % 20:02d}T08:{i:04d}", note="n" * pad) for i in range(trips)],
            "charges": [charge(f"2030-01-{20 - i % 20:02d}T22:{i:04d}", note="n" * pad) for i in range(charges)],
            "runs": [{"when": "2030-01-05T10:00", "secs": 6.5}],
            "health": {"soh_pct": 97.5, "cells": [3.91] * 20},
            "drain": {"pct_per_day": 0.4},
        }

    def size(self, value):
        return len(json.dumps(value, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))

    def test_small_snapshot_untouched(self):
        body = self.snapshot()
        self.assertLess(self.size(body), 30000)
        out = core.trim_snapshot(body, 30000)
        self.assertEqual(out, body)
        self.assertIsNot(out, body)
        self.assertEqual(len(out["trips"]), 20)

    def test_big_snapshot_is_cut_to_fit(self):
        body = self.snapshot(trips=20, charges=20, pad=900)
        before = json.dumps(body)
        self.assertGreater(self.size(body), 30000)
        out = core.trim_snapshot(body, 30000)
        self.assertLess(self.size(out), 30000)
        self.assertEqual(list(out), list(body))                    # every key, same order
        for key in body:
            if key not in ("trips", "charges"):
                self.assertEqual(out[key], body[key])
        n = len(out["trips"])
        self.assertTrue(0 < n < 20)
        self.assertEqual(len(out["charges"]), n)                   # the same N for both
        self.assertEqual(out["trips"], body["trips"][:n])          # the first (newest) rows
        self.assertEqual(out["charges"], body["charges"][:n])
        self.assertEqual(json.dumps(body), before)                 # the input is not changed
        # N is the largest that fits
        more = dict(body, trips=body["trips"][:n + 1], charges=body["charges"][:n + 1])
        self.assertGreaterEqual(self.size(more), 30000)

    def test_lists_of_different_length(self):
        body = self.snapshot(trips=20, charges=3, pad=1500)
        out = core.trim_snapshot(body, 30000)
        self.assertLess(self.size(out), 30000)
        self.assertEqual(len(out["charges"]), 3)
        self.assertTrue(3 < len(out["trips"]) < 20)
        self.assertEqual(out["trips"], body["trips"][:len(out["trips"])])

    def test_every_limit_is_respected(self):
        body = self.snapshot(trips=20, charges=20, pad=50)
        full = self.size(body)
        for limit in (full + 1, full, full - 1, 9000, 5000, 3000, 1500, 700, 300, 100, 30, 3, 2, 1, 0):
            out = core.trim_snapshot(body, limit)
            if limit > 2:
                self.assertLess(self.size(out), limit, limit)
            if limit >= 300:
                self.assertEqual(list(out), list(body), limit)
            self.assertIsInstance(out, dict)
        self.assertEqual(core.trim_snapshot(body, full + 1), body)
        self.assertLess(len(core.trim_snapshot(body, full)["trips"]), 20)

    def test_huge_other_key_is_blanked_but_kept(self):
        body = self.snapshot(trips=5, charges=5)
        body["health"] = {"blob": "x" * 50000}
        out = core.trim_snapshot(body, 30000)
        self.assertLess(self.size(out), 30000)
        self.assertEqual(list(out), list(body))
        self.assertIsNone(out["health"])
        self.assertEqual(out["last_trip"], body["last_trip"])      # small keys survive
        # the rows are not what is too big, so they all stay
        self.assertEqual((out["trips"], out["charges"]), (body["trips"], body["charges"]))
        for key in body:
            if key != "health":
                self.assertEqual(out[key], body[key], key)

    def test_huge_other_key_and_too_many_rows(self):
        body = self.snapshot(trips=20, charges=20, pad=900)
        body["runs"] = ["r" * 31000]
        body["health"] = {"blob": "x" * 50000}
        out = core.trim_snapshot(body, 30000)
        self.assertLess(self.size(out), 30000)
        self.assertEqual(list(out), list(body))
        self.assertEqual((out["runs"], out["health"]), (None, None))
        n = len(out["trips"])
        self.assertTrue(0 < n < 20)
        self.assertEqual((out["trips"], out["charges"]), (body["trips"][:n], body["charges"][:n]))
        # N is the largest that fits
        more = dict(out, trips=body["trips"][:n + 1], charges=body["charges"][:n + 1])
        self.assertGreaterEqual(self.size(more), 30000)
        # only as many values are blanked as it takes, biggest first
        body = self.snapshot(trips=2, charges=2)
        body["runs"] = ["r" * 20000]
        body["health"] = {"blob": "x" * 25000}
        out = core.trim_snapshot(body, 30000)
        self.assertLess(self.size(out), 30000)
        self.assertIsNone(out["health"])
        self.assertEqual(out["runs"], body["runs"])
        self.assertEqual(len(out["trips"]), 2)

    def test_work_grows_in_step_with_the_body(self):
        # A body of very many small keys: blanking a small value does not make
        # it smaller, so the trimming must not serialise the whole snapshot
        # once per key (that froze Home Assistant for minutes).
        calls = []
        real = core.json_size
        self.addCleanup(setattr, core, "json_size", real)

        def counting(value):
            calls.append(None)
            return real(value)

        core.json_size = counting
        many = 20000
        bodies = (
            {f"k{i:06d}": 1 for i in range(many)},                              # tiny values
            {f"k{i:06d}": "v" * 40 for i in range(many)},                       # all must go
            dict({f"k{i:06d}": "v" * 40 for i in range(many)}, trips=[{"start": "a"}] * many),
            {"trips": [{"start": f"{i:06d}", "note": "n" * 40} for i in range(many)],
             "charges": [{"start": f"{i:06d}"} for i in range(many)]},
        )
        # each key, each value and each row is measured once, plus the keys
        # that are kept in the end (under 3000 of them fit in 30,000 bytes)
        most = (2 * many + 3000, 2 * many + 3000, 3 * many + 3000, 2 * many + 3000)
        for body, limit in zip(bodies, most):
            calls.clear()
            out = core.trim_snapshot(body, 30000)
            self.assertLess(len(calls), limit)
            self.assertLess(real(out), 30000)
            self.assertIsInstance(out, dict)
        self.assertEqual(len(out["trips"]), len(out["charges"]))
        self.assertTrue(0 < len(out["trips"]) < many)
        # too many keys to keep them all: the ones that fit are kept, as null
        out = core.trim_snapshot(bodies[0], 30000)
        self.assertTrue(0 < len(out) < many)
        self.assertEqual(list(out), list(bodies[0])[:len(out)])
        self.assertEqual(set(out.values()), {None})

    def test_odd_snapshots_never_raise(self):
        big = "x" * 40000
        deep = []
        for _ in range(5000):
            deep = [deep]
        for body in ({}, {"trips": None, "charges": "no"}, {"trips": big}, {"trips": [big, big]},
                     {"trips": {"a": big}, "charges": [big]}, {big: 1}, {"a" * 20000: 1, "b" * 20000: 2},
                     {"trips": [1, "two", None, [3]] * 5000}, {"x": float("nan")}, {"deep": deep},
                     {"trips": [deep], "charges": []}, {"k": "é" * 20000}, {"k": "\ud800" * 10}):
            out = core.trim_snapshot(body, 30000)
            self.assertIsInstance(out, dict)
            self.assertLess(core.json_size(out), 30000)
        for body in (None, [], "text", 5):
            self.assertEqual(core.trim_snapshot(body, 30000), {})

    def test_non_ascii_is_measured_in_bytes(self):
        body = {"source": "zoomy", "trips": [{"start": f"2030-01-01T{i:04d}", "place": "é" * 500} for i in range(40)]}
        out = core.trim_snapshot(body, 30000)
        self.assertLess(self.size(out), 30000)
        self.assertTrue(0 < len(out["trips"]) < 40)

    def test_handle_uses_the_limit(self):
        data = fresh(snapshot_limit=30000)
        body = self.snapshot(trips=20, charges=20, pad=900)
        status, reply, effects = data.handle(body, NOW)
        self.assertEqual((status, reply), (200, {"ok": True, "kind": "snapshot"}))
        self.assertEqual(effects, {"snapshot": True, "save": ("snapshot",)})
        self.assertLess(self.size(data.snapshot), 30000)
        self.assertEqual(set(data.snapshot), set(body))
        rows = data.status()["snapshot_rows"]
        self.assertEqual(rows["trips"], len(data.snapshot["trips"]))
        self.assertEqual(data.trim_snapshot(body), data.snapshot)
        self.assertEqual(data.trim_snapshot(body, 10 ** 9), body)

    def test_default_limit_keeps_a_real_snapshot_whole(self):
        data = fresh()
        body = self.snapshot(trips=20, charges=20)
        self.assertLess(self.size(body), core.SNAPSHOT_LIMIT)
        data.handle(body, NOW)
        self.assertEqual(data.snapshot, body)


class TestErrorTexts(Base):
    """Every error text is short and free of payload."""

    def test_all_error_texts_are_short(self):
        long_key = "k" * 500
        bodies = [
            None, [], "x", post("nope"), post(long_key), post(5),
            post("trips"), post("trips", rows=5), post("trips", rows=[{}] * 1001),
            post("charges", rows="x"),
            post("dyno", pulls=5), post("dyno", pulls=[{}] * 1001),
            post("charge_curve"), post("charge_curve", charge_start=long_key, points=5),
            post("charge_curve", charge_start="a"), post("charge_curve", charge_start="a", points=[[1]] * 2001),
            post("charge_curve", charge_start="a", points=[["x"]]),
            post("route"), post("route", trip_start=long_key, points=5),
            post("route", trip_start="a"), post("route", trip_start="a", points=[[10.0, 20.0]] * 60001),
            post("route", trip_start="a", points=[[1]]), post("route", trip_start="a", points=[["a", "b"]]),
            post("route", trip_start="a", points=[[95.0, 20.0]]),
            post("have"), post("have", what=long_key),
        ]
        seen = set()
        for body in bodies:
            seen.add(self.refused(body))
        for raw in (None, b"", b"{", b"[]"):
            status, reply, _ = self.data.handle_raw(raw, NOW)
            self.assertIn(status, (400, 413))
            self.assertTrue(0 < len(reply["error"]) < 120)
            seen.add(reply["error"])
        self.assertGreater(len(seen), 12)
        for text in seen:
            self.assertLess(len(text), 120)
            self.assertNotIn("kkkk", text)

    def test_long_texts_are_clipped(self):
        status, reply, _ = self.data.refuse(500, "e" * 500, NOW)
        self.assertEqual(status, 500)
        self.assertEqual(len(reply["error"]), 119)
        self.assertEqual(len(core.error_reply("e" * 500)["error"]), 119)
        self.assertEqual(core.error_reply("internal error"), {"ok": False, "error": "internal error"})


class TestPersistence(Base):
    """dump() / load(): what goes to .storage comes back the same."""

    def fill(self):
        self.ok(post("trips", rows=[trip("2030-01-01T08:00"), trip("2030-01-02T08:00")]))
        self.ok(post("charges", rows=[charge("2030-01-01T22:00")]))
        self.ok(post("dyno", envelope=[[20, 60]], best={"kw": 150, "kmh": 70},
                     pulls=[{"when": "2030-01-01T10:00", "points": [[20, 60]]}]))
        self.ok(post("charge_curve", charge_start="2030-01-01T22:00", points=[[0, 30, 7.0]]))
        _, effects = self.ok(post("route", trip_start="2030-01-01T08:00", trip_end="2030-01-01T08:30",
                                  km=12.3, points=route_points(4)))
        self.data.commit_route(effects["route"])

    def test_round_trip(self):
        self.fill()
        saved = {name: json.loads(json.dumps(self.data.dump(name))) for name in core.SETS}
        other = fresh()
        for name in core.SETS:
            self.assertIsNone(other.load(name, saved[name]), name)
            self.assertEqual(other.dump(name), self.data.dump(name))
        self.assertEqual(other.counts(), self.data.counts())
        self.assertEqual(other.dyno_view(), self.data.dyno_view())
        self.assertEqual(other.route_list(), self.data.route_list())
        # the route index never holds a coordinate
        self.assertEqual(set(saved["routes"]["2030-01-01T08:00"]), {"file", "km", "n", "trip_end"})

    def test_missing_starts_empty(self):
        self.fill()
        for name in core.SETS:
            text = self.data.load(name, None)
            self.assertIn("starting empty", text)
        self.assertEqual(self.data.counts(), {"trips": 0, "charges": 0, "dyno_pulls": 0,
                                              "charge_curves": 0, "routes": 0, "runs": 0})
        self.assertEqual(self.data.dyno_view(), {"envelope": None, "regen_envelope": None,
                                                 "best": None, "sag": None, "pulls": []})

    def test_wrong_shape_starts_empty(self):
        self.fill()
        for name in core.SETS:
            for bad in ([], "text", 5, [["a", {}]]):
                text = self.data.load(name, bad)
                self.assertIn("starting empty", text)
                if name == "snapshot":
                    self.assertIsNone(self.data.snapshot)
                    continue
                dumped = self.data.dump(name)
                self.assertEqual(len(dumped["pulls"]) if name == "dyno"
                                 else len(dumped["rows"]) if name == "runs" else len(dumped), 0)
        self.assertIn("starting empty", self.data.load("dyno", {"envelope": []}))        # no pulls
        self.assertIn("starting empty", self.data.load("dyno", {"pulls": [1, 2]}))
        # the store still works afterwards
        self.ok(post("dyno", pulls=[{"when": "2030-01-01T10:00"}]))
        self.assertEqual(self.data.counts()["dyno_pulls"], 1)

    def test_bad_entries_are_dropped(self):
        good_name = core.route_file_name("2030-01-01T08:00")
        cases = {
            "trips": ({"2030-01-01T08:00": {"start": "2030-01-01T08:00"},
                       "2030-01-02T08:00": {"start": "other"}, "": {"start": ""},
                       "2030-01-03T08:00": "row"}, 1),
            "charges": ({"a": {"start": "a"}, "b": None, "c": {"km": 1}}, 1),
            "dyno": ({"envelope": [[1, 2]], "pulls": {"a": {"when": "a"}, "b": {"when": "c"}, "d": 5}}, 1),
            "curves": ({"a": {"points": [], "received": None}, "b": {"points": None}, "c": []}, 1),
            "routes": ({"2030-01-01T08:00": {"file": good_name, "km": 1.5, "n": 3, "trip_end": None,
                                             "extra": "x"},
                        "2030-01-02T08:00": {"file": "../../secrets.json", "km": 1, "n": 1},
                        "2030-01-03T08:00": {"file": good_name},
                        "2030-01-04T08:00": {"km": 1}}, 1),
        }
        for name, (raw, kept) in cases.items():
            text = self.data.load(name, raw)
            self.assertIn("dropped", text, name)
            self.assertNotIn("starting empty", text)
            held = self.data.dump(name)["pulls"] if name == "dyno" else self.data.dump(name)
            self.assertEqual(len(held), kept, name)
        self.assertEqual(self.data.dyno["envelope"], [[1, 2]])
        self.assertEqual(self.data.routes, {"2030-01-01T08:00": {
            "file": good_name, "km": 1.5, "n": 3, "trip_end": None}})

    def test_unknown_set(self):
        with self.assertRaises(KeyError):
            self.data.load("secrets", {})
        with self.assertRaises(KeyError):
            self.data.dump("secrets")


class TestNoHomeAssistant(unittest.TestCase):
    """logic.py must stay free of Home Assistant."""

    def test_no_homeassistant_import(self):
        with open(CORE_PATH, encoding="utf-8") as handle:
            source = handle.read()
        self.assertIsNone(re.search(r"^\s*(from|import)\s+homeassistant", source, re.M))
        # Loaded alone in a fresh interpreter, nothing of Home Assistant comes along.
        code = (
            "import importlib.util, sys\n"
            f"spec = importlib.util.spec_from_file_location('x', {CORE_PATH!r})\n"
            "module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)\n"
            "print(sorted(n for n in sys.modules if n.split('.')[0] == 'homeassistant'))\n"
        )
        out = subprocess.run([sys.executable, "-I", "-c", code], capture_output=True, text=True, check=True)
        self.assertEqual(out.stdout.strip(), "[]")

    def test_nan_helpers(self):
        self.assertEqual(core.json_size({"a": 1}), 7)
        self.assertTrue(math.isinf(core.json_size({"a": object()})))


if __name__ == "__main__":
    unittest.main()


class TestRuns(Base):
    """The timed runs kind: merged by "when", the best 500 kept by the agreed rule."""

    @staticmethod
    def timed(when, s60=None, s100=None, q=None, **extra):
        return {"when": when, "s_0_60": s60, "s_0_80": None, "s_0_100": s100, "s_400m": q,
                "trap_kmh": None, "peak_g": None, **extra}

    def test_merge_reply_and_have(self):
        reply, effects = self.ok(post("runs", rows=[self.timed("2030-01-01T08:00", 3.1),
                                                    self.timed("2030-01-02T08:00", 2.9), {"no": "when"}]))
        self.assertEqual(reply, {"ok": True, "kind": "runs", "stored": 2, "skipped": 1, "dropped": 0, "have": 2})
        self.assertEqual(effects, {"save": ("runs",)})
        reply, _ = self.ok(post("have", what="runs"))
        self.assertEqual(reply["keys"], ["2030-01-02T08:00", "2030-01-01T08:00"])
        # the same run again replaces it
        self.ok(post("runs", rows=[self.timed("2030-01-01T08:00", 3.0)]))
        self.assertEqual(self.data.runs["2030-01-01T08:00"]["s_0_60"], 3.0)
        self.assertEqual(self.data.counts()["runs"], 2)
        self.assertIn("runs", self.data.status()["posts"])

    def test_bad_runs_post_is_refused(self):
        for rows in (None, "x", {"a": 1}):
            self.refused(post("runs", rows=rows))
        self.refused(post("runs", rows=[self.timed(f"2030-01-01T{i:05d}") for i in range(core.MAX_ROWS + 1)]))
        self.assertEqual(self.data.runs, {})

    def test_cap_keeps_the_best_and_drops_the_slowest_oldest_first(self):
        rows = []
        # 125 very good 0-60s, 125 very good 0-100s (no 0-60), 125 very good 400 m (no 0-60)
        for i in range(125):
            rows.append(self.timed(f"2030-01-01T{i:05d}a", s60=2.0 + i / 1000))
            rows.append(self.timed(f"2030-01-01T{i:05d}b", s100=4.0 + i / 1000))
            rows.append(self.timed(f"2030-01-01T{i:05d}c", q=11.0 + i / 1000))
        # 125 ordinary runs with a 0-60, and 5 runs with no times at all (slowest)
        for i in range(125):
            rows.append(self.timed(f"2030-02-01T{i:05d}d", s60=5.0 + i / 100))
        for i in range(5):
            rows.append(self.timed(f"2030-03-01T{i:05d}e"))
        self.assertEqual(len(rows), 505)
        reply, _ = self.ok(post("runs", rows=rows))
        self.assertEqual((reply["stored"], reply["dropped"], reply["have"]), (505, 5, 500))
        # the five with no time went (slowest), every protected run stayed
        self.assertFalse(any(key.endswith("e") for key in self.data.runs))
        # one more slow run: the slowest 0-60 among the ordinary ones goes
        reply, _ = self.ok(post("runs", rows=[self.timed("2030-04-01T00000f", s60=4.0)]))
        self.assertEqual(reply["dropped"], 1)
        self.assertNotIn("2030-02-01T00124d", self.data.runs)          # 6.24 s, the slowest
        self.assertIn("2030-04-01T00000f", self.data.runs)
        # equal times: the oldest goes first
        reply, _ = self.ok(post("runs", rows=[self.timed("2031-01-01T00000g", s60=6.23)]))
        self.assertNotIn("2030-02-01T00123d", self.data.runs)          # 6.23 s and older
        self.assertIn("2031-01-01T00000g", self.data.runs)
        self.assertEqual(len(self.data.runs), core.MAX_RUNS)
        # a dropped run is listed by "have", so the car does not send it again
        keys = self.ok(post("have", what="runs"))[0]["keys"]
        self.assertIn("2030-02-01T00124d", keys)
        self.assertIn("2030-03-01T00000e", keys)
        self.assertEqual(len(keys), 500 + 5 + 2)

    def test_no_time_and_bad_times_count_as_slowest(self):
        self.assertEqual(core._run_time({"s_0_60": None}, "s_0_60"), math.inf)
        for bad in (0, -1, True, "3.1", float("nan")):
            self.assertEqual(core._run_time({"s_0_60": bad}, "s_0_60"), math.inf, bad)
        self.assertEqual(core._run_time({"s_0_60": 3}, "s_0_60"), 3)

    def test_view_falls_back_to_the_snapshot(self):
        self.ok(post(runs=[self.timed("2030-01-01T08:00", 3.1), "junk"]))
        self.assertEqual(self.data.runs_view(), {"rows": [self.timed("2030-01-01T08:00", 3.1)], "source": "snapshot"})
        self.ok(post("runs", rows=[self.timed("2030-01-02T08:00", 2.9), self.timed("2030-01-03T08:00", 3.3)]))
        view = self.data.runs_view()
        self.assertEqual(view["source"], "store")
        self.assertEqual([row["when"] for row in view["rows"]], ["2030-01-03T08:00", "2030-01-02T08:00"])
        self.assertEqual(core.ZoomyData().runs_view(), {"rows": [], "source": "store"})

    def test_persistence_round_trip(self):
        rows = [self.timed(f"2030-01-01T{i:05d}", s60=5 + i / 100) for i in range(core.MAX_RUNS + 3)]
        self.ok(post("runs", rows=rows))
        saved = json.loads(json.dumps(self.data.dump("runs")))
        other = core.ZoomyData()
        self.assertIsNone(other.load("runs", saved))
        self.assertEqual(other.runs, self.data.runs)
        self.assertEqual(other.have("runs"), self.data.have("runs"))
        self.assertIn("starting empty", other.load("runs", {"rows": []}))
        self.assertIn("1 stored entries", other.load("runs", {"rows": {"a": {"when": "b"}, "c": {"when": "c"}}}))
        self.assertEqual(list(other.runs), ["c"])

"""Tests for what logic.py does beyond the zoomy_store port (no Home Assistant).

car_id / version / format, route storage off, deleting route files, the
kept snapshot and the rows a page gets.  All coordinates are made up.
"""

import json
import os
import tempfile
import unittest

from tests.pure.test_logic import NOW, charge, core, fresh, post, route_points, trip


class Base(unittest.TestCase):
    def setUp(self):
        self.data = fresh()

    def handle(self, body, data=None):
        return (data or self.data).handle(body, NOW)


class TestEnvelope(Base):
    """Fields every post may carry."""

    def test_no_car_id_today(self):
        status, reply, effects = self.handle(post("have", what="trips"))
        self.assertEqual((status, reply["ok"]), (200, True))
        self.assertNotIn("car_id", effects)
        self.assertIsNone(self.data.car_id)

    def test_first_car_id_is_adopted(self):
        status, _, effects = self.handle(post("have", what="trips", car_id="car-A1"))
        self.assertEqual(status, 200)
        self.assertEqual(effects["car_id"], "car-A1")
        self.assertEqual(self.data.car_id, "car-A1")
        # the same car again: fine, nothing new to adopt
        status, _, effects = self.handle(post("have", what="trips", car_id="car-A1"))
        self.assertEqual(status, 200)
        self.assertNotIn("car_id", effects)

    def test_other_car_is_refused(self):
        data = fresh(car_id="car-A1")
        status, reply, effects = self.handle(post("trips", rows=[trip("2030-01-01T08:00")], car_id="car-B2"), data)
        self.assertEqual((status, reply), (409, {"ok": False, "error": "this webhook belongs to another car"}))
        self.assertEqual(effects, {})
        self.assertEqual(data.trips, {})  # nothing merged
        # a post without car_id is still fine (an older app in the same car)
        status, _, _ = self.handle(post("trips", rows=[trip("2030-01-01T08:00")]), data)
        self.assertEqual(status, 200)

    def test_bad_car_id_is_refused(self):
        for bad in ("", "has space", "x" * 129, 5, ["a"], {"a": 1}, True):
            status, reply, _ = self.handle(post("have", what="trips", car_id=bad))
            self.assertEqual(status, 400, bad)
            self.assertNotIn("has space", reply["error"])
        # null counts as absent
        status, _, _ = self.handle(post("have", what="trips", car_id=None))
        self.assertEqual(status, 200)

    def test_version_is_tracked(self):
        data = core.ZoomyData()
        _, _, effects = self.handle(post("have", what="trips"), data)
        self.assertEqual(effects["version"], "9.9")
        self.assertEqual(data.app_version, "9.9")
        _, _, effects = self.handle(post("have", what="trips"), data)
        self.assertNotIn("version", effects)
        _, _, effects = self.handle(dict(post("have", what="trips"), version="4.18.21"), data)
        self.assertEqual(effects["version"], "4.18.21")
        self.assertEqual(data.status()["app_version"], "4.18.21")
        # odd versions are ignored, never refused
        for odd in (None, "", "v" * 41, ["4"], True):
            status, _, effects = self.handle(dict(post("have", what="trips"), version=odd), data)
            self.assertEqual(status, 200)
            self.assertNotIn("version", effects)
        self.assertEqual(data.app_version, "4.18.21")

    def test_format_is_accepted(self):
        for value in (1, 2, "1", None, {"x": 1}):
            status, _, _ = self.handle(dict(post("have", what="trips"), format=value))
            self.assertEqual(status, 200)
        self.handle(dict(post("have", what="trips"), format=1))
        self.assertEqual(self.data.post_format, 1)

    def test_refused_post_changes_nothing(self):
        status, _, effects = self.handle(post("nope", car_id="car-A1", version="1.0"))
        self.assertEqual((status, effects), (400, {}))
        self.assertIsNone(self.data.car_id)
        self.assertEqual(self.data.app_version, "9.9")


class TestRoutesOff(Base):
    """Route storage turned off in the options."""

    def setUp(self):
        self.data = fresh(store_routes=False)

    def test_route_is_thrown_away_but_answered_ok(self):
        status, reply, effects = self.handle(
            post("route", trip_start="2030-01-01T08:00", km=3.2, points=route_points(5))
        )
        self.assertEqual(status, 200)
        self.assertEqual(
            reply,
            {"ok": True, "kind": "route", "stored": 0, "discarded": 1, "store_routes": False, "have": 0},
        )
        self.assertEqual(effects, {"save": ("declined",)})  # no file to write
        self.assertEqual(self.data.routes, {})
        self.assertEqual(list(self.data.declined), ["2030-01-01T08:00"])
        self.assertEqual(self.data.status()["routes_discarded"], 1)
        # the points are nowhere
        self.assertNotIn("10.0", json.dumps(self.data.dump("declined")))

    def test_even_a_bad_route_is_not_read(self):
        status, reply, _ = self.handle(post("route", trip_start="2030-01-01T08:00", points="junk"))
        self.assertEqual((status, reply["ok"]), (200, True))
        status, reply, _ = self.handle(post("route", points=route_points(2)))
        self.assertEqual(status, 400)  # still needs a key

    def test_have_routes_lists_declined_so_the_car_stops(self):
        self.handle(post("route", trip_start="2030-01-01T08:00", points=route_points(2)))
        status, reply, _ = self.handle(post("have", what="routes"))
        self.assertEqual(reply, {"ok": True, "kind": "have", "what": "routes",
                                 "keys": ["2030-01-01T08:00"], "store_routes": False})
        # other sets are not affected
        self.assertEqual(self.handle(post("have", what="trips"))[1]["keys"], [])

    def test_turning_it_back_on_forgets_declined(self):
        self.handle(post("route", trip_start="2030-01-01T08:00", points=route_points(2)))
        self.assertTrue(self.data.set_store_routes(True))
        self.assertEqual(self.handle(post("have", what="routes"))[1]["keys"], [])
        self.assertFalse(self.data.set_store_routes(True))  # nothing more to forget

    def test_declined_is_capped(self):
        old = core.MAX_DECLINED
        core.MAX_DECLINED = 3
        try:
            for day in range(1, 6):
                self.handle(post("route", trip_start=f"2030-01-0{day}T08:00", points=[]))
            self.assertEqual(sorted(self.data.declined), ["2030-01-03T08:00", "2030-01-04T08:00", "2030-01-05T08:00"])
        finally:
            core.MAX_DECLINED = old


class TestDropAllRoutes(Base):
    def fill(self, data):
        for start in ("2030-01-01T08:00", "2030-01-02T08:00"):
            _, _, effects = data.handle(post("route", trip_start=start, points=route_points(3)), NOW)
            data.commit_route(effects["route"])

    def test_with_storage_on_the_car_may_send_again(self):
        self.fill(self.data)
        self.assertEqual(self.data.drop_all_routes(NOW), 2)
        self.assertEqual(self.data.have("routes"), [])
        self.assertEqual(self.data.declined, {})

    def test_with_storage_off_they_stay_away(self):
        self.fill(self.data)
        self.data.store_routes = False
        self.assertEqual(self.data.drop_all_routes(NOW), 2)
        self.assertEqual(self.data.routes, {})
        self.assertEqual(self.data.have("routes"), ["2030-01-02T08:00", "2030-01-01T08:00"])


class TestDeleteRouteFiles(unittest.TestCase):
    def test_only_route_files_are_removed(self):
        with tempfile.TemporaryDirectory() as root:
            folder = os.path.join(root, "routes")
            core.prepare_routes_dir(folder)
            for key in ("2030-01-01T08:00", "2030-01-02T08:00"):
                core.write_route_file(folder, core.route_file_name(key), {"trip_start": key, "points": [[10.0, 20.0]]})
            with open(os.path.join(folder, ".zoomy-abc.part"), "wb") as handle:
                handle.write(b"x")
            with open(os.path.join(folder, "notes.txt"), "w", encoding="utf-8") as handle:
                handle.write("keep me")
            self.assertEqual(core.delete_route_files(folder), 3)
            self.assertEqual(os.listdir(folder), ["notes.txt"])
            os.remove(os.path.join(folder, "notes.txt"))
            self.assertEqual(core.delete_route_files(folder), 0)
            self.assertFalse(os.path.exists(folder))  # an empty folder goes too
            self.assertEqual(core.delete_route_files(folder), 0)  # missing: fine


class TestSnapshotKept(Base):
    def test_snapshot_round_trip(self):
        body = post(trips=[trip("2030-01-01T08:00")], last_trip=trip("2030-01-01T08:00"))
        self.handle(body)
        saved = json.loads(json.dumps(self.data.dump("snapshot")))
        self.assertEqual(saved, {"body": body, "received": NOW, "version": "9.9"})
        other = core.ZoomyData()
        self.assertIsNone(other.load("snapshot", saved))
        self.assertEqual(other.snapshot, body)
        self.assertEqual(other.snapshot_received, NOW)
        self.assertEqual(other.app_version, "9.9")
        self.assertEqual(other.snapshot_view(), {"snapshot": body, "received": NOW})

    def test_odd_stored_snapshot(self):
        for bad in ({"body": 5}, {"body": []}, [], "x"):
            other = core.ZoomyData()
            self.assertIn("starting empty", other.load("snapshot", bad))
            self.assertIsNone(other.snapshot)
        other = core.ZoomyData()
        self.assertIsNone(other.load("snapshot", {"body": None, "received": 5, "version": ["x"]}))
        self.assertIsNone(other.snapshot_received)
        self.assertIsNone(other.app_version)


class TestRowsView(Base):
    def test_store_first_then_snapshot(self):
        self.assertEqual(self.data.rows_view("trips"), {"rows": [], "source": "store"})
        snap_rows = [trip("2030-01-02T08:00"), "junk", trip("2030-01-01T08:00")]
        self.handle(post(trips=snap_rows, charges=[charge("2030-01-01T22:00")]))
        view = self.data.rows_view("trips")
        self.assertEqual(view["source"], "snapshot")
        self.assertEqual([row["start"] for row in view["rows"]], ["2030-01-02T08:00", "2030-01-01T08:00"])
        self.handle(post("trips", rows=[trip("2030-01-05T08:00")]))
        view = self.data.rows_view("trips")
        self.assertEqual(view["source"], "store")
        self.assertEqual([row["start"] for row in view["rows"]], ["2030-01-05T08:00"])
        self.assertEqual(self.data.rows_view("charges")["source"], "snapshot")


class TestDeclinedPersistence(Base):
    def test_round_trip_and_cleaning(self):
        data = fresh(store_routes=False)
        data.handle(post("route", trip_start="2030-01-01T08:00", points=[]), NOW)
        saved = json.loads(json.dumps(data.dump("declined")))
        other = fresh(store_routes=False)
        self.assertIsNone(other.load("declined", saved))
        self.assertEqual(other.have("routes"), ["2030-01-01T08:00"])
        self.assertIn("dropped", other.load("declined", {"a": NOW, "": NOW, "k" * 300: NOW}))
        self.assertEqual(list(other.declined), ["a"])


if __name__ == "__main__":
    unittest.main()

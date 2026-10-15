"""Tests for custom_components/zoomy/summary.py: the sensor maths (no Home Assistant).

The expected numbers are what the earlier template sensors
(templates/zoomy.yaml) give for the same snapshot.
"""

from datetime import datetime, timedelta, timezone
import importlib.util
import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..", "..", "custom_components", "zoomy")


def load(name):
    spec = importlib.util.spec_from_file_location(f"zoomy_{name}_under_test", os.path.join(ROOT, f"{name}.py"))
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


summary = load("summary")
TZ = timezone(timedelta(hours=10))  # a made-up home zone


def snapshot(**extra):
    body = {
        "source": "zoomy",
        "version": "4.18.20",
        "sent_at": "2030-01-02T07:45:00",
        "last_trip": {"start": "2030-01-02T07:00:00", "end": "2030-01-02T07:42:00", "km": 31.4,
                      "kwh_used": 5.6, "kwh_regen": 0.9, "kwh_net": 4.7, "kwh_per_100km": 15.0,
                      "soc_start": 82.4, "soc_end": 75, "outside_c": 17.5},
        "last_charge": {"start": "2030-01-01T22:00:00", "end": "2030-01-02T01:05:00", "kwh_added": 20.0,
                        "soc_start": 45, "soc_end": 80, "avg_kw": 6.5, "type": "AC", "place": "home",
                        "cost": 3.0, "offpeak_kwh": 15.0},
        "this_month": {"month": "2030-01", "km": 120.5, "trips": 6, "charges": 2, "charges_without_price": 1,
                       "kwh_charged_home": 30.25, "kwh_charged_public": 0, "kwh_per_100km": 15.2, "cost": 6.5},
        "last_month": {"month": "2029-12", "km": 900, "trips": 40, "charges": 9, "charges_without_price": 0,
                       "kwh_charged_home": 120.0, "kwh_charged_public": 22.5, "kwh_per_100km": 16.1, "cost": 40.12},
        "health": {"usable_kwh": 61.2, "soh_pct": 97, "charges_counted": 42},
        "runs": [], "drain": {"x": 1},
    }
    body.update(extra)
    return body


class TestValues(unittest.TestCase):
    def test_full_snapshot(self):
        v = summary.sensor_values(snapshot(), TZ)
        self.assertEqual(v["last_update"], datetime(2030, 1, 2, 7, 45, tzinfo=TZ))
        self.assertEqual(v["app_version"], "4.18.20")
        self.assertEqual(v["last_trip_start"], datetime(2030, 1, 2, 7, 0, tzinfo=TZ))
        self.assertEqual(v["last_trip_distance"], 31.4)
        self.assertEqual(v["last_trip_duration"], 42)
        self.assertEqual((v["last_trip_energy"], v["last_trip_regen"], v["last_trip_consumption"]), (4.7, 0.9, 15.0))
        self.assertEqual((v["last_trip_battery_start"], v["last_trip_battery_end"]), (82.4, 75))
        self.assertEqual(v["last_trip_outside_temperature"], 17.5)
        self.assertEqual(v["last_charge_start"], datetime(2030, 1, 1, 22, 0, tzinfo=TZ))
        self.assertEqual(v["last_charge_energy"], 20.0)
        self.assertEqual(v["last_charge_duration"], 185)
        self.assertEqual((v["last_charge_battery_start"], v["last_charge_battery_end"]), (45, 80))
        self.assertEqual(v["last_charge_average_power"], 6.5)
        self.assertEqual(v["last_charge_charger"], "AC · Home")
        self.assertEqual(v["last_charge_cost"], 3.0)
        self.assertEqual(v["last_charge_price"], 15.0)  # 3.00 / 20 kWh = 15.0 c/kWh
        self.assertEqual(v["last_charge_off_peak"], 75)
        # the trip ended after the charge: its end level is the latest
        self.assertEqual(v["battery"], 75)
        self.assertEqual((v["battery_health"], v["battery_usable_energy"]), (97, 61.2))
        self.assertEqual(v["this_month_distance"], 120.5)
        self.assertEqual((v["this_month_trips"], v["this_month_charges"], v["this_month_charges_without_price"]), (6, 2, 1))
        self.assertEqual((v["this_month_energy_home"], v["this_month_energy_public"]), (30.25, 0))
        self.assertEqual((v["this_month_consumption"], v["this_month_cost"]), (15.2, 6.5))
        self.assertEqual(v["last_month_distance"], 900)
        self.assertEqual(v["last_month_cost"], 40.12)
        self.assertEqual(len(v), 40)
        self.assertEqual(summary.month_of(snapshot(), "this_month"), "2030-01")
        self.assertEqual(summary.month_of(snapshot(), "last_month"), "2029-12")

    def test_empty_and_odd_snapshots_give_none(self):
        for snap in (None, {}, [], "x", {"last_trip": "x", "last_charge": [], "this_month": 5, "health": None}):
            v = summary.sensor_values(snap, TZ)
            self.assertEqual(len(v), 40)
            self.assertTrue(all(value is None for value in v.values()), snap)

    def test_numbers_only(self):
        snap = snapshot(last_trip={"km": "12", "kwh_net": True, "kwh_regen": float("nan"),
                                   "kwh_per_100km": float("inf"), "soc_start": None})
        v = summary.sensor_values(snap, TZ)
        for key in ("last_trip_distance", "last_trip_energy", "last_trip_regen",
                    "last_trip_consumption", "last_trip_battery_start", "last_trip_duration"):
            self.assertIsNone(v[key], key)

    def test_times(self):
        self.assertEqual(summary.parse_time("2030-01-02T07:45:00Z", TZ), datetime(2030, 1, 2, 7, 45, tzinfo=timezone.utc))
        self.assertEqual(summary.parse_time("2030-01-02T07:45:00+02:00", TZ).utcoffset(), timedelta(hours=2))
        self.assertEqual(summary.parse_time("2030-01-02 07:45", TZ), datetime(2030, 1, 2, 7, 45, tzinfo=TZ))
        for bad in (None, "", "yesterday", "2030-13-01T00:00", 5, "x" * 50):
            self.assertIsNone(summary.parse_time(bad, TZ))

    def test_duration_rules(self):
        # end before start: the minutes field is used instead (if any)
        trip = {"start": "2030-01-02T08:00", "end": "2030-01-02T07:00", "minutes": 12}
        self.assertEqual(summary.minutes_between(trip, TZ), 12)
        self.assertIsNone(summary.minutes_between({"start": "2030-01-02T08:00"}, TZ))
        self.assertEqual(summary.minutes_between({"minutes": 7.5}, TZ), 7.5)
        self.assertIsNone(summary.minutes_between({"minutes": -1}, TZ))
        # 89 min 40 s rounds to 90
        self.assertEqual(summary.minutes_between({"start": "2030-01-02T08:00:00", "end": "2030-01-02T09:29:40"}, TZ), 90)

    def test_last_known_battery(self):
        def battery(trip_end, trip_soc, charge_end, charge_soc):
            snap = {"last_trip": {"end": trip_end, "soc_end": trip_soc},
                    "last_charge": {"end": charge_end, "soc_end": charge_soc}}
            return summary.last_known_battery(snap, TZ)
        self.assertEqual(battery("2030-01-02T08:00", 60, "2030-01-02T09:00", 90), 90)   # charged after
        self.assertEqual(battery("2030-01-02T10:00", 60, "2030-01-02T09:00", 90), 60)   # drove after
        self.assertEqual(battery("2030-01-02T09:00", 60, "2030-01-02T09:00", 90), 90)   # same time: charge
        self.assertEqual(battery(None, None, "2030-01-02T09:00", 90), 90)
        self.assertEqual(battery("2030-01-02T09:00", 60, None, None), 60)
        self.assertEqual(battery(None, 60, None, 90), 90)        # no times at all: as_timestamp(x, 0)
        self.assertIsNone(battery(None, None, None, None))

    def test_price_and_off_peak_guards(self):
        v = summary.sensor_values(snapshot(last_charge={"cost": 2, "kwh_added": 0, "offpeak_kwh": 5}), TZ)
        self.assertIsNone(v["last_charge_price"])
        self.assertIsNone(v["last_charge_off_peak"])
        v = summary.sensor_values(snapshot(last_charge={"cost": 1.234, "kwh_added": 7, "offpeak_kwh": 9}), TZ)
        self.assertEqual(v["last_charge_price"], 17.6)
        self.assertEqual(v["last_charge_off_peak"], 100)  # never above 100 %

    def test_charger_text(self):
        self.assertEqual(summary.charger_text({"type": "DC", "place": "PUBLIC"}), "DC · Public")
        self.assertEqual(summary.charger_text({"type": "AC"}), "AC")
        self.assertEqual(summary.charger_text({"place": "home"}), "Home")
        self.assertIsNone(summary.charger_text({"type": " ", "place": 5}))

    def test_month_label_guard(self):
        for bad in ({"month": "2030-13"}, {"month": "January"}, {"month": 202001}, None):
            self.assertIsNone(summary.month_of({"this_month": bad}, "this_month"))

    def test_numeric_version_becomes_text(self):
        self.assertEqual(summary.sensor_values({"version": 4.2}, TZ)["app_version"], "4.2")

    def test_values_are_plain(self):
        v = summary.sensor_values(snapshot(), TZ)
        json.dumps({key: (value.isoformat() if isinstance(value, datetime) else value) for key, value in v.items()})


class TestStringsCoverEverySensor(unittest.TestCase):
    """strings.json, translations/en.json and icons.json name every sensor key."""

    def test_names(self):
        keys = set(summary.sensor_values(None, TZ))
        for name in ("strings.json", os.path.join("translations", "en.json")):
            with open(os.path.join(ROOT, name), encoding="utf-8") as handle:
                strings = json.load(handle)
            self.assertEqual(set(strings["entity"]["sensor"]), keys, name)
        with open(os.path.join(ROOT, "strings.json"), encoding="utf-8") as a, \
             open(os.path.join(ROOT, "translations", "en.json"), encoding="utf-8") as b:
            self.assertEqual(json.load(a), json.load(b))
        with open(os.path.join(ROOT, "icons.json"), encoding="utf-8") as handle:
            icons = json.load(handle)
        self.assertLessEqual(set(icons["entity"]["sensor"]), keys)


if __name__ == "__main__":
    unittest.main()

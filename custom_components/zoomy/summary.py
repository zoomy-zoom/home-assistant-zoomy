"""Sensor values worked out from the car's latest snapshot (pure Python).

The maths is the same as the template sensors Zoomy used before this
integration (templates/zoomy.yaml, zoomy_extras.yaml), turned into one value
per sensor so each can have a proper unit, device class and state class.
Nothing in this file imports Home Assistant (tests/pure/test_summary.py).

The snapshot (no "kind") holds, among others:

    sent_at, version
    last_trip    {start, end, km, kwh_net, kwh_regen, kwh_per_100km,
                  soc_start, soc_end, outside_c, minutes?}
    last_charge  {start, end, kwh_added, soc_start, soc_end, avg_kw, type,
                  place, cost, offpeak_kwh, minutes?}
    this_month / last_month  {month "YYYY-MM", km, trips, charges,
                  charges_without_price, kwh_charged_home,
                  kwh_charged_public, kwh_per_100km, cost}
    health       {usable_kwh, soh_pct, charges_counted}
    runs, drain  (only served to the pages, no sensor)

Every value is None when the snapshot does not have it (the sensor then
shows "unknown"), never an error.
"""

from __future__ import annotations

from datetime import datetime, tzinfo
import math
from typing import Any

MONTHS = ("this_month", "last_month")


def number(value: Any) -> float | int | None:
    """Return value when it is a real, finite number (not True/False)."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float) and math.isfinite(value):
        return value
    return None


def text(value: Any, limit: int = 64) -> str | None:
    """Return value when it is a short, non-empty text (whitespace trimmed)."""
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value[:limit] if value else None


def parse_time(value: Any, tz: tzinfo) -> datetime | None:
    """Turn an ISO 8601 text into an aware datetime, or None.

    The car sends its local time, with or without an offset (or "Z").  A
    time without an offset is taken to be in tz (Home Assistant's zone).
    """
    if not isinstance(value, str) or not 10 <= len(value) <= 40:
        return None
    try:
        when = datetime.fromisoformat(value.strip())
    except ValueError:
        return None
    if when.tzinfo is None:
        when = when.replace(tzinfo=tz)
    return when


def _obj(value: Any) -> dict[str, Any]:
    """Return value if it is an object, else an empty one."""
    return value if isinstance(value, dict) else {}


def minutes_between(row: dict[str, Any], tz: tzinfo) -> float | None:
    """Return the minutes from row["start"] to row["end"] (rounded), or None.

    Falls back to row["minutes"] when the times are missing or out of order.
    """
    start = parse_time(row.get("start"), tz)
    end = parse_time(row.get("end"), tz)
    if start is not None and end is not None and end >= start:
        return round((end - start).total_seconds() / 60)
    minutes = number(row.get("minutes"))
    return minutes if minutes is not None and minutes >= 0 else None


def _epoch(value: Any, tz: tzinfo) -> float:
    """Return the POSIX time of an ISO text, 0 when there is none (as_timestamp(x, 0))."""
    when = parse_time(value, tz)
    return when.timestamp() if when is not None else 0.0


def charger_text(charge: dict[str, Any]) -> str | None:
    """Return "AC · Home" from the charge's type and place (as the template did)."""
    kind = text(charge.get("type"), 16) or ""
    place = text(charge.get("place"), 32) or ""
    place = place[:1].upper() + place[1:].lower() if place else ""
    if kind and place:
        return f"{kind} · {place}"
    return kind or place or None


def last_known_battery(snapshot: dict[str, Any], tz: tzinfo) -> float | int | None:
    """Return the battery level the car last told us about.

    The charge's end level when the charge ended at or after the trip, else
    the trip's end level (same rule as the template sensor).
    """
    trip = _obj(snapshot.get("last_trip"))
    charge = _obj(snapshot.get("last_charge"))
    trip_soc = number(trip.get("soc_end"))
    charge_soc = number(charge.get("soc_end"))
    if charge_soc is not None and (
        trip_soc is None or _epoch(charge.get("end"), tz) >= _epoch(trip.get("end"), tz)
    ):
        return charge_soc
    return trip_soc


def _price(charge: dict[str, Any]) -> float | None:
    """Return the price paid in cents per kWh, one decimal."""
    cost = number(charge.get("cost"))
    kwh = number(charge.get("kwh_added"))
    if cost is None or kwh is None or kwh <= 0:
        return None
    return round(cost / kwh * 100, 1)


def _off_peak(charge: dict[str, Any]) -> int | None:
    """Return the off-peak share of the energy added, 0 to 100 %."""
    off = number(charge.get("offpeak_kwh"))
    kwh = number(charge.get("kwh_added"))
    if off is None or kwh is None or kwh <= 0:
        return None
    return int(round(min(off / kwh * 100, 100)))


def sensor_values(snapshot: Any, tz: tzinfo) -> dict[str, Any]:
    """Return {sensor key: value} for one snapshot (None when not known)."""
    snap = _obj(snapshot)
    trip = _obj(snap.get("last_trip"))
    charge = _obj(snap.get("last_charge"))
    health = _obj(snap.get("health"))
    version = snap.get("version")
    if number(version) is not None:
        version = str(version)
    values: dict[str, Any] = {
        "last_update": parse_time(snap.get("sent_at"), tz),
        "app_version": text(version, 40),
        # last trip
        "last_trip_start": parse_time(trip.get("start"), tz),
        "last_trip_distance": number(trip.get("km")),
        "last_trip_duration": minutes_between(trip, tz) if trip else None,
        "last_trip_energy": number(trip.get("kwh_net")),
        "last_trip_regen": number(trip.get("kwh_regen")),
        "last_trip_consumption": number(trip.get("kwh_per_100km")),
        "last_trip_battery_start": number(trip.get("soc_start")),
        "last_trip_battery_end": number(trip.get("soc_end")),
        "last_trip_outside_temperature": number(trip.get("outside_c")),
        # last charge
        "last_charge_start": parse_time(charge.get("start"), tz),
        "last_charge_energy": number(charge.get("kwh_added")),
        "last_charge_duration": minutes_between(charge, tz) if charge else None,
        "last_charge_battery_start": number(charge.get("soc_start")),
        "last_charge_battery_end": number(charge.get("soc_end")),
        "last_charge_average_power": number(charge.get("avg_kw")),
        "last_charge_charger": charger_text(charge),
        "last_charge_cost": number(charge.get("cost")),
        "last_charge_price": _price(charge),
        "last_charge_off_peak": _off_peak(charge),
        # the battery
        "battery": last_known_battery(snap, tz),
        "battery_health": number(health.get("soh_pct")),
        "battery_usable_energy": number(health.get("usable_kwh")),
    }
    for prefix in MONTHS:
        month = _obj(snap.get(prefix))
        values[f"{prefix}_distance"] = number(month.get("km"))
        values[f"{prefix}_trips"] = number(month.get("trips"))
        values[f"{prefix}_charges"] = number(month.get("charges"))
        values[f"{prefix}_charges_without_price"] = number(month.get("charges_without_price"))
        values[f"{prefix}_energy_home"] = number(month.get("kwh_charged_home"))
        values[f"{prefix}_energy_public"] = number(month.get("kwh_charged_public"))
        values[f"{prefix}_consumption"] = number(month.get("kwh_per_100km"))
        values[f"{prefix}_cost"] = number(month.get("cost"))
    return values


def month_of(snapshot: Any, prefix: str) -> str | None:
    """Return the "YYYY-MM" text of this_month / last_month, or None."""
    month = _obj(_obj(snapshot).get(prefix)).get("month")
    if isinstance(month, str) and len(month) == 7 and month[4] == "-":
        year, mon = month[:4], month[5:]
        if year.isdigit() and mon.isdigit() and 1 <= int(mon) <= 12:
            return month
    return None

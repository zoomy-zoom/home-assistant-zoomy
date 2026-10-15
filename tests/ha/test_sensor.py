"""Sensor classes, units and the values after a snapshot."""

from __future__ import annotations

from datetime import datetime

from homeassistant.components.sensor import (
    DEVICE_CLASS_STATE_CLASSES,
    DEVICE_CLASS_UNITS,
    SensorDeviceClass,
)
from homeassistant.const import ATTR_DEVICE_CLASS, ATTR_UNIT_OF_MEASUREMENT
from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er
from homeassistant.util import dt as dt_util

from custom_components.zoomy.sensor import SENSORS

from .conftest import snapshot


async def test_descriptions_follow_home_assistant_rules() -> None:
    for description in SENSORS:
        if description.device_class is None:
            continue
        allowed = DEVICE_CLASS_STATE_CLASSES.get(description.device_class)
        if description.state_class is not None and allowed is not None:
            assert description.state_class in allowed, description.key
        units = DEVICE_CLASS_UNITS.get(description.device_class)
        if units and not description.currency:
            assert description.native_unit_of_measurement in units, description.key
    # only the car's own battery level is a "battery" sensor
    assert [d.key for d in SENSORS if d.device_class == SensorDeviceClass.BATTERY] == ["battery"]


async def test_states_after_a_snapshot(hass: HomeAssistant, setup_car, post) -> None:
    hass.config.currency = "AUD"
    await setup_car()
    await post(snapshot())

    def state(key):
        return hass.states.get(f"sensor.zoomy_test_car_{key}")

    # sent_at has no offset: it is the car's local time = Home Assistant's zone
    local = datetime(2030, 1, 2, 7, 45, tzinfo=dt_util.get_default_time_zone())
    assert dt_util.parse_datetime(state("last_update").state) == local
    assert state("last_update").attributes[ATTR_DEVICE_CLASS] == "timestamp"
    assert state("last_trip_distance").attributes[ATTR_UNIT_OF_MEASUREMENT] == "km"
    assert state("last_trip_duration").state == "42"
    assert state("last_trip_consumption").attributes[ATTR_UNIT_OF_MEASUREMENT] == "kWh/100km"
    assert state("last_trip_outside_temperature").state == "17.5"
    assert state("last_charge_cost").attributes[ATTR_UNIT_OF_MEASUREMENT] == "AUD"
    assert state("last_charge_cost").state == "3.0"
    assert state("last_charge_price").attributes[ATTR_UNIT_OF_MEASUREMENT] == "c/kWh"
    assert state("last_charge_charger").state == "AC · Home"
    assert state("last_charge_off_peak_share").state == "75"
    assert state("battery").attributes[ATTR_DEVICE_CLASS] == "battery"
    assert state("battery_usable_energy").state == "61.2"
    assert state("this_month_charged_at_home").state == "30.25"
    assert state("last_month_distance").attributes["month"] == "2029-12"
    assert state("last_month_charging_cost").state == "unknown"  # not in that snapshot
    assert state("app_version").state == "4.18.20"
    registry = er.async_get(hass)
    assert registry.async_get("sensor.zoomy_test_car_app_version").entity_category == "diagnostic"


async def test_values_survive_a_restart_of_the_entry(hass: HomeAssistant, setup_car, post) -> None:
    entry = await setup_car()
    await post(snapshot())
    await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    assert hass.states.get("sensor.zoomy_test_car_last_trip_distance").state == "31.4"

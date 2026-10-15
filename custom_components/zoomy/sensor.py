"""Sensors of a Zoomy car, from its latest snapshot (maths in summary.py).

No sensor carries a list, a route or any big attribute: the recorder keeps
every state, so the trip / charge history, dyno pulls, charge curves and
routes are served to the pages over the websocket instead.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from homeassistant.components.sensor import (
    SensorDeviceClass,
    SensorEntity,
    SensorEntityDescription,
    SensorStateClass,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import (
    PERCENTAGE,
    EntityCategory,
    UnitOfEnergy,
    UnitOfEnergyDistance,
    UnitOfLength,
    UnitOfPower,
    UnitOfTemperature,
    UnitOfTime,
)
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from . import summary
from .car import ZoomyCar

PARALLEL_UPDATES = 0
PRICE_UNIT = "c/kWh"  # cents per kWh, as on Australian power bills


@dataclass(frozen=True, kw_only=True)
class ZoomySensorDescription(SensorEntityDescription):
    """A Zoomy sensor: key = translation key = summary.sensor_values() key."""

    currency: bool = False  # unit is Home Assistant's currency
    month: str | None = None  # "this_month" / "last_month": adds a "month" attribute


def _distance(key: str, **kw: Any) -> ZoomySensorDescription:
    return ZoomySensorDescription(
        key=key,
        translation_key=key,
        device_class=SensorDeviceClass.DISTANCE,
        native_unit_of_measurement=UnitOfLength.KILOMETERS,
        suggested_display_precision=1,
        **kw,
    )


def _energy(key: str, precision: int = 1) -> ZoomySensorDescription:
    # ENERGY allows only the "total" state classes; a per-trip / per-charge
    # amount is not a running total, so it has none (as the template had).
    return ZoomySensorDescription(
        key=key,
        translation_key=key,
        device_class=SensorDeviceClass.ENERGY,
        native_unit_of_measurement=UnitOfEnergy.KILO_WATT_HOUR,
        suggested_display_precision=precision,
    )


def _timestamp(key: str, **kw: Any) -> ZoomySensorDescription:
    return ZoomySensorDescription(
        key=key, translation_key=key, device_class=SensorDeviceClass.TIMESTAMP, **kw
    )


def _minutes(key: str) -> ZoomySensorDescription:
    return ZoomySensorDescription(
        key=key,
        translation_key=key,
        device_class=SensorDeviceClass.DURATION,
        native_unit_of_measurement=UnitOfTime.MINUTES,
        suggested_display_precision=0,
    )


def _percent(key: str, **kw: Any) -> ZoomySensorDescription:
    return ZoomySensorDescription(
        key=key,
        translation_key=key,
        native_unit_of_measurement=PERCENTAGE,
        state_class=SensorStateClass.MEASUREMENT,
        suggested_display_precision=0,
        **kw,
    )


def _consumption(key: str) -> ZoomySensorDescription:
    return ZoomySensorDescription(
        key=key,
        translation_key=key,
        device_class=SensorDeviceClass.ENERGY_DISTANCE,
        native_unit_of_measurement=UnitOfEnergyDistance.KILO_WATT_HOUR_PER_100_KM,
        state_class=SensorStateClass.MEASUREMENT,
        suggested_display_precision=1,
    )


def _money(key: str) -> ZoomySensorDescription:
    # MONETARY allows only the "total" state class; none here (as the template).
    return ZoomySensorDescription(
        key=key,
        translation_key=key,
        device_class=SensorDeviceClass.MONETARY,
        suggested_display_precision=2,
        currency=True,
    )


def _count(key: str) -> ZoomySensorDescription:
    return ZoomySensorDescription(
        key=key,
        translation_key=key,
        state_class=SensorStateClass.MEASUREMENT,
        suggested_display_precision=0,
    )


def _month(prefix: str) -> tuple[ZoomySensorDescription, ...]:
    return (
        _distance(f"{prefix}_distance", month=prefix),
        _count(f"{prefix}_trips"),
        _count(f"{prefix}_charges"),
        _count(f"{prefix}_charges_without_price"),
        _energy(f"{prefix}_energy_home"),
        _energy(f"{prefix}_energy_public"),
        _consumption(f"{prefix}_consumption"),
        _money(f"{prefix}_cost"),
    )


SENSORS: tuple[ZoomySensorDescription, ...] = (
    _timestamp("last_update"),
    ZoomySensorDescription(
        key="app_version", translation_key="app_version", entity_category=EntityCategory.DIAGNOSTIC
    ),
    # last trip
    _timestamp("last_trip_start"),
    _distance("last_trip_distance", state_class=SensorStateClass.MEASUREMENT),
    _minutes("last_trip_duration"),
    _energy("last_trip_energy", 2),
    _energy("last_trip_regen", 2),
    _consumption("last_trip_consumption"),
    _percent("last_trip_battery_start"),
    _percent("last_trip_battery_end"),
    ZoomySensorDescription(
        key="last_trip_outside_temperature",
        translation_key="last_trip_outside_temperature",
        device_class=SensorDeviceClass.TEMPERATURE,
        native_unit_of_measurement=UnitOfTemperature.CELSIUS,
        state_class=SensorStateClass.MEASUREMENT,
        suggested_display_precision=1,
    ),
    # last charge
    _timestamp("last_charge_start"),
    _energy("last_charge_energy"),
    _minutes("last_charge_duration"),
    _percent("last_charge_battery_start"),
    _percent("last_charge_battery_end"),
    ZoomySensorDescription(
        key="last_charge_average_power",
        translation_key="last_charge_average_power",
        device_class=SensorDeviceClass.POWER,
        native_unit_of_measurement=UnitOfPower.KILO_WATT,
        state_class=SensorStateClass.MEASUREMENT,
        suggested_display_precision=1,
    ),
    ZoomySensorDescription(key="last_charge_charger", translation_key="last_charge_charger"),
    _money("last_charge_cost"),
    ZoomySensorDescription(
        key="last_charge_price",
        translation_key="last_charge_price",
        native_unit_of_measurement=PRICE_UNIT,
        state_class=SensorStateClass.MEASUREMENT,
        suggested_display_precision=1,
    ),
    _percent("last_charge_off_peak"),
    # the battery: only this one is a "battery" sensor (low-battery
    # automations look for that class; a trip's start level is not one)
    _percent("battery", device_class=SensorDeviceClass.BATTERY),
    _percent("battery_health"),
    ZoomySensorDescription(
        key="battery_usable_energy",
        translation_key="battery_usable_energy",
        device_class=SensorDeviceClass.ENERGY_STORAGE,
        native_unit_of_measurement=UnitOfEnergy.KILO_WATT_HOUR,
        state_class=SensorStateClass.MEASUREMENT,
        suggested_display_precision=1,
    ),
    *_month("this_month"),
    *_month("last_month"),
)

SENSOR_KEYS = tuple(description.key for description in SENSORS)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """Add the sensors of one car."""
    car: ZoomyCar = entry.runtime_data
    async_add_entities(ZoomySensor(car, description) for description in SENSORS)


class ZoomySensor(SensorEntity):
    """One value from the car's latest snapshot."""

    _attr_has_entity_name = True
    _attr_should_poll = False
    entity_description: ZoomySensorDescription

    def __init__(self, car: ZoomyCar, description: ZoomySensorDescription) -> None:
        """Set up the sensor."""
        self.car = car
        self.entity_description = description
        self._attr_unique_id = f"{car.entry_id}_{description.key}"
        self._attr_device_info = car.device_info

    async def async_added_to_hass(self) -> None:
        """Follow the car's snapshots."""
        self.async_on_remove(self.car.async_add_listener(self._changed))

    @callback
    def _changed(self, changed: frozenset[str]) -> None:
        """Write the state again after a new snapshot (or app version)."""
        if "snapshot" in changed or "version" in changed:
            self.async_write_ha_state()

    @property
    def native_value(self) -> Any:
        """Return the value worked out from the latest snapshot."""
        return self.car.values.get(self.entity_description.key)

    @property
    def native_unit_of_measurement(self) -> str | None:
        """Return the unit (Home Assistant's currency for money)."""
        if self.entity_description.currency:
            return self.hass.config.currency
        return self.entity_description.native_unit_of_measurement

    @property
    def extra_state_attributes(self) -> dict[str, Any] | None:
        """Return the month ("YYYY-MM") of a month sensor."""
        if self.entity_description.month is None:
            return None
        return {"month": summary.month_of(self.car.data.snapshot, self.entity_description.month)}

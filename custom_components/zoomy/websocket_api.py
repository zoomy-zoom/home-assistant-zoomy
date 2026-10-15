"""Websocket commands for the ZOOMY pages and cards (zoomy/...).

The pages read everything over Home Assistant's own signed-in websocket, so
they hold no secret and nothing is served from /local.  Every command takes
an optional "entry_id" (which car); without it the only car is used, and
with two or more cars it is required (the answer of zoomy/cars lists them).

    zoomy/cars                          the cars, their sensors' entity ids
    zoomy/status        [entry_id]      counts and last times, no payload
    zoomy/snapshot      [entry_id]      the latest snapshot (runs, health...)
    zoomy/trips         [entry_id]      {"rows", "source"} newest first
    zoomy/charges       [entry_id]      {"rows", "source"} newest first
    zoomy/dyno          [entry_id]      envelope, best, sag, pulls
    zoomy/curve_keys    [entry_id]      {"keys"} of the stored charge curves
    zoomy/charge_curve  charge_start    one charge curve
    zoomy/route_keys    [entry_id]      {"routes": [{trip_start, trip_end, km, n}]}
    zoomy/route         trip_start      one route {"points": [[lat, lon]...]}
    zoomy/subscribe     [entry_id]      events {"entry_id", "changed", "counts"}
                                        after every accepted post

Who may read: any signed-in user who may read the car's sensors (Home
Assistant's entity permissions; an administrator always may).
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

try:  # Home Assistant 2026.9 and later validate with probatio
    import probatio as vol
except ImportError:  # pragma: no cover - older Home Assistant
    import voluptuous as vol

from homeassistant.auth.permissions.const import POLICY_READ
from homeassistant.components import websocket_api
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import entity_registry as er

from .car import ZoomyCar
from .const import DOMAIN

ENTRY = vol.Optional("entry_id")


@callback
def async_setup(hass: HomeAssistant) -> None:
    """Register the zoomy/... websocket commands."""
    for command in (
        ws_cars,
        ws_status,
        ws_snapshot,
        ws_trips,
        ws_charges,
        ws_dyno,
        ws_curve_keys,
        ws_charge_curve,
        ws_route_keys,
        ws_route,
        ws_subscribe,
    ):
        websocket_api.async_register_command(hass, command)


def _loaded_cars(hass: HomeAssistant) -> list[ZoomyCar]:
    """Return the cars whose config entry is loaded."""
    return [
        entry.runtime_data
        for entry in hass.config_entries.async_entries(DOMAIN)
        if entry.state is ConfigEntryState.LOADED and isinstance(getattr(entry, "runtime_data", None), ZoomyCar)
    ]


def entity_ids(hass: HomeAssistant, entry_id: str) -> dict[str, str]:
    """Return {sensor key: entity id} for one car (renames are followed)."""
    registry = er.async_get(hass)
    prefix = f"{entry_id}_"
    found: dict[str, str] = {}
    for item in er.async_entries_for_config_entry(registry, entry_id):
        if item.unique_id.startswith(prefix):
            found[item.unique_id[len(prefix):]] = item.entity_id
    return found


def _may_read(hass: HomeAssistant, connection: websocket_api.ActiveConnection, car: ZoomyCar) -> bool:
    """Tell if this user may read this car's data."""
    user = connection.user
    if user is None:
        return False
    if user.is_admin:
        return True
    ids = entity_ids(hass, car.entry_id)
    probe = ids.get("last_update") or next(iter(ids.values()), None)
    if probe is None:
        return False
    return user.permissions.check_entity(probe, POLICY_READ)


def _pick_car(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> ZoomyCar | None:
    """Return the car the message is about, or send an error and return None."""
    cars = _loaded_cars(hass)
    entry_id = msg.get("entry_id")
    if entry_id is not None:
        car = next((car for car in cars if car.entry_id == entry_id), None)
    elif len(cars) == 1:
        car = cars[0]
    elif not cars:
        car = None
    else:
        connection.send_error(msg["id"], websocket_api.ERR_INVALID_FORMAT, "More than one car: send entry_id")
        return None
    if car is None:
        connection.send_error(msg["id"], websocket_api.ERR_NOT_FOUND, "No such Zoomy car")
        return None
    if not _may_read(hass, connection, car):
        connection.send_error(msg["id"], websocket_api.ERR_UNAUTHORIZED, "Not allowed")
        return None
    return car


def _simple(command: str, answer: Callable[[ZoomyCar], Any]) -> Callable:
    """Make a websocket command that answers from one car's data."""

    @websocket_api.websocket_command({vol.Required("type"): command, ENTRY: str})
    @callback
    def handler(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
        if (car := _pick_car(hass, connection, msg)) is not None:
            connection.send_result(msg["id"], answer(car))

    handler.__name__ = handler.__qualname__ = "ws_" + command.split("/", 1)[1]
    handler.__doc__ = f"Answer {command}."
    return handler


ws_status = _simple("zoomy/status", lambda car: {"entry_id": car.entry_id, **car.data.status()})
ws_snapshot = _simple("zoomy/snapshot", lambda car: car.data.snapshot_view())
ws_trips = _simple("zoomy/trips", lambda car: car.data.rows_view("trips"))
ws_charges = _simple("zoomy/charges", lambda car: car.data.rows_view("charges"))
ws_dyno = _simple("zoomy/dyno", lambda car: car.data.dyno_view())
ws_curve_keys = _simple("zoomy/curve_keys", lambda car: {"keys": car.data.curve_keys()})
ws_route_keys = _simple(
    "zoomy/route_keys",
    lambda car: {"routes": car.data.route_list(), "store_routes": car.data.store_routes},
)


@websocket_api.websocket_command({vol.Required("type"): "zoomy/cars"})
@callback
def ws_cars(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Send the cars this user may read, with their sensors' entity ids."""
    cars = []
    for car in _loaded_cars(hass):
        if not _may_read(hass, connection, car):
            continue
        cars.append(
            {
                "entry_id": car.entry_id,
                "title": car.entry.title,
                "device_id": car.device_id,
                "app_version": car.data.app_version,
                "last_update": car.data.snapshot_received,
                "store_routes": car.data.store_routes,
                "counts": car.data.counts(),
                "entities": entity_ids(hass, car.entry_id),
            }
        )
    connection.send_result(msg["id"], {"cars": cars})


@websocket_api.websocket_command(
    {vol.Required("type"): "zoomy/charge_curve", vol.Required("charge_start"): str, ENTRY: str}
)
@callback
def ws_charge_curve(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Send one charge curve."""
    if (car := _pick_car(hass, connection, msg)) is None:
        return
    curve = car.data.curve_view(msg["charge_start"])
    if curve is None:
        connection.send_error(msg["id"], websocket_api.ERR_NOT_FOUND, "No charge curve is stored for that charge")
        return
    connection.send_result(msg["id"], curve)


@websocket_api.websocket_command(
    {vol.Required("type"): "zoomy/route", vol.Required("trip_start"): str, ENTRY: str}
)
@websocket_api.async_response
async def ws_route(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Send one stored route (read from its file)."""
    if (car := _pick_car(hass, connection, msg)) is None:
        return
    route = await car.async_read_route(msg["trip_start"])
    if route is None:
        connection.send_error(msg["id"], websocket_api.ERR_NOT_FOUND, "No route is stored for that trip")
        return
    connection.send_result(msg["id"], route)


@websocket_api.websocket_command({vol.Required("type"): "zoomy/subscribe", ENTRY: str})
@callback
def ws_subscribe(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Send an event after every accepted post that changed something."""
    if (car := _pick_car(hass, connection, msg)) is None:
        return
    msg_id = msg["id"]

    @callback
    def forward(changed: frozenset[str]) -> None:
        connection.send_message(
            websocket_api.event_message(
                msg_id,
                {"entry_id": car.entry_id, "changed": sorted(changed), "counts": car.data.counts()},
            )
        )

    connection.subscriptions[msg_id] = car.async_add_listener(forward)
    connection.send_result(msg_id)

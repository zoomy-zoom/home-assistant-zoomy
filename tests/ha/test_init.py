"""Setting up a car, its webhook, storage, routes, unload, reload and removal."""

from __future__ import annotations

import logging
import os

import pytest

from custom_components.zoomy import car as car_module
from custom_components.zoomy.const import CONF_CAR_ID, DOMAIN
from homeassistant.components import webhook
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr, entity_registry as er
from homeassistant.util.aiohttp import MockRequest

from .conftest import OTHER_WEBHOOK_ID, WEBHOOK_ID, car_post, route_points, snapshot


def routes_folder(hass: HomeAssistant, entry_id: str) -> str:
    return hass.config.path(".cache", DOMAIN, entry_id, "routes")


async def test_setup_makes_device_sensors_and_webhook(hass: HomeAssistant, setup_car) -> None:
    entry = await setup_car()
    assert entry.state is ConfigEntryState.LOADED
    assert WEBHOOK_ID in hass.data[webhook.DOMAIN]
    info = hass.data[webhook.DOMAIN][WEBHOOK_ID]
    assert info.local_only is True
    assert info.allowed_methods == frozenset({"POST"})

    device = dr.async_get(hass).async_get_device_by_identifier((DOMAIN, entry.entry_id), entry.entry_id)
    assert device is not None
    assert device.name == "Zoomy Test car"
    entities = er.async_entries_for_config_entry(er.async_get(hass), entry.entry_id)
    assert len(entities) == 40
    assert all(item.device_id == device.id for item in entities)
    # no snapshot yet: every sensor is unknown
    state = hass.states.get("sensor.zoomy_test_car_last_trip_distance")
    assert state is not None and state.state == "unknown"
    # the route folder is made, private, under the cache folder (not www)
    folder = routes_folder(hass, entry.entry_id)
    assert os.path.isdir(folder)
    assert "www" not in folder.split(os.sep)


async def test_snapshot_feeds_the_sensors(hass: HomeAssistant, setup_car, post) -> None:
    entry = await setup_car()
    status, reply = await post(snapshot())
    assert (status, reply) == (200, {"ok": True, "kind": "snapshot"})
    assert hass.states.get("sensor.zoomy_test_car_last_trip_distance").state == "31.4"
    assert hass.states.get("sensor.zoomy_test_car_battery").state == "75"
    assert hass.states.get("sensor.zoomy_test_car_last_charge_price").state == "15.0"
    assert hass.states.get("sensor.zoomy_test_car_this_month_distance").attributes["month"] == "2030-01"
    # the app version shows on the device
    device = dr.async_get(hass).async_get_device_by_identifier((DOMAIN, entry.entry_id), entry.entry_id)
    assert device.sw_version == "4.18.20"
    # no sensor holds a list (the history goes over the websocket)
    for state in hass.states.async_all("sensor"):
        assert not any(isinstance(value, (list, dict)) for value in state.attributes.values())


async def test_detail_posts_and_replies(hass: HomeAssistant, setup_car, post) -> None:
    await setup_car()
    status, reply = await post(car_post("trips", rows=[{"start": "2030-01-01T08:00", "km": 3}]))
    assert (status, reply) == (200, {"ok": True, "kind": "trips", "stored": 1, "skipped": 0, "have": 1})
    status, reply = await post(car_post("have", what="trips"))
    assert reply == {"ok": True, "kind": "have", "what": "trips", "keys": ["2030-01-01T08:00"]}
    status, reply = await post(car_post("nope"))
    assert (status, reply) == (400, {"ok": False, "error": "unknown kind"})
    status, reply = await post(b"{not json")
    assert (status, reply) == (400, {"ok": False, "error": "body is not valid JSON"})
    status, reply = await post(b" " * (2 * 1024 * 1024 + 1))
    assert status == 413 and reply["ok"] is False


async def test_route_is_stored_as_a_file_and_never_logged(
    hass: HomeAssistant, setup_car, post, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG)
    entry = await setup_car()
    points = route_points(50)
    status, reply = await post(car_post("route", trip_start="2030-01-01T08:00", trip_end="2030-01-01T08:30",
                                        km=12.5, points=points))
    assert (status, reply) == (200, {"ok": True, "kind": "route", "stored": 1, "n": 50, "have": 1})
    folder = routes_folder(hass, entry.entry_id)
    files = os.listdir(folder)
    assert len(files) == 1 and files[0].endswith(".json")
    car = entry.runtime_data
    record = await car.async_read_route("2030-01-01T08:00")
    assert record["points"] == points
    # nothing about the route or the webhook id in Zoomy's log, and not in any
    # state.  (Home Assistant's own webhook and http code log the webhook id
    # at debug level; that is theirs, see README "Privacy".)
    ours = [record for record in caplog.records if record.name.startswith("custom_components.zoomy")]
    text = "\n".join(record.getMessage() for record in ours)
    for secret in ("10.00001", "20.00002", "2030-01-01T08:00", WEBHOOK_ID):
        assert secret not in text
    for record in caplog.records:
        assert "10.00001" not in record.getMessage()  # no one logs a coordinate
    for state in hass.states.async_all():
        assert "10.00001" not in str(state.attributes)


async def test_non_local_sender_is_ignored(hass: HomeAssistant, setup_car) -> None:
    entry = await setup_car()
    request = MockRequest(
        content=b'{"kind": "trips", "rows": [{"start": "2030-01-01T08:00"}]}',
        mock_source="test",
        method="POST",
        remote="203.0.113.7",
    )
    response = await webhook.async_handle_webhook(hass, WEBHOOK_ID, request)
    assert response.status == 200 and response.body is None  # the bare answer
    assert entry.runtime_data.data.trips == {}


async def test_unload_writes_waiting_changes_and_reload_keeps_data(
    hass: HomeAssistant, setup_car, post, hass_storage
) -> None:
    entry = await setup_car()
    await post(car_post("trips", rows=[{"start": "2030-01-01T08:00", "km": 3}]))
    await post(snapshot())
    key = f"{DOMAIN}.{entry.entry_id}.trips"
    assert key not in hass_storage  # still waiting for the delayed write
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    assert hass_storage[key]["data"] == {"2030-01-01T08:00": {"start": "2030-01-01T08:00", "km": 3}}
    assert entry.state is ConfigEntryState.LOADED
    car = entry.runtime_data
    assert list(car.data.trips) == ["2030-01-01T08:00"]
    assert car.data.app_version == "4.18.20"
    assert hass.states.get("sensor.zoomy_test_car_last_trip_distance").state == "31.4"
    # the webhook is registered again after the reload
    status_reply = await post(car_post("have", what="trips"))
    assert status_reply == (200, {"ok": True, "kind": "have", "what": "trips", "keys": ["2030-01-01T08:00"]})


async def test_unload_removes_the_webhook(hass: HomeAssistant, setup_car) -> None:
    entry = await setup_car()
    assert await hass.config_entries.async_unload(entry.entry_id)
    assert WEBHOOK_ID not in hass.data[webhook.DOMAIN]


async def test_remove_deletes_everything(hass: HomeAssistant, setup_car, post, hass_storage) -> None:
    entry = await setup_car()
    await post(car_post("trips", rows=[{"start": "2030-01-01T08:00"}]))
    await post(car_post("route", trip_start="2030-01-01T08:00", points=route_points(3)))
    await hass.config_entries.async_unload(entry.entry_id)  # writes the stores
    assert f"{DOMAIN}.{entry.entry_id}.trips" in hass_storage
    folder = routes_folder(hass, entry.entry_id)
    assert os.listdir(folder)
    await hass.config_entries.async_remove(entry.entry_id)
    await hass.async_block_till_done()
    assert not [key for key in hass_storage if key.startswith(f"{DOMAIN}.{entry.entry_id}.")]
    assert not os.path.exists(folder)
    assert not os.path.exists(hass.config.path(".cache", DOMAIN))


async def test_webhook_taken_by_something_else(hass: HomeAssistant, setup_car) -> None:
    await hass.async_block_till_done()
    from homeassistant.setup import async_setup_component

    assert await async_setup_component(hass, "webhook", {})

    async def other(*_args):
        return None

    webhook.async_register(hass, "template", "old trigger", WEBHOOK_ID, other)
    entry = await setup_car()
    assert entry.state is ConfigEntryState.SETUP_ERROR
    assert hass.data[webhook.DOMAIN][WEBHOOK_ID].domain == "template"  # left alone


async def test_car_id_is_adopted_then_enforced(hass: HomeAssistant, setup_car, post) -> None:
    entry = await setup_car()
    status, _ = await post(car_post("have", what="trips", car_id="car-A1"))
    assert status == 200
    assert entry.data[CONF_CAR_ID] == "car-A1"
    status, reply = await post(car_post("have", what="trips", car_id="car-B2"))
    assert (status, reply) == (409, {"ok": False, "error": "this webhook belongs to another car"})


async def test_two_cars_keep_apart(hass: HomeAssistant, setup_car, post) -> None:
    first = await setup_car()
    second = await setup_car(webhook_id=OTHER_WEBHOOK_ID, title="Second car")
    await post(car_post("trips", rows=[{"start": "2030-01-01T08:00"}]))
    await post(car_post("trips", rows=[{"start": "2030-02-01T08:00"}]), OTHER_WEBHOOK_ID)
    assert list(first.runtime_data.data.trips) == ["2030-01-01T08:00"]
    assert list(second.runtime_data.data.trips) == ["2030-02-01T08:00"]
    assert hass.states.get("sensor.zoomy_second_car_last_update") is not None


async def test_missing_route_files_are_dropped_at_start(
    hass: HomeAssistant, setup_car, post
) -> None:
    """After a backup restore the index is back but the files are not."""
    entry = await setup_car()
    await post(car_post("route", trip_start="2030-01-01T08:00", points=route_points(3)))
    await hass.config_entries.async_unload(entry.entry_id)
    car_module.logic.delete_route_files(routes_folder(hass, entry.entry_id))
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert entry.runtime_data.data.routes == {}
    status = entry.runtime_data.data.have("routes")
    assert status == []  # the car will send it again


async def test_route_with_a_lost_file_is_forgotten(hass: HomeAssistant, setup_car, post) -> None:
    entry = await setup_car()
    await post(car_post("route", trip_start="2030-01-01T08:00", points=route_points(3)))
    car_module.logic.delete_route_files(routes_folder(hass, entry.entry_id))
    assert await entry.runtime_data.async_read_route("2030-01-01T08:00") is None
    assert entry.runtime_data.data.routes == {}


async def test_have_routes_checks_the_files(hass: HomeAssistant, setup_car, post) -> None:
    """The cache folder was cleared while Home Assistant ran: the car is asked again."""
    entry = await setup_car()
    await post(car_post("route", trip_start="2030-01-01T08:00", points=route_points(3)))
    await post(car_post("route", trip_start="2030-01-02T08:00", points=route_points(3)))
    folder = routes_folder(hass, entry.entry_id)
    os.remove(os.path.join(folder, car_module.logic.route_file_name("2030-01-01T08:00")))
    status, reply = await post(car_post("have", what="routes"))
    assert status == 200
    assert reply["keys"] == ["2030-01-02T08:00"]

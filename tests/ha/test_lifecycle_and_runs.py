"""Unload / removal races, reconfigure, options on an unloaded car, and the timed runs."""

from __future__ import annotations

from datetime import timedelta
import os

from pytest_homeassistant_custom_component.common import async_fire_time_changed

from custom_components.zoomy.const import CONF_CAR_ID, CONF_STORE_ROUTES, CONF_WEBHOOK_ID, DOMAIN
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.util import dt as dt_util

from .conftest import OTHER_WEBHOOK_ID, car_post, route_points, snapshot


async def test_a_post_after_the_last_write_is_refused(hass: HomeAssistant, setup_car, post, hass_storage) -> None:
    """A post that comes in while the entry goes is not kept half: the car is told to try again."""
    entry = await setup_car()
    await post(car_post("trips", rows=[{"start": "2030-01-01T08:00"}]))
    car = entry.runtime_data
    await car.async_flush()  # what unload does, before the webhook is gone
    status, reply = await post(car_post("trips", rows=[{"start": "2030-01-02T08:00"}]))
    assert status == 503 and reply["ok"] is False and "try again" in reply["error"]
    assert list(car.data.trips) == ["2030-01-01T08:00"]
    assert not car._pending  # noqa: SLF001 - nothing waits to be written
    # removal now leaves nothing behind, also after the delayed-save time
    await hass.config_entries.async_remove(entry.entry_id)
    async_fire_time_changed(hass, dt_util.utcnow() + timedelta(seconds=30))
    await hass.async_block_till_done()
    assert not [key for key in hass_storage if key.startswith(f"{DOMAIN}.{entry.entry_id}.")]


async def test_reload_keeps_every_accepted_post(hass: HomeAssistant, setup_car, post) -> None:
    entry = await setup_car()
    await post(car_post("trips", rows=[{"start": "2030-01-01T08:00"}]))
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    status, _ = await post(car_post("trips", rows=[{"start": "2030-01-02T08:00"}]))
    assert status == 200
    assert sorted(entry.runtime_data.data.trips) == ["2030-01-01T08:00", "2030-01-02T08:00"]


async def test_reconfigure_forgets_the_car_id(hass: HomeAssistant, setup_car, post) -> None:
    """The app was set up again: new webhook id and new car_id. The car's history stays."""
    entry = await setup_car(**{CONF_CAR_ID: "car-A1"})
    await post(car_post("trips", rows=[{"start": "2030-01-01T08:00"}], car_id="car-A1"))
    result = await entry.start_reconfigure_flow(hass)
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {CONF_WEBHOOK_ID: OTHER_WEBHOOK_ID})
    assert result["type"] is FlowResultType.ABORT and result["reason"] == "reconfigure_successful"
    await hass.async_block_till_done()
    assert CONF_CAR_ID not in entry.data
    status, reply = await post(car_post("have", what="trips", car_id="car-B2"), OTHER_WEBHOOK_ID)
    assert status == 200 and reply["keys"] == ["2030-01-01T08:00"]
    assert entry.data[CONF_CAR_ID] == "car-B2"
    status, _ = await post(car_post("have", what="trips", car_id="car-C3"), OTHER_WEBHOOK_ID)
    assert status == 409  # and from now on that car_id is enforced again


async def test_delete_routes_on_a_car_that_is_not_loaded(hass: HomeAssistant, setup_car, post) -> None:
    entry = await setup_car()
    await post(car_post("route", trip_start="2030-01-01T08:00", points=route_points(3)))
    folder = hass.config.path(".cache", DOMAIN, entry.entry_id, "routes")
    assert os.listdir(folder)
    assert await hass.config_entries.async_unload(entry.entry_id)
    assert entry.state is ConfigEntryState.NOT_LOADED
    result = await hass.config_entries.options.async_init(entry.entry_id)
    result = await hass.config_entries.options.async_configure(
        result["flow_id"], {CONF_STORE_ROUTES: True, "delete_routes": True}
    )
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert not os.path.exists(folder) or not os.listdir(folder)
    # loaded again, the route list matches the (empty) folder
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert entry.runtime_data.data.routes == {}


def run(when: str, s60: float | None) -> dict:
    return {"when": when, "s_0_60": s60, "s_0_80": None, "s_0_100": None, "s_400m": None, "trap_kmh": None, "peak_g": None}


async def test_timed_runs(hass: HomeAssistant, setup_car, post, hass_ws_client) -> None:
    entry = await setup_car()
    await post(snapshot())
    ws = await hass_ws_client(hass)

    async def ask(msg):
        await ws.send_json_auto_id(msg)
        return await ws.receive_json()

    # nothing kept yet: the snapshot's runs
    reply = await ask({"type": "zoomy/runs"})
    assert reply["result"] == {"rows": [{"when": "2030-01-01T10:00:00", "s_0_100": 3.9}], "source": "snapshot"}
    status, reply = await post(car_post("runs", rows=[run("2030-01-01T10:00:00", 2.8), run("2030-01-03T10:00:00", 3.1)]))
    assert (status, reply) == (200, {"ok": True, "kind": "runs", "stored": 2, "skipped": 0, "dropped": 0, "have": 2})
    status, reply = await post(car_post("have", what="runs"))
    assert reply["keys"] == ["2030-01-03T10:00:00", "2030-01-01T10:00:00"]
    reply = await ask({"type": "zoomy/runs"})
    assert reply["result"]["source"] == "store"
    assert [row["when"] for row in reply["result"]["rows"]] == ["2030-01-03T10:00:00", "2030-01-01T10:00:00"]
    reply = await ask({"type": "zoomy/status"})
    assert reply["result"]["counts"]["runs"] == 2 and reply["result"]["posts"]["runs"] == 1
    # kept over a reload
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    assert sorted(entry.runtime_data.data.runs) == ["2030-01-01T10:00:00", "2030-01-03T10:00:00"]

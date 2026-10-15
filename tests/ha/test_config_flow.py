"""Add integration > Zoomy: pairing by code, adopting a sending car, options, reconfigure."""

from __future__ import annotations

import json
import os

from custom_components.zoomy.const import (
    CONF_CAR_ID,
    CONF_STORE_ROUTES,
    CONF_WEBHOOK_ID,
    DATA_PAIRING,
    DOMAIN,
    PAIR_WEBHOOK_ID,
)
from homeassistant import config_entries
from homeassistant.components import webhook
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.setup import async_setup_component

from .conftest import OTHER_WEBHOOK_ID, WEBHOOK_ID, car_post, route_points

CAR_WEBHOOK = "carMadeWebhookId_0123456789abcdefABCDEF"


async def start(hass: HomeAssistant, step: str) -> dict:
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": config_entries.SOURCE_USER})
    assert result["type"] is FlowResultType.MENU
    assert result["menu_options"] == ["pair", "existing"]
    return await hass.config_entries.flow.async_configure(result["flow_id"], {"next_step_id": step})


async def pair_post(hass_client_no_auth, body) -> tuple[int, str]:
    client = await hass_client_no_auth()
    resp = await client.post(f"/api/webhook/{PAIR_WEBHOOK_ID}", data=json.dumps(body))
    return resp.status, await resp.text()


def offer(code="123456", car_id="car-A1", webhook_id=CAR_WEBHOOK, **extra):
    return {"code": code, "car_id": car_id, "webhook_id": webhook_id, **extra}


# ----- adopting a car that already sends ---------------------------------------


async def test_existing_car(hass: HomeAssistant) -> None:
    result = await start(hass, "existing")
    assert result["type"] is FlowResultType.FORM and result["step_id"] == "existing"
    # the webhook id field is a password field
    schema = result["data_schema"].schema
    field = next(value for key, value in schema.items() if key == CONF_WEBHOOK_ID)
    assert field.config["type"] == "password"

    result = await hass.config_entries.flow.async_configure(result["flow_id"], {CONF_WEBHOOK_ID: "bad id!", "name": "x"})
    assert result["errors"] == {CONF_WEBHOOK_ID: "invalid_webhook_id"}
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"],
        {CONF_WEBHOOK_ID: f"  http://homeassistant.local:8123/api/webhook/{WEBHOOK_ID}  ", "name": "  My car "},
    )
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["title"] == "My car"
    assert result["data"][CONF_WEBHOOK_ID] == WEBHOOK_ID
    assert result["options"] == {CONF_STORE_ROUTES: True}
    await hass.async_block_till_done()
    entry = hass.config_entries.async_entries(DOMAIN)[0]
    assert entry.unique_id.startswith("webhook-") and WEBHOOK_ID not in entry.unique_id
    assert WEBHOOK_ID in hass.data[webhook.DOMAIN]

    # the same webhook id again
    result = await start(hass, "existing")
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {CONF_WEBHOOK_ID: WEBHOOK_ID})
    assert result["type"] is FlowResultType.ABORT and result["reason"] == "already_configured"


async def test_existing_car_webhook_used_by_something_else(hass: HomeAssistant) -> None:
    assert await async_setup_component(hass, "webhook", {})

    async def other(*_args):
        return None

    webhook.async_register(hass, "automation", "old trigger", WEBHOOK_ID, other)
    result = await start(hass, "existing")
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {CONF_WEBHOOK_ID: WEBHOOK_ID})
    assert result["errors"] == {CONF_WEBHOOK_ID: "webhook_in_use"}
    assert hass.data[webhook.DOMAIN][WEBHOOK_ID].domain == "automation"  # untouched
    # the id is never put back into the form
    assert "suggested_value" not in str(result["data_schema"].schema)


# ----- pairing by code -----------------------------------------------------------


async def test_pairing(hass: HomeAssistant, hass_client_no_auth) -> None:
    assert await async_setup_component(hass, "http", {})
    assert await async_setup_component(hass, "webhook", {})
    # nobody waits: the pairing webhook does not exist (bare 200, no body)
    status, text = await pair_post(hass_client_no_auth, offer())
    assert (status, text) == (200, "")

    result = await start(hass, "pair")
    assert result["type"] is FlowResultType.FORM and result["step_id"] == "pair"
    assert PAIR_WEBHOOK_ID in hass.data[webhook.DOMAIN]
    assert hass.data[webhook.DOMAIN][PAIR_WEBHOOK_ID].local_only is True

    status, text = await pair_post(hass_client_no_auth, offer(name="Blue car", version="4.19.0"))
    assert status == 200
    assert json.loads(text) == {"ok": True, "kind": "pair", "status": "waiting", "expires_in": 600}
    status, text = await pair_post(hass_client_no_auth, offer(code=123456))
    assert status == 400 and json.loads(text)["ok"] is False

    result = await hass.config_entries.flow.async_configure(result["flow_id"], {"code": "12345"})
    assert result["errors"] == {"code": "invalid_code"}
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {"code": "654321"})
    assert result["errors"] == {"code": "code_not_found"}
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {"code": "123 456"})
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["title"] == "Blue car"
    assert result["data"] == {CONF_WEBHOOK_ID: CAR_WEBHOOK, CONF_CAR_ID: "car-A1", "car_name": "Blue car"}
    assert result["result"].unique_id == "car-A1"
    await hass.async_block_till_done()
    # pairing is over: the pairing webhook is gone, the car's own one is there
    assert PAIR_WEBHOOK_ID not in hass.data[webhook.DOMAIN]
    assert CAR_WEBHOOK in hass.data[webhook.DOMAIN]
    # the car learns it is paired from a JSON answer on its own webhook
    client = await hass_client_no_auth()
    resp = await client.post(f"/api/webhook/{CAR_WEBHOOK}", data=json.dumps(car_post("have", what="trips")))
    assert resp.status == 200 and (await resp.json())["ok"] is True


async def test_pairing_without_a_name(hass: HomeAssistant, hass_client_no_auth) -> None:
    assert await async_setup_component(hass, "http", {})
    result = await start(hass, "pair")
    await pair_post(hass_client_no_auth, offer())
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {"code": "123456"})
    assert result["title"] == "Zoomy car"
    await hass.async_block_till_done()
    assert hass.states.get("sensor.zoomy_car_last_update") is not None  # device "Zoomy car"


async def test_too_many_wrong_codes(hass: HomeAssistant) -> None:
    result = await start(hass, "pair")
    for _ in range(4):
        result = await hass.config_entries.flow.async_configure(result["flow_id"], {"code": "000000"})
        assert result["errors"] == {"code": "code_not_found"}
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {"code": "000000"})
    assert result["type"] is FlowResultType.ABORT and result["reason"] == "too_many_attempts"
    assert PAIR_WEBHOOK_ID not in hass.data[webhook.DOMAIN]


async def test_closing_the_dialog_stops_listening(hass: HomeAssistant) -> None:
    result = await start(hass, "pair")
    assert PAIR_WEBHOOK_ID in hass.data[webhook.DOMAIN]
    hass.config_entries.flow.async_abort(result["flow_id"])
    assert PAIR_WEBHOOK_ID not in hass.data[webhook.DOMAIN]
    assert hass.data[DATA_PAIRING].book.offers_held() == 0


async def test_code_clash(hass: HomeAssistant, hass_client_no_auth) -> None:
    assert await async_setup_component(hass, "http", {})
    result = await start(hass, "pair")
    await pair_post(hass_client_no_auth, offer(car_id="car-A1"))
    await pair_post(hass_client_no_auth, offer(car_id="car-B2", webhook_id=CAR_WEBHOOK[::-1]))
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {"code": "123456"})
    assert result["errors"] == {"base": "code_clash"}
    assert not hass.config_entries.async_entries(DOMAIN)
    hass.config_entries.flow.async_abort(result["flow_id"])


async def test_repairing_a_known_car_moves_its_webhook(hass: HomeAssistant, hass_client_no_auth, setup_car) -> None:
    entry = await setup_car(car_id="car-A1")
    result = await start(hass, "pair")
    await pair_post(hass_client_no_auth, offer(car_id="car-A1", webhook_id=CAR_WEBHOOK))
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {"code": "123456"})
    assert result["type"] is FlowResultType.ABORT and result["reason"] == "repaired"
    await hass.async_block_till_done()
    assert entry.data[CONF_WEBHOOK_ID] == CAR_WEBHOOK
    assert CAR_WEBHOOK in hass.data[webhook.DOMAIN]
    assert WEBHOOK_ID not in hass.data[webhook.DOMAIN]
    assert len(hass.config_entries.async_entries(DOMAIN)) == 1


async def test_pairing_webhook_refuses_a_non_local_sender(hass: HomeAssistant) -> None:
    from homeassistant.util.aiohttp import MockRequest

    result = await start(hass, "pair")
    request = MockRequest(content=json.dumps(offer()).encode(), mock_source="test", method="POST", remote="198.51.100.4")
    response = await webhook.async_handle_webhook(hass, PAIR_WEBHOOK_ID, request)
    assert response.status == 200 and response.body is None
    assert hass.data[DATA_PAIRING].book.offers_held() == 0
    hass.config_entries.flow.async_abort(result["flow_id"])


# ----- options ------------------------------------------------------------------


async def test_options_route_storage_off_and_delete(hass: HomeAssistant, setup_car, post) -> None:
    entry = await setup_car()
    await post(car_post("route", trip_start="2030-01-01T08:00", points=route_points(3)))
    folder = hass.config.path(".cache", DOMAIN, entry.entry_id, "routes")
    assert os.listdir(folder)

    result = await hass.config_entries.options.async_init(entry.entry_id)
    assert result["type"] is FlowResultType.FORM
    result = await hass.config_entries.options.async_configure(
        result["flow_id"], {CONF_STORE_ROUTES: False, "delete_routes": True}
    )
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert entry.options == {CONF_STORE_ROUTES: False}  # the one-shot choice is not stored
    await hass.async_block_till_done()
    assert not os.path.exists(folder) or not os.listdir(folder)

    car = entry.runtime_data
    assert car.data.store_routes is False
    # the deleted route is not asked for again, a new one is thrown away
    status, reply = await post(car_post("have", what="routes"))
    assert reply["keys"] == ["2030-01-01T08:00"] and reply["store_routes"] is False
    status, reply = await post(car_post("route", trip_start="2030-01-02T08:00", points=route_points(3)))
    assert status == 200 and reply["discarded"] == 1
    assert not os.path.exists(folder) or not os.listdir(folder)

    # back on: the car may send what it still has
    result = await hass.config_entries.options.async_init(entry.entry_id)
    await hass.config_entries.options.async_configure(result["flow_id"], {CONF_STORE_ROUTES: True, "delete_routes": False})
    await hass.async_block_till_done()
    status, reply = await post(car_post("have", what="routes"))
    assert reply["keys"] == [] and reply["store_routes"] is True


# ----- reconfigure ----------------------------------------------------------------


async def test_reconfigure_new_webhook_id(hass: HomeAssistant, setup_car) -> None:
    entry = await setup_car()
    result = await entry.start_reconfigure_flow(hass)
    assert result["step_id"] == "reconfigure"
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {CONF_WEBHOOK_ID: "x"})
    assert result["errors"] == {CONF_WEBHOOK_ID: "invalid_webhook_id"}
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {CONF_WEBHOOK_ID: OTHER_WEBHOOK_ID})
    assert result["type"] is FlowResultType.ABORT and result["reason"] == "reconfigure_successful"
    await hass.async_block_till_done()
    assert entry.data[CONF_WEBHOOK_ID] == OTHER_WEBHOOK_ID
    assert OTHER_WEBHOOK_ID in hass.data[webhook.DOMAIN]
    assert WEBHOOK_ID not in hass.data[webhook.DOMAIN]


async def test_waiting_step_times_out(hass: HomeAssistant, freezer) -> None:
    from datetime import timedelta

    from pytest_homeassistant_custom_component.common import async_fire_time_changed

    from custom_components.zoomy import pairing

    clock = {"now": 1000.0}
    result = await start(hass, "pair")
    book = hass.data[DATA_PAIRING].book
    book._clock = lambda: clock["now"]  # noqa: SLF001 - the test drives the clock
    book.flow_waiting(result["flow_id"])
    assert PAIR_WEBHOOK_ID in hass.data[webhook.DOMAIN]
    clock["now"] += pairing.CODE_TTL + 2
    freezer.tick(timedelta(seconds=pairing.CODE_TTL + 2))
    async_fire_time_changed(hass)
    await hass.async_block_till_done()
    assert PAIR_WEBHOOK_ID not in hass.data[webhook.DOMAIN]
    # typing the code later shows the form again and listens again
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {"code": "123456"})
    assert result["errors"] == {"code": "code_not_found"}
    assert PAIR_WEBHOOK_ID in hass.data[webhook.DOMAIN]
    hass.config_entries.flow.async_abort(result["flow_id"])
    assert PAIR_WEBHOOK_ID not in hass.data[webhook.DOMAIN]

"""Diagnostics hold no secret, no name and no route."""

from __future__ import annotations

import json

from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.components.diagnostics import get_diagnostics_for_config_entry

from .conftest import WEBHOOK_ID, car_post, route_points, snapshot


async def test_diagnostics_are_redacted(hass: HomeAssistant, hass_client, setup_car, post) -> None:
    entry = await setup_car(title="Private Name", car_id="car-SECRET-1")
    await post(snapshot())
    await post(car_post("trips", rows=[{"start": "2030-01-01T08:00", "km": 987.654}]))
    await post(car_post("route", trip_start="2030-01-01T08:00", points=route_points(5)))

    diag = await get_diagnostics_for_config_entry(hass, hass_client, entry)
    text = json.dumps(diag)
    for secret in (WEBHOOK_ID, "car-SECRET-1", "Private Name", "2030-01-01T08:00", "10.00001", "987.654", "31.4"):
        assert secret not in text, secret
    assert diag["loaded"] is True
    assert diag["status"]["counts"]["routes"] == 1
    assert diag["entry"]["data"]["webhook_id"] == "**REDACTED**"
    assert diag["snapshot_shape"]["last_trip"] == "object (9 keys)"
    assert "last_trip_distance" in diag["sensors_with_a_value"]

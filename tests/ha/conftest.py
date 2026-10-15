"""Fixtures for the Home Assistant tests (pytest-homeassistant-custom-component).

Every test gets its own temporary config folder, so route files and the
cache folder never land anywhere else.  All ids, names and coordinates in
these tests are made up.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
import json
from typing import Any

import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.zoomy.const import (
    CONF_CAR_NAME,
    CONF_STORE_ROUTES,
    CONF_WEBHOOK_ID,
    DOMAIN,
)
from homeassistant.core import HomeAssistant

WEBHOOK_ID = "test-webhook-0123456789abcdef"
OTHER_WEBHOOK_ID = "other-webhook-fedcba9876543210"


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(enable_custom_integrations: None) -> None:
    """Let Home Assistant load custom_components/zoomy."""


@pytest.fixture
def hass_config_dir(hass_tmp_config_dir: str) -> str:
    """A fresh config folder for every test."""
    return hass_tmp_config_dir


def make_entry(
    webhook_id: str = WEBHOOK_ID,
    title: str = "Test car",
    store_routes: bool = True,
    **data: Any,
) -> MockConfigEntry:
    """Build a config entry for one car."""
    return MockConfigEntry(
        domain=DOMAIN,
        title=title,
        unique_id=f"unique-{webhook_id}",
        data={CONF_WEBHOOK_ID: webhook_id, CONF_CAR_NAME: title, **data},
        options={CONF_STORE_ROUTES: store_routes},
    )


@pytest.fixture
def setup_car(hass: HomeAssistant) -> Callable[..., Awaitable[MockConfigEntry]]:
    """Add and set up a car; returns its entry."""

    async def _setup(**kwargs: Any) -> MockConfigEntry:
        entry = make_entry(**kwargs)
        entry.add_to_hass(hass)
        await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()
        return entry

    return _setup


@pytest.fixture
def post(hass: HomeAssistant, hass_client_no_auth: Any) -> Callable[..., Awaitable[tuple[int, Any]]]:
    """POST a JSON body (or raw bytes) to a webhook; returns (status, JSON or text)."""

    async def _post(body: Any, webhook_id: str = WEBHOOK_ID) -> tuple[int, Any]:
        client = await hass_client_no_auth()
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        resp = await client.post(
            f"/api/webhook/{webhook_id}", data=data, headers={"Content-Type": "application/json"}
        )
        text = await resp.text()
        await hass.async_block_till_done()
        try:
            return resp.status, json.loads(text) if text else None
        except ValueError:
            return resp.status, text

    return _post


def car_post(kind: str | None = None, **fields: Any) -> dict[str, Any]:
    """Build a post the way the car does."""
    body: dict[str, Any] = {"source": "zoomy", "version": "4.18.20", "sent_at": "2030-01-02T07:45:00"}
    if kind is not None:
        body["kind"] = kind
    body.update(fields)
    return body


def snapshot(**extra: Any) -> dict[str, Any]:
    """A snapshot like the car's (made-up numbers)."""
    body = car_post(
        trips=[{"start": "2030-01-02T07:00:00", "km": 31.4}],
        charges=[{"start": "2030-01-01T22:00:00", "kwh_added": 20.0}],
        last_trip={"start": "2030-01-02T07:00:00", "end": "2030-01-02T07:42:00", "km": 31.4,
                   "kwh_net": 4.7, "kwh_regen": 0.9, "kwh_per_100km": 15.0, "soc_start": 82,
                   "soc_end": 75, "outside_c": 17.5},
        last_charge={"start": "2030-01-01T22:00:00", "end": "2030-01-02T01:05:00", "kwh_added": 20.0,
                     "soc_start": 45, "soc_end": 80, "avg_kw": 6.5, "type": "AC", "place": "home",
                     "cost": 3.0, "offpeak_kwh": 15.0},
        this_month={"month": "2030-01", "km": 120.5, "trips": 6, "charges": 2, "charges_without_price": 1,
                    "kwh_charged_home": 30.25, "kwh_charged_public": 0, "kwh_per_100km": 15.2, "cost": 6.5},
        last_month={"month": "2029-12", "km": 900, "trips": 40, "charges": 9},
        health={"usable_kwh": 61.2, "soh_pct": 97},
        runs=[{"when": "2030-01-01T10:00:00", "s_0_100": 3.9}],
    )
    body.update(extra)
    return body


def route_points(count: int) -> list[list[float]]:
    """Made-up [lat, lon] pairs around latitude 10, longitude 20."""
    return [[round(10 + i * 0.00001, 5), round(20 + i * 0.00002, 5)] for i in range(count)]

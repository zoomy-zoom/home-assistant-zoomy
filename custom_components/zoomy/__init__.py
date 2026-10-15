"""Zoomy for Home Assistant: trips, charges, dyno, charge curves and routes.

The Zoomy app in an MG electric car POSTs JSON to Home Assistant on the home
Wi-Fi (plain HTTP, local network only).  Each car is one config entry with
its own webhook; this integration keeps what the car sends, makes sensors
from its snapshot, serves the history to the ZOOMY dashboard over the
signed-in websocket, and adds that dashboard once.

    car.py            one car: storage, route files, the webhook handler
    logic.py          the rules for every post (pure Python, tested alone)
    summary.py        the sensor maths (pure Python)
    pairing.py        pairing by a 6-digit code (pure Python)
    pair_webhook.py   the "zoomy_pair" webhook used while pairing
    config_flow.py    Add integration > Zoomy, options, reconfigure
    websocket_api.py  zoomy/... commands for the pages
    frontend.py       serves frontend/ (the dashboard strategy and the cards)
    dashboard.py      the ZOOMY dashboard (strategy custom:zoomy)
"""

from __future__ import annotations

import logging

from homeassistant.components import webhook
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryError
from homeassistant.helpers import config_validation as cv, device_registry as dr
from homeassistant.helpers.typing import ConfigType

from . import dashboard, frontend, websocket_api
from .car import ZoomyCar, async_remove_car_data, device_name
from .const import DOMAIN, MANUFACTURER, MODEL

_LOGGER = logging.getLogger(__name__)

PLATFORMS: list[Platform] = [Platform.SENSOR]
CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

type ZoomyConfigEntry = ConfigEntry[ZoomyCar]


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Set up what all cars share: the websocket commands and the pages."""
    websocket_api.async_setup(hass)
    await frontend.async_register_frontend(hass)
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ZoomyConfigEntry) -> bool:
    """Set up one car."""
    car = ZoomyCar(hass, entry)
    await car.async_load()

    try:
        webhook.async_register(
            hass,
            DOMAIN,
            f"Zoomy ({entry.title})",
            car.webhook_id,
            car.async_handle_webhook,
            local_only=True,  # the car posts only on the home network
            allowed_methods=["POST"],
        )
    except ValueError as err:
        # Taken by something else, for example an old webhook trigger of a
        # template sensor.  The id itself is a secret: it is not logged.
        raise ConfigEntryError(translation_domain=DOMAIN, translation_key="webhook_in_use") from err
    entry.async_on_unload(lambda: webhook.async_unregister(hass, car.webhook_id))

    device = dr.async_get(hass).async_get_or_create(
        config_entry_id=entry.entry_id,
        identifiers={(DOMAIN, entry.entry_id)},
        name=device_name(entry.title),
        manufacturer=MANUFACTURER,
        model=MODEL,
        sw_version=car.data.app_version,
    )
    car.device_id = device.id

    entry.runtime_data = car
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    # The ZOOMY dashboard is added the first time a car is set up.
    entry.async_create_background_task(
        hass, dashboard.async_ensure_dashboard(hass), "zoomy dashboard"
    )
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ZoomyConfigEntry) -> bool:
    """Unload one car (its webhook goes with entry.async_on_unload)."""
    unloaded = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unloaded:
        car = entry.runtime_data
        # Write what is waiting now, so a reload never reads old data.
        await car.async_flush()
        car.async_notify({"unloaded"})  # the pages subscribe again
    return unloaded


async def async_remove_entry(hass: HomeAssistant, entry: ZoomyConfigEntry) -> None:
    """Delete everything stored for a car that is removed."""
    await async_remove_car_data(hass, entry.entry_id)
    others = [e for e in hass.config_entries.async_entries(DOMAIN) if e.entry_id != entry.entry_id]
    if not others:
        await dashboard.async_remove_dashboard(hass)

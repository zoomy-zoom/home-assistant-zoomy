"""Serving the ZOOMY dashboard and its cards (custom_components/zoomy/frontend/).

* The frontend folder is served at /zoomy_static/<integration version>/, so
  each new version gets fresh files and browsers may cache them for a month.
  The files import each other relatively (import "./core.js").
* frontend/zoomy.js (const.FRONTEND_ENTRY) is loaded as a JS module on every
  Home Assistant page.  It defines the dashboard strategy element
  "ll-strategy-dashboard-zoomy" (strategy type "custom:zoomy", see
  dashboard.py) and the six Zoomy cards, and offers "Zoomy" in Settings >
  Dashboards > Add dashboard (window.customStrategies).
* The cards read only the websocket commands in websocket_api.py
  (hass.callWS({type: "zoomy/..."})) and the integration's sensors.  No
  secrets in the files, no /local files, nothing written under www.
  frontend/README.md says which card asks what.
* Without frontend/zoomy.js nothing is registered (a debug line is logged),
  so the backend also works on its own.
"""

from __future__ import annotations

import logging
import os

from homeassistant.components.frontend import add_extra_js_url
from homeassistant.components.http import StaticPathConfig
from homeassistant.core import HomeAssistant
from homeassistant.loader import async_get_integration

from .const import DATA_FRONTEND, DOMAIN, FRONTEND_DIR, FRONTEND_ENTRY, STATIC_URL_BASE

_LOGGER = logging.getLogger(__name__)

FRONTEND_PATH = os.path.join(os.path.dirname(__file__), FRONTEND_DIR)


async def async_register_frontend(hass: HomeAssistant) -> dict[str, str] | None:
    """Serve the frontend folder and load its entry module (once per run).

    Returns {"version", "base_url", "entry_url"} when registered, else None.
    """
    if (done := hass.data.get(DATA_FRONTEND)) is not None:
        return done or None
    integration = await async_get_integration(hass, DOMAIN)
    version = str(integration.version or "0")
    entry_file = os.path.join(FRONTEND_PATH, FRONTEND_ENTRY)
    if not await hass.async_add_executor_job(os.path.isfile, entry_file):
        _LOGGER.debug("Zoomy: no frontend files yet (%s is missing)", FRONTEND_ENTRY)
        hass.data[DATA_FRONTEND] = {}
        return None
    base_url = f"{STATIC_URL_BASE}/{version}"
    await hass.http.async_register_static_paths(
        [StaticPathConfig(base_url, FRONTEND_PATH, cache_headers=True)]
    )
    entry_url = f"{base_url}/{FRONTEND_ENTRY}"
    add_extra_js_url(hass, entry_url)
    info = {"version": version, "base_url": base_url, "entry_url": entry_url}
    hass.data[DATA_FRONTEND] = info
    return info

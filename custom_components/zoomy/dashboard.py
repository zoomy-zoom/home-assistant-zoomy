"""The ZOOMY dashboard: added once, kept up to date by its strategy.

Choice: a storage dashboard (sidebar "ZOOMY", url /zoomy) whose WHOLE saved
config is {"strategy": {"type": "custom:zoomy"}}.  The browser builds the
views (Summary, Trips, Charges, Trip map, Dyno, Charge sheet) each time from
the strategy in frontend/zoomy.js, which ships with the integration, so the
dashboard always matches the installed version; nothing stored has to be
rewritten on an update.  It is a normal dashboard afterwards: the customer
can rename it, hide it, delete it, or "take control" to edit it.

Why not a full stored config: it would go stale on every update, and
rewriting it would wipe the customer's own edits.  Why not a custom panel:
it would not be a Lovelace dashboard (no cards, no editing, no theme views).

How it is added: exactly as Home Assistant adds its own Map dashboard
(homeassistant/components/lovelace/__init__.py, _create_map_dashboard):
create the dashboard item in the dashboards collection, then save the
strategy config into it.  Home Assistant does not hand integrations that
collection, so it is found through the "lovelace/dashboards/list" websocket
handler, which is a method of the collection's websocket helper.  If that
ever fails (a future Home Assistant), nothing breaks: a Repairs issue asks
the customer to add it by hand (Settings > Dashboards > Add dashboard >
Zoomy, which the strategy offers via window.customStrategies).

The dashboard is added once: a small store remembers it, so a customer who
deletes it does not get it back on the next restart.  When the last car is
removed, the dashboard is removed too if it is still the untouched strategy.
"""

from __future__ import annotations

import asyncio
import inspect
import logging
from typing import Any

from homeassistant.components import websocket_api
from homeassistant.components.frontend import async_panel_exists
from homeassistant.core import HomeAssistant
from homeassistant.helpers import issue_registry as ir
from homeassistant.helpers.storage import Store

from .const import (
    DASHBOARD_CONFIG,
    DASHBOARD_ICON,
    DASHBOARD_TITLE,
    DASHBOARD_URL_PATH,
    DATA_DASHBOARD_LOCK,
    DOMAIN,
    ISSUE_DASHBOARD,
)

_LOGGER = logging.getLogger(__name__)

STORE_KEY = f"{DOMAIN}.dashboard"
STORE_VERSION = 1


def _lovelace_dashboards(hass: HomeAssistant) -> dict[str | None, Any] | None:
    """Return Lovelace's {url_path: dashboard config object}, or None."""
    data = hass.data.get("lovelace")
    dashboards = getattr(data, "dashboards", None)
    if dashboards is None and isinstance(data, dict):  # very old layout
        dashboards = data.get("dashboards")
    return dashboards if isinstance(dashboards, dict) else None


def find_dashboards_collection(hass: HomeAssistant) -> Any | None:
    """Return Lovelace's dashboards collection, or None if it cannot be found."""
    handlers = hass.data.get(websocket_api.DOMAIN)
    if not isinstance(handlers, dict):
        return None
    registered = handlers.get("lovelace/dashboards/list")
    if not registered:
        return None
    handler = inspect.unwrap(registered[0])
    collection = getattr(getattr(handler, "__self__", None), "storage_collection", None)
    needed = ("async_create_item", "async_delete_item", "async_items")
    if collection is None or not all(hasattr(collection, name) for name in needed):
        return None
    return collection


def _lock(hass: HomeAssistant) -> asyncio.Lock:
    """Return the lock that keeps two cars from adding the dashboard twice."""
    lock = hass.data.get(DATA_DASHBOARD_LOCK)
    if lock is None:
        lock = hass.data[DATA_DASHBOARD_LOCK] = asyncio.Lock()
    return lock


def _raise_issue(hass: HomeAssistant) -> None:
    """Ask the customer (in Repairs) to add the dashboard by hand."""
    ir.async_create_issue(
        hass,
        DOMAIN,
        ISSUE_DASHBOARD,
        is_fixable=False,
        is_persistent=False,
        severity=ir.IssueSeverity.WARNING,
        translation_key=ISSUE_DASHBOARD,
    )


async def async_ensure_dashboard(hass: HomeAssistant) -> str:
    """Add the ZOOMY dashboard if it was never added; return what happened.

    Returns "added", "already" (added before, or the url is taken) or
    "manual" (could not be added: a Repairs issue was raised).
    """
    async with _lock(hass):
        store: Store[dict[str, Any]] = Store(hass, STORE_VERSION, STORE_KEY)
        state = await store.async_load() or {}
        if state.get("added"):
            return "already"
        if async_panel_exists(hass, DASHBOARD_URL_PATH):
            # Something already lives at /zoomy (maybe a dashboard the
            # customer made by hand): leave it alone, never ask again.
            await store.async_save({"added": True, "ours": False})
            return "already"
        collection = find_dashboards_collection(hass)
        dashboards = _lovelace_dashboards(hass)
        if collection is None or dashboards is None:
            _LOGGER.warning("Zoomy: could not add the ZOOMY dashboard by itself; see Repairs")
            _raise_issue(hass)
            return "manual"
        try:
            await collection.async_create_item(
                {
                    "allow_single_word": True,
                    "icon": DASHBOARD_ICON,
                    "title": DASHBOARD_TITLE,
                    "url_path": DASHBOARD_URL_PATH,
                    "require_admin": False,
                    "show_in_sidebar": True,
                }
            )
            await dashboards[DASHBOARD_URL_PATH].async_save(dict(DASHBOARD_CONFIG))
        except Exception as err:  # noqa: BLE001 - a dashboard must never stop setup
            _LOGGER.warning(
                "Zoomy: could not add the ZOOMY dashboard by itself (%s); see Repairs",
                type(err).__name__,
            )
            _raise_issue(hass)
            return "manual"
        await store.async_save({"added": True, "ours": True})
        ir.async_delete_issue(hass, DOMAIN, ISSUE_DASHBOARD)
        return "added"


async def async_remove_dashboard(hass: HomeAssistant) -> str:
    """Remove the dashboard (last car removed) if it is still untouched.

    Returns "removed", "kept" (edited by the customer, or not ours) or
    "gone" (already deleted).  Forgets that it was added either way, so a
    car added later gets it again.
    """
    async with _lock(hass):
        store: Store[dict[str, Any]] = Store(hass, STORE_VERSION, STORE_KEY)
        state = await store.async_load() or {}
        await store.async_remove()
        ir.async_delete_issue(hass, DOMAIN, ISSUE_DASHBOARD)
        if not state.get("ours"):
            return "kept"
        collection = find_dashboards_collection(hass)
        dashboards = _lovelace_dashboards(hass)
        if collection is None or dashboards is None:
            return "kept"
        item = next(
            (item for item in collection.async_items() if item.get("url_path") == DASHBOARD_URL_PATH),
            None,
        )
        if item is None:
            return "gone"
        try:
            config = await dashboards[DASHBOARD_URL_PATH].async_load(False)
        except Exception:  # noqa: BLE001 - no config saved: treat as edited
            return "kept"
        if config != DASHBOARD_CONFIG:
            return "kept"
        try:
            await collection.async_delete_item(item["id"])
        except Exception as err:  # noqa: BLE001
            _LOGGER.warning("Zoomy: could not remove the ZOOMY dashboard (%s)", type(err).__name__)
            return "kept"
        return "removed"

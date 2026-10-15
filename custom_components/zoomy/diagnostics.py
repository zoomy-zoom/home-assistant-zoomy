"""Diagnostics for a Zoomy car (Settings > Devices > Zoomy > Download diagnostics).

People attach this file to public bug reports, so it holds no webhook id,
no car id, no car name, no route, no route key (a trip start time), no
coordinate and no trip or charge values: only counts, times of posts,
error texts (which never quote a post), the settings and the shape of the
latest snapshot (its keys and value types).
"""

from __future__ import annotations

from typing import Any

from homeassistant.components.diagnostics import async_redact_data
from homeassistant.core import HomeAssistant

from .car import ZoomyCar
from .const import CONF_CAR_ID, CONF_CAR_NAME, CONF_WEBHOOK_ID, DATA_FRONTEND

TO_REDACT = {CONF_WEBHOOK_ID, CONF_CAR_ID, CONF_CAR_NAME, "title", "unique_id"}


def _shape(value: Any, depth: int = 0) -> Any:
    """Describe a value by its type only (objects one level down)."""
    if isinstance(value, dict):
        if depth >= 1:
            return f"object ({len(value)} keys)"
        return {str(key): _shape(item, depth + 1) for key, item in sorted(value.items(), key=lambda kv: str(kv[0]))}
    if isinstance(value, list):
        return f"list ({len(value)})"
    if value is None:
        return "null"
    return type(value).__name__


async def async_get_config_entry_diagnostics(hass: HomeAssistant, entry: Any) -> dict[str, Any]:
    """Return the diagnostics of one car."""
    car: ZoomyCar | None = getattr(entry, "runtime_data", None)
    info: dict[str, Any] = {
        "entry": async_redact_data(
            {
                "title": entry.title,
                "unique_id": entry.unique_id,
                "version": entry.version,
                "minor_version": entry.minor_version,
                "data": dict(entry.data),
                "options": dict(entry.options),
            },
            TO_REDACT,
        ),
        "frontend": hass.data.get(DATA_FRONTEND) or None,
    }
    if car is None:
        info["loaded"] = False
        return info
    info["loaded"] = True
    status = car.data.status()
    info["status"] = status
    info["snapshot_shape"] = _shape(car.data.snapshot) if car.data.snapshot is not None else None
    info["sensors_with_a_value"] = sorted(key for key, value in car.values.items() if value is not None)
    return info

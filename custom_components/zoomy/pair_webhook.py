"""The pairing webhook "zoomy_pair" (Home Assistant glue for pairing.py).

The webhook is registered only while an "Add Zoomy > Pair a car" step is
waiting for a code, and removed again when the last such step ends or has
waited 10 minutes.  While it is not registered Home Assistant answers a
bare 200 with no body (as for any unknown webhook), which the car reads as
"Home Assistant is not waiting": it keeps showing its code and tries again.
"""

from __future__ import annotations

import logging
from typing import Any

from aiohttp import web

from homeassistant.components import webhook
from homeassistant.core import CALLBACK_TYPE, HomeAssistant, callback
from homeassistant.helpers.event import async_call_later
from homeassistant.helpers.json import json_bytes
from homeassistant.util.json import json_loads

from . import pairing
from .car import read_body
from .const import DATA_PAIRING, DOMAIN, PAIR_WEBHOOK_ID

_LOGGER = logging.getLogger(__name__)


class PairingManager:
    """Owns the PairingBook and the pairing webhook."""

    def __init__(self, hass: HomeAssistant) -> None:
        """Start with the webhook not registered."""
        self.hass = hass
        self.book = pairing.PairingBook()
        self._registered = False
        self._timer: CALLBACK_TYPE | None = None

    @callback
    def flow_waiting(self, flow_id: str) -> None:
        """A flow shows the code form: listen for cars for 10 minutes."""
        self.book.flow_waiting(flow_id)
        if not self._registered:
            try:
                webhook.async_register(
                    self.hass,
                    DOMAIN,
                    "Zoomy pairing",
                    PAIR_WEBHOOK_ID,
                    self.async_handle_webhook,
                    local_only=True,
                    allowed_methods=["POST"],
                )
                self._registered = True
            except ValueError:
                _LOGGER.error("Zoomy: the pairing webhook id is already used by something else")
        self._schedule_check()

    @callback
    def flow_done(self, flow_id: str) -> None:
        """A flow ended: stop listening when nobody waits any more."""
        self.book.flow_done(flow_id)
        self._check()

    @callback
    def _schedule_check(self) -> None:
        """Look again just after the last waiting step times out."""
        if self._timer is not None:
            self._timer()
        self._timer = async_call_later(self.hass, pairing.CODE_TTL + 1, self._timer_fired)

    @callback
    def _timer_fired(self, _now: Any) -> None:
        """The waiting time is over (unless a step was shown again since)."""
        self._timer = None
        self._check()
        if self._registered:
            self._schedule_check()

    @callback
    def _check(self) -> None:
        """Remove the webhook when no step is waiting."""
        if self.book.is_waiting():
            return
        if self._registered:
            webhook.async_unregister(self.hass, PAIR_WEBHOOK_ID)
            self._registered = False
        if self._timer is not None:
            self._timer()
            self._timer = None

    @property
    def registered(self) -> bool:
        """Tell if the pairing webhook is registered now."""
        return self._registered

    async def async_handle_webhook(
        self, hass: HomeAssistant, webhook_id: str, request: web.Request
    ) -> web.Response:
        """Handle one pairing post from a car; always answer in JSON."""
        try:
            raw = await read_body(request, pairing.MAX_BODY_BYTES)
            if raw is None:
                status, reply = 413, {"ok": False, "error": "body too large"}
            else:
                try:
                    body = json_loads(raw)
                except ValueError:
                    body = None
                if body is None:
                    status, reply = 400, {"ok": False, "error": "body is not valid JSON"}
                else:
                    status, reply = self.book.offer(body, getattr(request, "remote", None))
        except Exception as err:  # noqa: BLE001 - the car must get JSON
            _LOGGER.error("Zoomy: unexpected %s while handling a pairing post", type(err).__name__)
            status, reply = 500, {"ok": False, "error": "internal error"}
        return web.Response(body=json_bytes(reply), status=status, content_type="application/json")


@callback
def get_pairing_manager(hass: HomeAssistant) -> PairingManager:
    """Return the one PairingManager (made on first use, by the config flow)."""
    manager: PairingManager | None = hass.data.get(DATA_PAIRING)
    if manager is None:
        manager = hass.data[DATA_PAIRING] = PairingManager(hass)
    return manager

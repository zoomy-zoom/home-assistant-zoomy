"""Adding a Zoomy car: pair by code, or adopt a car that already sends.

Add integration > Zoomy offers two ways:

* "Pair a car": the car shows a 6-digit code and sends it, with its own
  webhook id, to the pairing webhook (see pairing.py); the customer types
  the code here.  Title = the car's name, else "Zoomy car".
* "I already have a car sending to this Home Assistant": for cars on the
  admin build that already post to a webhook id.  The id is pasted in a
  password field; it is never logged and never shown again.

The options flow turns route storage on or off and can delete the stored
routes.  Reconfigure swaps a car's webhook id (when the app made a new one).
"""

from __future__ import annotations

import hashlib
import re
from typing import Any
from urllib.parse import unquote, urlsplit

try:  # Home Assistant 2026.9 and later validate with probatio
    import probatio as vol
except ImportError:  # pragma: no cover - older Home Assistant
    import voluptuous as vol

from homeassistant.components import webhook
from homeassistant.config_entries import (
    ConfigEntry,
    ConfigFlow,
    ConfigFlowResult,
    OptionsFlowWithReload,
)
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.selector import (
    BooleanSelector,
    TextSelector,
    TextSelectorConfig,
    TextSelectorType,
)

from . import logic, pairing
from .car import routes_dir
from .const import (
    CONF_CAR_ID,
    CONF_CAR_NAME,
    CONF_DELETE_ROUTES,
    CONF_STORE_ROUTES,
    CONF_WEBHOOK_ID,
    DATA_PAIRING,
    DEFAULT_CAR_NAME,
    DEFAULT_STORE_ROUTES,
    DOMAIN,
    MAX_CODE_TRIES,
    MAX_WEBHOOK_ID_LEN,
    MIN_WEBHOOK_ID_LEN,
)
from .pair_webhook import get_pairing_manager

CONF_CODE = "code"
CONF_NAME = "name"

_WEBHOOK_ID_RE = re.compile(r"[A-Za-z0-9_.~-]+")
_WEBHOOK_PATH_RE = re.compile(r"/api/webhook/([^/?#]+)")

PASSWORD = TextSelector(TextSelectorConfig(type=TextSelectorType.PASSWORD))
TEXT = TextSelector(TextSelectorConfig(type=TextSelectorType.TEXT))


def clean_webhook_id(value: Any) -> str | None:
    """Return the webhook id from what was pasted, or None if it is not one.

    Takes the bare id or a whole webhook address
    (http://homeassistant.local:8123/api/webhook/<id>).
    """
    if not isinstance(value, str):
        return None
    value = value.strip()
    if "/" in value:
        match = _WEBHOOK_PATH_RE.search(urlsplit(value).path if "://" in value else value)
        if match is None:
            return None
        value = unquote(match.group(1))
    if not MIN_WEBHOOK_ID_LEN <= len(value) <= MAX_WEBHOOK_ID_LEN:
        return None
    return value if _WEBHOOK_ID_RE.fullmatch(value) else None


def webhook_unique_id(webhook_id: str) -> str:
    """Return the unique id of a car known only by its webhook id.

    A hash, so the id itself is not repeated anywhere it need not be.
    """
    return "webhook-" + hashlib.sha256(webhook_id.encode()).hexdigest()[:24]


@callback
def webhook_taken(hass: HomeAssistant, webhook_id: str) -> bool:
    """Tell if something in Home Assistant already listens on this webhook id.

    Uses only the public webhook API: registering fails when the id is
    taken; when it succeeds the trial registration is removed at once (no
    await in between, so nothing can be received on it).
    """

    async def _never(*_args: Any) -> None:
        return None

    try:
        webhook.async_register(hass, DOMAIN, "Zoomy check", webhook_id, _never, local_only=True)
    except ValueError:
        return True
    webhook.async_unregister(hass, webhook_id)
    return False


def _name_or_default(value: Any) -> str:
    """Return the car name typed (cleaned), or the default title."""
    return pairing.clean_name(value) or DEFAULT_CAR_NAME


class ZoomyConfigFlow(ConfigFlow, domain=DOMAIN):
    """Add a Zoomy car."""

    VERSION = 1
    MINOR_VERSION = 1

    def __init__(self) -> None:
        """Start a flow."""
        self._wrong_codes = 0

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Ask which way to add the car."""
        return self.async_show_menu(step_id="user", menu_options=["pair", "existing"])

    # ----- pair by code -----------------------------------------------------------

    async def async_step_pair(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Wait for the code shown on the car."""
        manager = get_pairing_manager(self.hass)
        errors: dict[str, str] = {}
        if user_input is not None:
            code = pairing.normalise_code(user_input.get(CONF_CODE))
            if code is None:
                errors[CONF_CODE] = "invalid_code"
            else:
                try:
                    offer = manager.book.claim(code)
                except pairing.CodeClash:
                    offer = None
                    errors["base"] = "code_clash"
                else:
                    if offer is None:
                        self._wrong_codes += 1
                        if self._wrong_codes >= MAX_CODE_TRIES:
                            return self.async_abort(reason="too_many_attempts")
                        errors[CONF_CODE] = "code_not_found"
                if offer is not None:
                    return await self._async_finish_pairing(offer)
        manager.flow_waiting(self.flow_id)
        return self.async_show_form(
            step_id="pair",
            data_schema=vol.Schema({vol.Required(CONF_CODE): TEXT}),
            errors=errors,
        )

    async def _async_finish_pairing(self, offer: pairing.Offer) -> ConfigFlowResult:
        """Make (or update) the entry for the car that sent the code."""
        get_pairing_manager(self.hass).flow_done(self.flow_id)
        # The same car paired again (it made a new webhook id): move it.
        for entry in self._async_current_entries(include_ignore=False):
            if offer.car_id in (entry.unique_id, entry.data.get(CONF_CAR_ID)):
                if offer.webhook_id != entry.data.get(CONF_WEBHOOK_ID) and self._taken(offer.webhook_id):
                    return self.async_abort(reason="webhook_in_use")
                return self.async_update_reload_and_abort(
                    entry,
                    data_updates={CONF_WEBHOOK_ID: offer.webhook_id, CONF_CAR_ID: offer.car_id},
                    reason="repaired",
                )
        if self._taken(offer.webhook_id):
            return self.async_abort(reason="webhook_in_use")
        await self.async_set_unique_id(offer.car_id)
        self._abort_if_unique_id_configured()
        return self.async_create_entry(
            title=offer.name or DEFAULT_CAR_NAME,
            data={
                CONF_WEBHOOK_ID: offer.webhook_id,
                CONF_CAR_ID: offer.car_id,
                CONF_CAR_NAME: offer.name,
            },
            options={CONF_STORE_ROUTES: DEFAULT_STORE_ROUTES},
        )

    def _taken(self, webhook_id: str) -> bool:
        """Tell if the webhook id is used by another entry or anything else."""
        for entry in self._async_current_entries(include_ignore=False):
            if entry.data.get(CONF_WEBHOOK_ID) == webhook_id:
                return True
        return webhook_taken(self.hass, webhook_id)

    @callback
    def async_remove(self) -> None:
        """The flow ended or was closed: stop waiting for its code."""
        manager = self.hass.data.get(DATA_PAIRING) if self.hass else None
        if manager is not None:
            manager.flow_done(self.flow_id)

    # ----- a car that already sends --------------------------------------------------

    async def async_step_existing(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Adopt a car that already posts to a webhook id."""
        errors: dict[str, str] = {}
        if user_input is not None:
            webhook_id = clean_webhook_id(user_input.get(CONF_WEBHOOK_ID))
            if webhook_id is None:
                errors[CONF_WEBHOOK_ID] = "invalid_webhook_id"
            else:
                await self.async_set_unique_id(webhook_unique_id(webhook_id))
                self._abort_if_unique_id_configured()
                if self._taken(webhook_id):
                    errors[CONF_WEBHOOK_ID] = "webhook_in_use"
                else:
                    name = _name_or_default(user_input.get(CONF_NAME))
                    return self.async_create_entry(
                        title=name,
                        data={CONF_WEBHOOK_ID: webhook_id, CONF_CAR_NAME: name},
                        options={CONF_STORE_ROUTES: DEFAULT_STORE_ROUTES},
                    )
        # The webhook id is never put back in the form (not even after an error).
        return self.async_show_form(
            step_id="existing",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_WEBHOOK_ID): PASSWORD,
                    vol.Optional(CONF_NAME, default=DEFAULT_CAR_NAME): TEXT,
                }
            ),
            errors=errors,
        )

    async def async_step_reconfigure(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Give a car a new webhook id (the app made a new one)."""
        entry = self._get_reconfigure_entry()
        errors: dict[str, str] = {}
        if user_input is not None:
            webhook_id = clean_webhook_id(user_input.get(CONF_WEBHOOK_ID))
            if webhook_id is None:
                errors[CONF_WEBHOOK_ID] = "invalid_webhook_id"
            elif webhook_id != entry.data.get(CONF_WEBHOOK_ID) and self._taken(webhook_id):
                errors[CONF_WEBHOOK_ID] = "webhook_in_use"
            else:
                # The car_id is learnt again from the car's next post: a new
                # webhook id usually means the app was set up again, and it
                # may then name the car differently.  Kept, every post would
                # be refused with 409 and nothing but removing the car (and
                # its history) would help.
                data = {key: value for key, value in entry.data.items() if key != CONF_CAR_ID}
                data[CONF_WEBHOOK_ID] = webhook_id
                updates: dict[str, Any] = {"data": data}
                if entry.unique_id and entry.unique_id.startswith("webhook-"):
                    updates["unique_id"] = webhook_unique_id(webhook_id)
                return self.async_update_reload_and_abort(entry, **updates)
        return self.async_show_form(
            step_id="reconfigure",
            data_schema=vol.Schema({vol.Required(CONF_WEBHOOK_ID): PASSWORD}),
            errors=errors,
        )

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> ZoomyOptionsFlow:
        """Return the options flow."""
        return ZoomyOptionsFlow()


class ZoomyOptionsFlow(OptionsFlowWithReload):
    """Route storage on / off, and deleting the stored routes."""

    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Show the options."""
        if user_input is not None:
            store_routes = bool(user_input.get(CONF_STORE_ROUTES, DEFAULT_STORE_ROUTES))
            if user_input.get(CONF_DELETE_ROUTES):
                car = getattr(self.config_entry, "runtime_data", None)
                if car is not None and not car.closed:
                    # Decided with the new setting, so with storage off the
                    # deleted routes are not sent again.
                    car.data.store_routes = store_routes
                    await car.async_delete_routes()
                else:
                    # The car is not loaded (for example its set-up failed):
                    # delete the files themselves.  The route list is checked
                    # against the files when the car is next loaded.
                    await self.hass.async_add_executor_job(
                        logic.delete_route_files, routes_dir(self.hass, self.config_entry.entry_id)
                    )
            # The one-shot "delete" choice is never stored.
            return self.async_create_entry(data={CONF_STORE_ROUTES: store_routes})
        current = self.config_entry.options.get(CONF_STORE_ROUTES, DEFAULT_STORE_ROUTES)
        return self.async_show_form(
            step_id="init",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_STORE_ROUTES, default=current): BooleanSelector(),
                    vol.Required(CONF_DELETE_ROUTES, default=False): BooleanSelector(),
                }
            ),
        )

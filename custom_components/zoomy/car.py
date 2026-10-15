"""One Zoomy car: its data, its files and its webhook handler.

One config entry = one car = one ZoomyCar (entry.runtime_data).  All the
rules (validation, merging, file names, trimming) live in logic.py, which does
not import Home Assistant; this file only does the Home Assistant work.

Where things are kept:

    .storage/zoomy.<entry_id>.<set>      trips, charges, dyno, curves, the
                                         route index (no coordinates), the
                                         declined route keys, the snapshot
    .cache/zoomy/<entry_id>/routes/      one file per GPS route (mode 0600)

The routes sit in Home Assistant's cache folder (hass.config.cache_path)
because both Home Assistant's own backups and the Supervisor's leave that
folder out: a backup never holds anyone's whereabouts.  After a restore the
route index (which is in the backup) is checked against the files at
start-up; routes whose file is gone are dropped from the index, so the car
sends them again (those it still has) on its next pass.

PRIVACY: a route is the owner's whereabouts.  Nothing in this file logs a
key, a coordinate, a file name, a webhook id or any other payload, and
routes are never put in a state, an attribute, an event or under www.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from functools import partial
import logging
import os
import traceback
from typing import TYPE_CHECKING, Any

from aiohttp import web

from homeassistant.core import CALLBACK_TYPE, HomeAssistant, callback
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.json import json_bytes
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util
from homeassistant.util.json import json_loads

from . import logic, summary
from .const import (
    CONF_CAR_ID,
    CONF_STORE_ROUTES,
    CONF_WEBHOOK_ID,
    DEFAULT_CAR_NAME,
    DEFAULT_STORE_ROUTES,
    DOMAIN,
    MANUFACTURER,
    MODEL,
    READ_CHUNK,
    SAVE_DELAY,
    SIGNAL_CHANGED,
    STORAGE_VERSION,
)

if TYPE_CHECKING:
    from homeassistant.config_entries import ConfigEntry

_LOGGER = logging.getLogger(__name__)


def routes_dir(hass: HomeAssistant, entry_id: str) -> str:
    """Return the folder that holds one car's route files."""
    cache_path = getattr(hass.config, "cache_path", None)
    if cache_path is not None:
        return cache_path(DOMAIN, entry_id, "routes")
    return hass.config.path(".cache", DOMAIN, entry_id, "routes")


def store_key(entry_id: str, name: str) -> str:
    """Return the .storage key of one set of one car."""
    return f"{DOMAIN}.{entry_id}.{name}"


def device_name(title: str) -> str:
    """Return the device name for a car: "Zoomy <car name>"."""
    title = (title or "").strip() or DEFAULT_CAR_NAME
    return title if title.lower().startswith("zoomy") else f"Zoomy {title}"


class ZoomyCar:
    """The data of one car, its files and its webhook handler."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        """Set up the empty car (async_load fills it)."""
        self.hass = hass
        self.entry = entry
        self.entry_id = entry.entry_id
        self.webhook_id: str = entry.data[CONF_WEBHOOK_ID]
        self.routes_dir = routes_dir(hass, entry.entry_id)
        self.data = logic.ZoomyData(
            store_routes=entry.options.get(CONF_STORE_ROUTES, DEFAULT_STORE_ROUTES),
            car_id=entry.data.get(CONF_CAR_ID),
        )
        self.values: dict[str, Any] = summary.sensor_values(None, dt_util.get_default_time_zone())
        # One post is handled at a time, so two posts cannot interleave.
        self.lock = asyncio.Lock()
        self.device_id: str | None = None
        # Set by async_flush (unload, reload, removal): from then on posts are
        # answered "try again" and nothing more is written, so a post that
        # comes in while the entry goes cannot be saved after the last write
        # (a reload would lose it; a removal would leave its files behind).
        self.closed = False
        self._pending: set[str] = set()
        self._listeners: list[Callable[[frozenset[str]], None]] = []
        # One .storage file per set, readable by the Home Assistant user only.
        self._stores: dict[str, Store[dict[str, Any]]] = {
            name: Store(
                hass,
                STORAGE_VERSION,
                store_key(entry.entry_id, name),
                private=True,
                atomic_writes=True,
            )
            for name in logic.SETS
        }

    # ----- start and stop ------------------------------------------------------

    @property
    def device_info(self) -> DeviceInfo:
        """Return the device all of this car's entities belong to."""
        return DeviceInfo(
            identifiers={(DOMAIN, self.entry_id)},
            name=device_name(self.entry.title),
            manufacturer=MANUFACTURER,
            model=MODEL,
            sw_version=self.data.app_version,
        )

    async def async_load(self) -> None:
        """Read every set back from .storage and check the route files."""
        for name, store in self._stores.items():
            raw = None
            try:
                raw = await store.async_load()
            except Exception as err:  # noqa: BLE001 - never stop the setup
                _LOGGER.warning("Zoomy: reading the stored %s failed (%s)", name, type(err).__name__)
            problem = self.data.load(name, raw)
            if problem and raw is not None:
                _LOGGER.warning("Zoomy, %s: %s", name, problem)

        # Route storage turned back on: the car may send the declined routes.
        if self.data.set_store_routes(self.data.store_routes):
            self._schedule_save("declined")

        on_disk: set[str] | None = None
        try:
            on_disk = await self.hass.async_add_executor_job(
                logic.prepare_routes_dir, self.routes_dir, self.hass.config.path("www")
            )
        except logic.Refused as err:  # cannot happen with the cache folder
            _LOGGER.error("Zoomy: %s", err.text)
        except OSError as err:
            # Carry on: everything but the routes works without the folder,
            # and every route post tries to make the folder again.
            _LOGGER.warning(
                "Zoomy: the routes folder cannot be used yet (%s); routes will be refused",
                type(err).__name__,
            )
        if on_disk is not None:
            gone = self.data.prune_routes(on_disk)
            if gone:
                _LOGGER.info(
                    "Zoomy: %d stored routes have no file (for example after a restore) "
                    "and were dropped from the index; the car can send them again",
                    gone,
                )
                self._schedule_save("routes")
        self._update_values()

    async def async_flush(self) -> None:
        """Write every set with a pending change now and take no more posts.

        Called when the entry is unloaded (reload, removal).  The lock is
        taken, so a post being handled is finished and written first.
        """
        async with self.lock:
            self.closed = True
            for name in list(self._pending):
                await self._stores[name].async_save(self.data.dump(name))
            self._pending.clear()

    # ----- listeners (sensors, websocket subscriptions) ---------------------------

    @callback
    def async_add_listener(self, listener: Callable[[frozenset[str]], None]) -> CALLBACK_TYPE:
        """Call listener(changed set names) after each accepted change."""
        self._listeners.append(listener)

        @callback
        def remove() -> None:
            if listener in self._listeners:
                self._listeners.remove(listener)

        return remove

    @callback
    def async_notify(self, changed: set[str]) -> None:
        """Tell the listeners (and the dispatcher signal) what changed."""
        if not changed:
            return
        frozen = frozenset(changed)
        for listener in list(self._listeners):
            listener(frozen)
        async_dispatcher_send(self.hass, SIGNAL_CHANGED.format(self.entry_id), frozen)

    def _update_values(self) -> None:
        """Work the sensor values out again from the snapshot."""
        self.values = summary.sensor_values(self.data.snapshot, dt_util.get_default_time_zone())
        # Any post tells the app version, not only the snapshot.
        self.values["app_version"] = self.data.app_version or self.values.get("app_version")

    @callback
    def _schedule_save(self, name: str) -> None:
        """Write one set to .storage a few seconds from now."""
        if self.closed:
            return  # the entry is going: its last write is done
        self._pending.add(name)
        self._stores[name].async_delay_save(partial(self._dump_for_save, name), SAVE_DELAY)

    def _dump_for_save(self, name: str) -> dict[str, Any]:
        """Return the data of one set for its delayed write."""
        self._pending.discard(name)
        return self.data.dump(name)

    # ----- the webhook ---------------------------------------------------------------

    async def async_handle_webhook(
        self, hass: HomeAssistant, webhook_id: str, request: web.Request
    ) -> web.Response:
        """Handle one POST from the car and always answer in JSON.

        The webhook component answers an exception with an empty 200, which
        the car cannot tell from success, so nothing may escape from here.
        """
        try:
            # The body is read before the lock is taken so a slow upload
            # cannot hold up everything else; all the handling is locked.
            raw = await read_body(request, logic.MAX_BODY_BYTES)
            # When the car hangs up, Home Assistant cancels this handler.
            # The handling runs as its own task behind a shield so a post
            # that was read is handled to the end all the same: a route file
            # and its entry in the index can then never get out of step.
            status, reply = await asyncio.shield(
                self.hass.async_create_task(self._async_locked_post(raw), "zoomy post")
            )
        except Exception as err:  # noqa: BLE001
            status, reply = internal_error(err)
        return web.Response(body=json_bytes(reply), status=status, content_type="application/json")

    async def _async_locked_post(self, raw: bytes | None) -> tuple[int, dict[str, Any]]:
        """Handle one post body under the lock; never raises an Exception."""
        try:
            async with self.lock:
                return await self.async_handle_post(raw)
        except Exception as err:  # noqa: BLE001
            # Caught here as well as in the handler: when the handler was
            # cancelled nobody else is left to log it.
            return internal_error(err)

    async def async_handle_post(self, raw: bytes | None) -> tuple[int, dict[str, Any]]:
        """Handle one post body (the lock is held)."""
        now = dt_util.utcnow().isoformat(timespec="seconds")
        changed: set[str] = set()
        if self.closed:
            # The entry is being reloaded or removed; the car tries again on
            # its next pass (a JSON reply that is not "ok" ends this one).
            return 503, logic.error_reply("Zoomy is restarting in Home Assistant, try again later")
        try:
            body = logic.decode_body(raw, json_loads)
        except logic.Refused as err:
            status, reply, _effects = self.data.refuse(err.status, err.text, now)
            return status, reply
        if body.get("kind") == "have" and body.get("what") == "routes" and self.data.routes:
            # Before telling the car which routes are kept, check the files
            # are still there (the cache folder may have been cleared), so a
            # lost route is asked for again at once.
            if await self._async_prune_routes():
                changed.add("routes")
        status, reply, effects = self.data.handle(body, now)

        route = effects.get("route")
        if route is not None:
            # A route goes to its own file.  The index is only updated when
            # the file is on disk, so "have routes" never claims too much.
            try:
                await self.hass.async_add_executor_job(
                    logic.write_route_file,
                    self.routes_dir,
                    route["file"],
                    route["record"],
                    json_bytes,
                )
            except OSError as err:
                _LOGGER.error(
                    "Zoomy: a route file could not be written (%s, errno %s)",
                    type(err).__name__,
                    err.errno,
                )
                status, reply, _effects = self.data.refuse(500, "could not store the route file", now)
                return status, reply
            self.data.commit_route(route)

        for name in effects.get("save", ()):
            self._schedule_save(name)
            changed.add(name)

        if "car_id" in effects:
            self._adopt_car_id(effects["car_id"])
        if "version" in effects:
            self._schedule_save("snapshot")  # the version is kept with it
            self._update_device_version()
            self.values["app_version"] = self.data.app_version
            changed.add("version")
        if effects.get("snapshot"):
            self._update_values()
            changed.add("snapshot")

        self.async_notify(changed)
        return status, reply

    async def _async_prune_routes(self) -> int:
        """Drop index entries whose route file is gone; return how many."""
        try:
            on_disk = await self.hass.async_add_executor_job(
                logic.prepare_routes_dir, self.routes_dir, self.hass.config.path("www")
            )
        except (OSError, logic.Refused):
            return 0
        gone = self.data.prune_routes(on_disk)
        if gone:
            _LOGGER.info("Zoomy: %d stored routes had no file and were dropped from the index", gone)
            self._schedule_save("routes")
        return gone

    @callback
    def _adopt_car_id(self, car_id: str) -> None:
        """Keep the car_id a car sent for the first time with its entry."""
        if self.entry.data.get(CONF_CAR_ID) is None:
            self.hass.config_entries.async_update_entry(
                self.entry, data={**self.entry.data, CONF_CAR_ID: car_id}
            )

    @callback
    def _update_device_version(self) -> None:
        """Show the app version on the device."""
        if self.device_id is None:
            return
        registry = dr.async_get(self.hass)
        if registry.async_get(self.device_id) is not None:
            registry.async_update_device(self.device_id, sw_version=self.data.app_version)

    # ----- what the pages and the options ask for ------------------------------------

    async def async_read_route(self, key: str) -> dict[str, Any] | None:
        """Return one stored route (read in the executor), or None."""
        async with self.lock:
            name = self.data.route_file(key)
            if name is None:
                return None
            try:
                record = await self.hass.async_add_executor_job(
                    logic.read_route_file, self.routes_dir, name, json_loads, key
                )
            except ValueError:
                record = None  # the file is there but is not this route
            except OSError as err:
                _LOGGER.warning(
                    "Zoomy: a route file could not be read (%s, errno %s)",
                    type(err).__name__,
                    err.errno,
                )
                return None
            if record is None:
                # Missing or broken: forget it so the car sends it again.
                _LOGGER.warning("Zoomy: a stored route had no usable file and was dropped from the index")
                self.data.forget_route(key)
                self._schedule_save("routes")
                self.async_notify({"routes"})
            return record

    async def async_delete_routes(self) -> int:
        """Delete every stored route of this car; return how many were indexed."""
        async with self.lock:
            count = self.data.drop_all_routes(dt_util.utcnow().isoformat(timespec="seconds"))
            await self.hass.async_add_executor_job(logic.delete_route_files, self.routes_dir)
            self._schedule_save("routes")
            self._schedule_save("declined")
        self.async_notify({"routes"})
        return count


async def read_body(request: web.Request, limit: int) -> bytes | None:
    """Read a POST body; return None as soon as it is over limit bytes."""
    # getattr: requests relayed by Home Assistant itself (MockRequest) have
    # no content_length.
    length = getattr(request, "content_length", None)
    if length is not None and length > limit:
        return None
    # Taken once: MockRequest.content makes a new reader, back at the start
    # of the body, every time it is asked for.
    stream = request.content
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await stream.read(READ_CHUNK)
        if not chunk:
            break
        total += len(chunk)
        if total > limit:
            return None
        chunks.append(chunk)
    return b"".join(chunks)


def internal_error(err: Exception) -> tuple[int, dict[str, Any]]:
    """Log an unexpected exception (no payload) and build the 500 reply."""
    # The exception text could quote the payload, so only its type and the
    # places in the code (file, line, function) are logged.  lookup_lines is
    # off because the source lines are not wanted, and fetching them would
    # read the .py files from disk in the event loop.
    frames = traceback.StackSummary.extract(traceback.walk_tb(err.__traceback__), lookup_lines=False)
    where = " < ".join(
        f"{os.path.basename(frame.filename)}:{frame.lineno} {frame.name}" for frame in reversed(frames)
    )
    _LOGGER.error("Zoomy: unexpected %s while handling a post, at %s", type(err).__name__, where)
    return 500, logic.error_reply("internal error")


async def async_remove_car_data(hass: HomeAssistant, entry_id: str) -> None:
    """Delete the .storage files and the route files of one car."""
    for name in logic.SETS:
        try:
            await Store(hass, STORAGE_VERSION, store_key(entry_id, name)).async_remove()
        except OSError as err:
            _LOGGER.warning("Zoomy: a stored set could not be deleted (%s)", type(err).__name__)
    folder = routes_dir(hass, entry_id)

    def _remove() -> None:
        logic.delete_route_files(folder)
        # .cache/zoomy/<entry_id> is empty now; remove it too (and .cache/zoomy
        # when no other car is left).  rmdir never removes anything else.
        for path in (os.path.dirname(folder), os.path.dirname(os.path.dirname(folder))):
            try:
                os.rmdir(path)
            except OSError:
                break

    await hass.async_add_executor_job(_remove)

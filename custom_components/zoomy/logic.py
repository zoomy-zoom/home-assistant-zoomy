"""Pure logic of the Zoomy integration: what the car posts, and what is kept.

Ported from the earlier "zoomy_store" custom component (its core.py and
tests).  Nothing in this file imports Home Assistant,
so it is tested with plain Python (tests/pure).  The Home Assistant glue
(car.py) reads the POST, calls ZoomyData.handle_raw(), then does whatever the
returned "effects" say (save a set, write a route file, tell the sensors).

What the car sends, in short (every body is one JSON object with "source":
"zoomy", "version" = the app version and "sent_at" = local ISO time):

    no "kind" / null / "" / "snapshot"   the snapshot (feeds the sensors)
    "trips", "charges"                   {"rows": [...]}, merged by "start"
    "dyno"                               envelope etc. replaced, pulls merged
    "charge_curve"                       one curve, key "charge_start"
    "route"                              one GPS route, key "trip_start"
    "have"                               asks which keys are already stored

Optional fields that later app versions may add, accepted when present and
when absent: "car_id" (a short text naming the car; once known, a post with
another car_id is refused) and "format" (a number; the format is additive,
so it is only recorded).

PRIVACY: a route is the owner's whereabouts.  Nothing here logs anything, and
no error text ever contains payload data (keys, coordinates, values).
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime, timezone
import hashlib
import json
import math
import os
import re
import tempfile
from typing import Any

# --------------------------------------------------------------------------
# Limits
# --------------------------------------------------------------------------

MAX_BODY_BYTES = 2 * 1024 * 1024  # a bigger POST is refused with HTTP 413
MAX_ROWS = 1000  # rows (or dyno pulls) accepted in one post
MAX_POINTS = 2000  # points in one dyno pull or one charge curve
MAX_ROUTE_POINTS = 60000  # [lat, lon] pairs in one route
MAX_KEY_LEN = 200  # a key (a start time) longer than this is not a key
MAX_DECLINED = 20000  # route keys remembered while route storage is off
# Lists / objects inside each other, the body itself being level 1.  A real
# post needs 5 (body > pulls > pull > points > point).  Home Assistant reads
# JSON up to 1024 levels deep but cannot write more than about 255 (orjson),
# so a deeper value could be taken in and then never be saved or served.
MAX_DEPTH = 32
MAX_ERROR_LEN = 119  # the car shows the first 120 characters
# The latest snapshot is kept (in .storage, and for the sensors).  A real one
# is about 15 kB; a bigger one is cut down (trips / charges lists first).
SNAPSHOT_LIMIT = 65536
MAX_VERSION_LEN = 40

# The sets that are persisted (names used for the Store keys too).
SETS = ("trips", "charges", "dyno", "curves", "routes", "declined", "snapshot")

# car_id: printable ASCII without spaces, 1 to 128 characters.
_CAR_ID_RE = re.compile(r"[\x21-\x7e]{1,128}")

# What a "have" post may ask for -> the set that answers it.
HAVE_SETS = {
    "trips": "trips",
    "charges": "charges",
    "charge_curves": "curves",
    "routes": "routes",
}

# Dyno keys that every dyno post repeats; the newest post simply wins.
DYNO_REPLACED = ("envelope", "regen_envelope", "best", "sag")

# Lists in the snapshot that may be shortened to make it fit.
SNAPSHOT_LISTS = ("trips", "charges")

# Route file names: a cleaned-up copy of the key, a hash of the full key.
ROUTE_STEM_MAX = 48
ROUTE_HASH_LEN = 24
# A route is written under a temporary name like this first, then renamed.
PART_PREFIX = ".zoomy-"
PART_SUFFIX = ".part"
_UNSAFE_CHAR = re.compile(r"[^0-9A-Za-z]")
_ROUTE_FILE_RE = re.compile(r"[0-9A-Za-z-]{1,100}\.json")


class Refused(Exception):
    """A post (or a setting) that is refused; the text is safe to show."""

    def __init__(self, text: str, status: int = 400) -> None:
        """Remember the HTTP status and the (payload free) error text."""
        super().__init__(text)
        self.text = text
        self.status = status


# --------------------------------------------------------------------------
# Small helpers
# --------------------------------------------------------------------------


def utc_now_text() -> str:
    """Return the time now as an ISO 8601 UTC string."""
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def clip_error(text: str) -> str:
    """Keep an error text under 120 characters."""
    return str(text)[:MAX_ERROR_LEN]


def error_reply(text: str) -> dict[str, Any]:
    """Build the JSON the car gets when a post is refused."""
    return {"ok": False, "error": clip_error(text)}


def _is_number(value: Any) -> bool:
    """Tell if value is a real, finite number (True/False do not count)."""
    kind = type(value)
    if kind is int:
        return True
    return kind is float and math.isfinite(value)


def _key_ok(key: Any) -> bool:
    """Tell if key can be used as a store key: a non-empty, short string."""
    return isinstance(key, str) and 0 < len(key) <= MAX_KEY_LEN


def _text_or_none(value: Any) -> str | None:
    """Return value if it is a string, else None."""
    return value if isinstance(value, str) else None


def _points_problem(points: Any, limit: int) -> str | None:
    """Check a dyno / curve points list; return what is wrong or None.

    A point is a list of numbers or nulls, for example [kmh, kw] or
    [minutes, soc, kw].
    """
    if type(points) is not list:
        return "points must be a list"
    if len(points) > limit:
        return f"too many points, the limit is {limit}"
    for point in points:
        if type(point) is not list:
            return "a point is not a list of numbers"
        for value in point:
            if value is not None and not _is_number(value):
                return "a point is not a list of numbers"
    return None


def _newest_first(keys) -> list[str]:
    """Sort keys newest first (they are timestamps, so reverse text order)."""
    return sorted(keys, reverse=True)


# --------------------------------------------------------------------------
# Reading the POST body
# --------------------------------------------------------------------------


def _no_constants(name: str) -> Any:
    """Refuse NaN / Infinity, which are not JSON."""
    raise ValueError("not JSON")


def _strict_loads(raw: bytes | str) -> Any:
    """Parse JSON with the standard library, refusing NaN and Infinity."""
    return json.loads(raw, parse_constant=_no_constants)


def nested_too_deep(value: Any, limit: int = MAX_DEPTH) -> bool:
    """Tell if value holds lists / objects more than limit levels deep.

    Goes down one level at a time with plain lists (no recursion) and looks
    at every value once.
    """
    level = [value]
    for _ in range(limit):
        deeper: list[Any] = []
        for item in level:
            kind = type(item)
            if kind is dict:
                deeper.extend(item.values())
            elif kind is list:
                deeper.extend(item)
        if not deeper:
            return False
        level = deeper
    # level now holds what sits inside the limit-th level: a list or an
    # object among it is one level too deep.
    return any(type(item) in (dict, list) for item in level)


def decode_body(
    raw: bytes | None,
    loads: Callable[[Any], Any] | None = None,
    limit: int = MAX_BODY_BYTES,
) -> dict[str, Any]:
    """Turn the raw POST body into a dict, or raise Refused.

    raw is None when the glue already knows the body is too large.  loads is
    the JSON parser to use (the glue passes Home Assistant's orjson based
    one); the default is the standard library.
    """
    if raw is None or len(raw) > limit:
        raise Refused("body too large, the limit is 2 MB", 413)
    try:
        body = (loads or _strict_loads)(raw)
    except (ValueError, TypeError, RecursionError):
        # The parser's own message can quote the payload, so it is not used.
        raise Refused("body is not valid JSON") from None
    if not isinstance(body, dict):
        raise Refused("body must be a JSON object")
    if nested_too_deep(body):
        # Refused before anything is merged or passed on; see MAX_DEPTH.
        raise Refused("body is nested too deeply")
    return body


# --------------------------------------------------------------------------
# Snapshot trimming
# --------------------------------------------------------------------------


def json_size(value: Any) -> float:
    """Return the size in bytes of value as compact JSON (inf if unknown)."""
    try:
        text = json.dumps(value, separators=(",", ":"), ensure_ascii=False)
        return len(text.encode("utf-8", "surrogatepass"))
    except (TypeError, ValueError, RecursionError):
        return math.inf


def trim_snapshot(body: Any, limit: int = SNAPSHOT_LIMIT) -> dict[str, Any]:
    """Return a copy of the snapshot whose JSON is under limit bytes.

    Every top-level key is kept.  When the snapshot is too big the "trips"
    and "charges" lists are cut to their first N rows (they are newest
    first), with the largest N that fits.  If it is too big even without
    any rows, the largest other values become null first, largest first,
    until the rest fits.  Never raises.
    """
    if not isinstance(body, dict):
        return {}
    out = dict(body)
    if json_size(out) < limit:
        return out

    # Too big.  From here on the size is added up from the parts, each one
    # measured once, so the work stays in step with the size of the body.
    # (Serialising the whole snapshot again after every change would make a
    # body of very many small keys take minutes, with Home Assistant stopped.)
    names = [name for name in SNAPSHOT_LISTS if type(out.get(name)) is list]
    for name in names:
        out[name] = []
    # {"key":value,"key":value}: the braces, the commas, each key and colon
    total = 2 + max(len(out) - 1, 0) + sum(json_size(key) + 1 for key in out)
    sizes: dict[Any, float] = {}
    for key, value in out.items():
        size = json_size(value)
        if size == math.inf:
            # Cannot be measured, so it could not be sent either.
            out[key] = None
            size = 4
        sizes[key] = size
        total += size

    # 1. Too big even without any rows (not a real snapshot): blank the
    #    biggest values, biggest first, until the rest fits.  null takes 4
    #    bytes, so blanking a value of 4 bytes or less gains nothing.
    for key in sorted(sizes, key=sizes.__getitem__, reverse=True):
        if total < limit or sizes[key] <= 4:
            break
        out[key] = None
        total += 4 - sizes[key]

    if total < limit:
        # 2. Put back the first N rows of each list, the largest N that fits.
        if names:
            row_sizes = {name: [json_size(row) for row in body[name]] for name in names}
            keep = 0
            for n in range(1, max(len(body[name]) for name in names) + 1):
                extra = 0
                for name in names:
                    if n <= len(row_sizes[name]):
                        # one more row, and a comma in front of it unless first
                        extra += row_sizes[name][n - 1] + (1 if n > 1 else 0)
                if total + extra >= limit:
                    break
                total += extra
                keep = n
            for name in names:
                out[name] = body[name][:keep]
        # Belt and braces: measure the real thing, once.
        if json_size(out) < limit:
            return out
        for name in names:
            out[name] = []

    # 3. The key names alone are too long (not a real snapshot): keep the
    #    keys that fit so the snapshot can still be kept.
    kept: dict[str, Any] = {}
    total = 2  # {}
    for key in out:
        extra = json_size(key) + len(":null") + (1 if kept else 0)
        if total + extra >= limit:
            break
        kept[key] = None
        total += extra
    return kept


# --------------------------------------------------------------------------
# Route files
# --------------------------------------------------------------------------


def route_file_name(key: Any) -> str:
    """Make the file name for a route from its key (the trip start).

    Only [0-9A-Za-z] survive, everything else becomes "-", the result is cut
    to a fixed length, and a hash of the full key is added so two different
    keys always get different names.  The name therefore never holds a path
    separator or a dot other than the one in ".json", and cannot point
    outside the routes folder.
    """
    text = key if isinstance(key, str) else repr(key)
    digest = hashlib.sha256(text.encode("utf-8", "surrogatepass")).hexdigest()
    stem = _UNSAFE_CHAR.sub("-", text)[:ROUTE_STEM_MAX]
    return f"{stem}-{digest[:ROUTE_HASH_LEN]}.json"


def is_route_file_name(name: Any) -> bool:
    """Tell if name looks like something route_file_name() produced."""
    return isinstance(name, str) and _ROUTE_FILE_RE.fullmatch(name) is not None


def is_inside(path: str, parent: str) -> bool:
    """Tell if path is parent itself or somewhere below it."""
    try:
        real = os.path.normcase(os.path.realpath(path))
        real_parent = os.path.normcase(os.path.realpath(parent))
        return os.path.commonpath([real, real_parent]) == real_parent
    except (ValueError, OSError):
        return False  # for example two different drives


def prepare_routes_dir(folder: str, forbidden_parent: str | None = None) -> set[str]:
    """Create the routes folder and return the route files it holds.

    Blocking: call it in the executor, at start-up only (before any route
    can be written).  Raises Refused when the folder is inside
    forbidden_parent (the web-served "www" folder), OSError when the folder
    cannot be made or read.

    An empty route file (what a power cut could leave) does not count, so
    the car is asked for that route again.  Part files left behind by a
    write that was killed half way are removed.
    """
    if forbidden_parent and is_inside(folder, forbidden_parent):
        raise Refused("routes_dir must not be inside the www folder")
    os.makedirs(folder, mode=0o700, exist_ok=True)
    found: set[str] = set()
    with os.scandir(folder) as entries:
        for entry in entries:
            name = entry.name
            try:
                if name.startswith(PART_PREFIX) and name.endswith(PART_SUFFIX):
                    os.remove(entry.path)
                elif (
                    is_route_file_name(name)
                    and entry.is_file()  # a folder has a size too (Linux)
                    and entry.stat().st_size > 0
                ):
                    found.add(name)
            except OSError:
                pass  # cannot be removed / looked at: not counted as a route
    return found


def _compact_json(record: Any) -> str:
    """Serialise record as compact JSON with the standard library."""
    return json.dumps(record, separators=(",", ":"), allow_nan=False)


def write_route_file(
    folder: str,
    name: str,
    record: dict[str, Any],
    dumps: Callable[[Any], bytes | str] | None = None,
) -> None:
    """Write one route file, all or nothing.

    Blocking: call it in the executor.  The data goes to a temporary file in
    the same folder, is flushed to the disk, and is then renamed over the
    real name, so a reader sees the old route or the new one, never half of
    one, also after a power cut.  The file is private to the Home Assistant
    user (mode 0600).  Raises OSError.

    homeassistant.util.file.write_utf8_file does the same job but logs the
    file name as an error when it fails; the name is made from the route's
    key, so this writer is used instead and logs nothing.
    """
    if not is_route_file_name(name):
        raise ValueError("unsafe route file name")
    data = (dumps or _compact_json)(record)
    if isinstance(data, str):
        data = data.encode("utf-8")
    os.makedirs(folder, mode=0o700, exist_ok=True)
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="wb", dir=folder, prefix=PART_PREFIX, suffix=PART_SUFFIX, delete=False
        ) as tmp:
            tmp_path = tmp.name
            tmp.write(data)
            # On the disk before the rename, or a power cut could leave an
            # empty file under the real name.
            tmp.flush()
            os.fsync(tmp.fileno())
        os.replace(tmp_path, os.path.join(folder, name))
        tmp_path = None
    finally:
        if tmp_path is not None:
            # The write or the rename failed: do not leave the part file.
            try:
                os.remove(tmp_path)
            except OSError:
                pass


def read_route_file(
    folder: str,
    name: str,
    loads: Callable[[Any], Any] | None = None,
    key: str | None = None,
) -> dict[str, Any] | None:
    """Read one route file.

    Blocking: call it in the executor.  Returns None when the file is not
    there, raises ValueError when it is not a route (or not the route for
    key), OSError for other disk trouble.
    """
    if not is_route_file_name(name):
        raise ValueError("unsafe route file name")
    try:
        with open(os.path.join(folder, name), "rb") as handle:
            raw = handle.read()
    except FileNotFoundError:
        return None
    try:
        record = (loads or json.loads)(raw)
    except (ValueError, TypeError, RecursionError):
        raise ValueError("route file is not JSON") from None
    if not isinstance(record, dict) or type(record.get("points")) is not list:
        raise ValueError("route file is not a route")
    if key is not None and record.get("trip_start") != key:
        raise ValueError("route file is for another trip")
    return record




def delete_route_files(folder: str) -> int:
    """Delete every route file (and left-over part file) in folder.

    Blocking: call it in the executor.  Returns how many files were removed.
    Files that do not look like route files are left alone, and the folder
    itself is removed when it ends up empty.  A missing folder is fine.
    """
    removed = 0
    try:
        entries = list(os.scandir(folder))
    except FileNotFoundError:
        return 0
    for entry in entries:
        name = entry.name
        is_part = name.startswith(PART_PREFIX) and name.endswith(PART_SUFFIX)
        if not (is_part or is_route_file_name(name)):
            continue
        try:
            if entry.is_file(follow_symlinks=False):
                os.remove(entry.path)
                removed += 1
        except OSError:
            pass
    try:
        os.rmdir(folder)  # only works when it is empty
    except OSError:
        pass
    return removed


# --------------------------------------------------------------------------
# The store
# --------------------------------------------------------------------------


def check_car_id(value: Any) -> str:
    """Return value if it is a usable car_id, else raise Refused."""
    if not isinstance(value, str) or _CAR_ID_RE.fullmatch(value) is None:
        raise Refused("car_id must be 1 to 128 letters, digits or signs")
    return value


class ZoomyData:
    """Everything one car has sent, as plain dicts.

    trips     {start: row}
    charges   {start: row}
    dyno      {"envelope", "regen_envelope", "best", "sag", "pulls": {when: pull}}
    curves    {charge_start: {"points": [...], "received": sent_at}}
    routes    {trip_start: {"file", "km", "n", "trip_end"}}   (the index only;
              the points live in one file per route, written by the glue)
    declined  {trip_start: when}   routes thrown away while route storage was
              off; "have routes" lists them so the car stops sending them
    snapshot  the latest snapshot (trimmed), feeds the sensors
    """

    def __init__(
        self,
        store_routes: bool = True,
        car_id: str | None = None,
        snapshot_limit: int = SNAPSHOT_LIMIT,
    ) -> None:
        """Start with empty sets."""
        self.snapshot_limit = snapshot_limit
        self.store_routes = store_routes
        self.car_id = car_id
        self.trips: dict[str, dict[str, Any]] = {}
        self.charges: dict[str, dict[str, Any]] = {}
        self.dyno: dict[str, Any] = self._empty_dyno()
        self.curves: dict[str, dict[str, Any]] = {}
        self.routes: dict[str, dict[str, Any]] = {}
        self.declined: dict[str, Any] = {}
        self.snapshot: dict[str, Any] | None = None
        self.snapshot_received: str | None = None
        self.app_version: str | None = None
        self.post_format: Any = None
        # Times and counts only; never any payload.
        self._started = utc_now_text()
        self._last: dict[str, str] = {}
        self._posts: dict[str, int] = {}
        self._rejected = 0
        self._discarded_routes = 0
        self._last_error: str | None = None
        self._last_error_at: str | None = None
        self._snapshot_rows: dict[str, int] | None = None
        self._kinds: dict[str, Callable[[dict[str, Any], str], tuple]] = {
            "trips": self._post_rows,
            "charges": self._post_rows,
            "dyno": self._post_dyno,
            "charge_curve": self._post_curve,
            "route": self._post_route,
            "have": self._post_have,
        }

    @staticmethod
    def _empty_dyno() -> dict[str, Any]:
        """Return a dyno object with nothing in it."""
        dyno: dict[str, Any] = {name: None for name in DYNO_REPLACED}
        dyno["pulls"] = {}
        return dyno

    # ----- handling one post ------------------------------------------------

    def handle_raw(
        self,
        raw: bytes | None,
        now: str | None = None,
        loads: Callable[[Any], Any] | None = None,
    ) -> tuple[int, dict[str, Any], dict[str, Any]]:
        """Handle one POST body as received (bytes); see handle()."""
        now = now or utc_now_text()
        try:
            body = decode_body(raw, loads)
        except Refused as err:
            return self.refuse(err.status, err.text, now)
        return self.handle(body, now)

    def handle(
        self, body: Any, now: str | None = None
    ) -> tuple[int, dict[str, Any], dict[str, Any]]:
        """Handle one parsed post.

        Returns (http_status, reply, effects).  reply is the JSON for the
        car.  effects tells the glue what else to do; it may hold:

            "save"      tuple of set names to persist
            "snapshot"  True: a new snapshot is held (the sensors change)
            "route"     a route to write to disk; when the file is written
                        the glue calls commit_route(effects["route"]), and
                        only then is the route in the index
            "car_id"    the car_id this car sent for the first time (the
                        glue keeps it with the config entry)
            "version"   the app version, when it changed
        """
        now = now or utc_now_text()
        try:
            envelope = self._check_envelope(body)
            reply, effects = self._dispatch(body, now)
        except Refused as err:
            return self.refuse(err.status, err.text, now)
        self.apply_envelope(envelope)
        effects = {**effects, **envelope}
        return 200, reply, effects

    def refuse(
        self, status: int, text: str, now: str | None = None
    ) -> tuple[int, dict[str, Any], dict[str, Any]]:
        """Count a refused post and build its reply."""
        reply = error_reply(text)
        self._rejected += 1
        self._last_error = reply["error"]
        self._last_error_at = now or utc_now_text()
        return status, reply, {}

    def _note(self, kind: str, now: str) -> None:
        """Remember when a post of this kind was last accepted."""
        self._last[kind] = now
        self._posts[kind] = self._posts.get(kind, 0) + 1

    def _check_envelope(self, body: Any) -> dict[str, Any]:
        """Check the fields every post may carry; return effects for them.

        car_id: absent is fine (today's app).  Present, it must be a usable
        car_id, and once this car's car_id is known a different one is
        refused (HTTP 409), so two cars can never mix their data.
        version: remembered (the device shows it).  format: remembered.
        """
        if not isinstance(body, dict):
            raise Refused("body must be a JSON object")
        effects: dict[str, Any] = {}
        if body.get("car_id") is not None:
            car_id = check_car_id(body["car_id"])
            if self.car_id is None:
                effects["car_id"] = car_id
            elif car_id != self.car_id:
                raise Refused("this webhook belongs to another car", 409)
        version = body.get("version")
        if isinstance(version, (int, float)) and not isinstance(version, bool):
            version = str(version)
        if isinstance(version, str) and 0 < len(version) <= MAX_VERSION_LEN:
            if version != self.app_version:
                effects["version"] = version
        if "format" in body and (_is_number(body["format"]) or isinstance(body["format"], str)):
            self.post_format = body["format"]
        return effects

    def apply_envelope(self, effects: dict[str, Any]) -> None:
        """Take over the car_id and version of an accepted post (handle() does)."""
        if "car_id" in effects and self.car_id is None:
            self.car_id = effects["car_id"]
        if "version" in effects:
            self.app_version = effects["version"]

    def _dispatch(self, body: Any, now: str) -> tuple[dict[str, Any], dict[str, Any]]:
        """Send the post to the code for its kind."""
        if not isinstance(body, dict):
            raise Refused("body must be a JSON object")
        kind = body.get("kind")
        if kind is None or kind == "" or kind == "snapshot":
            return self._post_snapshot(body, now)
        handler = self._kinds.get(kind) if isinstance(kind, str) else None
        if handler is None:
            # The kind itself is payload, so it is not echoed.
            raise Refused("unknown kind")
        reply, effects = handler(body, now)
        if kind != "route":  # a route only counts once its file is written
            self._note(kind, now)
        return reply, effects

    # ----- snapshot -----------------------------------------------------------

    def trim_snapshot(self, body: Any, limit: int | None = None) -> dict[str, Any]:
        """Trim a snapshot to the size kept; see the module function."""
        return trim_snapshot(body, self.snapshot_limit if limit is None else limit)

    def _post_snapshot(self, body: dict[str, Any], now: str) -> tuple:
        """Keep the snapshot (trimmed to fit) for the sensors."""
        kept = self.trim_snapshot(body)
        self.snapshot = kept
        self.snapshot_received = now
        self._snapshot_rows = {
            name: len(kept[name]) for name in SNAPSHOT_LISTS if type(kept.get(name)) is list
        }
        self._note("snapshot", now)
        return {"ok": True, "kind": "snapshot"}, {"snapshot": True, "save": ("snapshot",)}

    # ----- trips and charges --------------------------------------------------

    def merge_rows(self, kind: str, rows: Any) -> tuple[int, int]:
        """Merge trip or charge rows by "start"; return (stored, skipped).

        A row with a key already held replaces the old row.  Nothing is ever
        deleted and unknown fields are kept as sent.  Rows that are not
        objects, or have no usable "start", are skipped.
        """
        if kind not in ("trips", "charges"):
            raise Refused("unknown kind")
        if type(rows) is not list:
            raise Refused("rows must be a list")
        if len(rows) > MAX_ROWS:
            raise Refused(f"too many rows in one post, the limit is {MAX_ROWS}")
        held = self.trips if kind == "trips" else self.charges
        stored = skipped = 0
        for row in rows:
            if isinstance(row, dict) and _key_ok(row.get("start")):
                held[row["start"]] = row
                stored += 1
            else:
                skipped += 1
        return stored, skipped

    def _post_rows(self, body: dict[str, Any], now: str) -> tuple:
        """Handle a "trips" or "charges" post."""
        kind = body["kind"]
        stored, skipped = self.merge_rows(kind, body.get("rows"))
        reply = {
            "ok": True,
            "kind": kind,
            "stored": stored,
            "skipped": skipped,
            "have": len(self.trips if kind == "trips" else self.charges),
        }
        return reply, ({"save": (kind,)} if stored else {})

    # ----- dyno ----------------------------------------------------------------

    def merge_dyno(self, body: dict[str, Any]) -> tuple[int, int]:
        """Take one dyno post; return (pulls stored, pulls skipped).

        envelope, regen_envelope, best and sag are replaced when the post
        carries them and left alone when it does not.  Pulls merge by "when".
        A pull is skipped when it has no usable "when" or its points are not
        a list of at most MAX_POINTS points of numbers / nulls.
        """
        pulls = body.get("pulls")
        if pulls is None:
            pulls = []
        if type(pulls) is not list:
            raise Refused("pulls must be a list")
        if len(pulls) > MAX_ROWS:
            raise Refused(f"too many pulls in one post, the limit is {MAX_ROWS}")
        for name in DYNO_REPLACED:
            if name in body:
                self.dyno[name] = body[name]
        held = self.dyno["pulls"]
        stored = skipped = 0
        for pull in pulls:
            if not isinstance(pull, dict) or not _key_ok(pull.get("when")):
                skipped += 1
                continue
            points = pull.get("points")
            if points is not None and _points_problem(points, MAX_POINTS):
                skipped += 1
                continue
            held[pull["when"]] = pull
            stored += 1
        return stored, skipped

    def _post_dyno(self, body: dict[str, Any], now: str) -> tuple:
        """Handle a "dyno" post."""
        stored, skipped = self.merge_dyno(body)
        reply = {
            "ok": True,
            "kind": "dyno",
            "stored": stored,
            "skipped": skipped,
            "have": len(self.dyno["pulls"]),
        }
        changed = stored or any(name in body for name in DYNO_REPLACED)
        return reply, ({"save": ("dyno",)} if changed else {})

    # ----- charge curves --------------------------------------------------------

    def set_curve(self, body: dict[str, Any]) -> tuple[str, int]:
        """Store one charge curve; return (key, number of points)."""
        key = body.get("charge_start")
        if not _key_ok(key):
            raise Refused("charge_start must be a non-empty text")
        points = body.get("points")
        problem = _points_problem(points, MAX_POINTS)
        if problem:
            raise Refused(f"charge curve refused: {problem}")
        sent_at = body.get("sent_at")
        received = sent_at if isinstance(sent_at, str) or _is_number(sent_at) else None
        self.curves[key] = {"points": points, "received": received}
        return key, len(points)

    def _post_curve(self, body: dict[str, Any], now: str) -> tuple:
        """Handle a "charge_curve" post."""
        _key, count = self.set_curve(body)
        reply = {
            "ok": True,
            "kind": "charge_curve",
            "stored": 1,
            "n": count,
            "have": len(self.curves),
        }
        return reply, {"save": ("curves",)}

    # ----- routes -----------------------------------------------------------------

    def check_route(self, body: dict[str, Any]) -> tuple[str, dict[str, Any]]:
        """Validate a route post; return (key, the record for its file).

        Raises Refused when anything is wrong, so a route is stored whole or
        not at all.  Changes nothing in the store.
        """
        key = body.get("trip_start")
        if not _key_ok(key):
            raise Refused("trip_start must be a non-empty text")
        points = body.get("points")
        if type(points) is not list:
            raise Refused("route points must be a list")
        if len(points) > MAX_ROUTE_POINTS:
            raise Refused(f"too many route points, the limit is {MAX_ROUTE_POINTS}")
        numbers = (int, float)
        for point in points:
            if type(point) is not list or len(point) != 2:
                raise Refused("a route point is not a [lat, lon] pair")
            lat, lon = point
            if type(lat) not in numbers or type(lon) not in numbers:
                raise Refused("a route point is not a pair of numbers")
            # NaN and infinity fail these comparisons as well.
            if not (-90 <= lat <= 90 and -180 <= lon <= 180):
                raise Refused("a route point is outside the valid lat/lon range")
        km = body.get("km")
        sent_at = body.get("sent_at")
        record = {
            "trip_start": key,
            "trip_end": _text_or_none(body.get("trip_end")),
            "km": km if _is_number(km) else None,
            "points": points,
            "received": sent_at if isinstance(sent_at, str) or _is_number(sent_at) else None,
        }
        return key, record

    def route_file_name(self, key: str) -> str:
        """Return the file name for a route key; see the module function."""
        return route_file_name(key)

    def _post_route(self, body: dict[str, Any], now: str) -> tuple:
        """Handle a "route" post: validate it and ask the glue to write it.

        With route storage off the route is thrown away unread (only its key,
        a trip start time, is remembered so "have routes" lists it and the
        car stops sending it) and the car still gets {"ok": true}.
        """
        if not self.store_routes:
            key = body.get("trip_start")
            if not _key_ok(key):
                raise Refused("trip_start must be a non-empty text")
            self.decline_route(key, now)
            self._discarded_routes += 1
            reply = {
                "ok": True,
                "kind": "route",
                "stored": 0,
                "discarded": 1,
                "store_routes": False,
                "have": len(self.routes),
            }
            return reply, {"save": ("declined",)}
        key, record = self.check_route(body)
        name = route_file_name(key)
        route = {
            "key": key,
            "file": name,
            "record": record,
            "entry": {
                "file": name,
                "km": record["km"],
                "n": len(record["points"]),
                "trip_end": record["trip_end"],
            },
            "now": now,
        }
        reply = {
            "ok": True,
            "kind": "route",
            "stored": 1,
            "n": len(record["points"]),
            "have": len(self.routes) + (0 if key in self.routes else 1),
        }
        return reply, {"route": route, "save": ("routes",)}

    def decline_route(self, key: str, now: str) -> None:
        """Remember a route key that was thrown away (oldest dropped first)."""
        self.declined[key] = now
        if len(self.declined) > MAX_DECLINED:
            for old in sorted(self.declined)[: len(self.declined) - MAX_DECLINED]:
                del self.declined[old]

    def commit_route(self, route: dict[str, Any]) -> None:
        """Put a route in the index, once its file is safely on disk."""
        self.routes[route["key"]] = dict(route["entry"])
        self._note("route", route.get("now") or utc_now_text())

    def forget_route(self, key: str) -> bool:
        """Drop a route from the index (its file is gone or unreadable).

        The car then no longer sees the key in "have routes" and sends the
        route again on its next pass.
        """
        return self.routes.pop(key, None) is not None

    def drop_all_routes(self, now: str | None = None) -> int:
        """Empty the route index; return how many routes it held.

        With route storage off the keys move to the declined list, so the
        car does not send those routes again.  With it on, the car sends the
        routes it still has again on its next pass.
        """
        count = len(self.routes)
        if not self.store_routes:
            stamp = now or utc_now_text()
            for key in self.routes:
                self.decline_route(key, stamp)
        self.routes = {}
        return count

    def set_store_routes(self, on: bool) -> bool:
        """Turn route storage on or off; return True when "declined" changed.

        Turning it on forgets the declined keys, so the car sends the routes
        it still has.
        """
        self.store_routes = on
        if on and self.declined:
            self.declined = {}
            return True
        return False

    def prune_routes(self, files_on_disk: set[str]) -> int:
        """Drop index entries whose file is not on disk; return how many."""
        gone = [key for key, entry in self.routes.items() if entry["file"] not in files_on_disk]
        for key in gone:
            del self.routes[key]
        return len(gone)

    def route_file(self, key: Any) -> str | None:
        """Return the file name of a stored route, or None if not held."""
        if not isinstance(key, str) or key not in self.routes:
            return None
        # Worked out from the key again; a stored name is never trusted.
        return route_file_name(key)

    # ----- have ---------------------------------------------------------------------

    def have(self, what: Any) -> list[str]:
        """Return the keys held for what, newest first.

        For routes the keys thrown away while route storage was off count as
        held, so the car does not send them again.
        """
        name = HAVE_SETS.get(what) if isinstance(what, str) else None
        if name is None:
            raise Refused("what must be trips, charges, charge_curves or routes")
        if name == "routes":
            return _newest_first(set(self.routes) | set(self.declined))
        return _newest_first(getattr(self, name))

    def _post_have(self, body: dict[str, Any], now: str) -> tuple:
        """Handle a "have" post."""
        what = body.get("what")
        keys = self.have(what)
        reply: dict[str, Any] = {"ok": True, "kind": "have", "what": what, "keys": keys}
        if what == "routes":
            reply["store_routes"] = self.store_routes
        return reply, {}

    # ----- views for the dashboard (websocket) -----------------------------------------

    def rows(self, kind: str) -> list[dict[str, Any]]:
        """Return the stored trips or charges, newest first."""
        held = self.trips if kind == "trips" else self.charges
        return [held[key] for key in _newest_first(held)]

    def rows_view(self, kind: str) -> dict[str, Any]:
        """Return the trips or charges for a page: {"rows", "source"}.

        The stored rows when there are any ("store"); otherwise the rows of
        the latest snapshot ("snapshot": a car that sends no detail posts
        still shows its latest 20), newest first as the car sent them.
        """
        rows = self.rows(kind)
        if rows:
            return {"rows": rows, "source": "store"}
        snap = self.snapshot.get(kind) if isinstance(self.snapshot, dict) else None
        if type(snap) is list:
            return {"rows": [row for row in snap if isinstance(row, dict)], "source": "snapshot"}
        return {"rows": [], "source": "store"}

    def snapshot_view(self) -> dict[str, Any]:
        """Return the latest snapshot and when it came: {"snapshot", "received"}."""
        return {"snapshot": self.snapshot, "received": self.snapshot_received}

    def dyno_view(self) -> dict[str, Any]:
        """Return the dyno object with its pulls as a list, newest first."""
        view = {name: self.dyno.get(name) for name in DYNO_REPLACED}
        pulls = self.dyno["pulls"]
        view["pulls"] = [pulls[key] for key in _newest_first(pulls)]
        return view

    def curve_view(self, key: Any) -> dict[str, Any] | None:
        """Return one charge curve, or None if it is not held."""
        curve = self.curves.get(key) if isinstance(key, str) else None
        if curve is None:
            return None
        return {
            "charge_start": key,
            "points": curve["points"],
            "received": curve.get("received"),
        }

    def curve_keys(self) -> list[str]:
        """Return the keys of the stored charge curves, newest first."""
        return _newest_first(self.curves)

    def route_list(self) -> list[dict[str, Any]]:
        """Return what is known about each stored route, newest first.

        Only times, distance and point count; never a coordinate.
        """
        return [
            {
                "trip_start": key,
                "trip_end": self.routes[key].get("trip_end"),
                "km": self.routes[key].get("km"),
                "n": self.routes[key].get("n"),
            }
            for key in _newest_first(self.routes)
        ]

    def counts(self) -> dict[str, int]:
        """Return how much of everything is held."""
        return {
            "trips": len(self.trips),
            "charges": len(self.charges),
            "dyno_pulls": len(self.dyno["pulls"]),
            "charge_curves": len(self.curves),
            "routes": len(self.routes),
        }

    def status(self) -> dict[str, Any]:
        """Return counts and last times (no payload data at all)."""
        kinds = ("snapshot", *self._kinds)
        return {
            "counts": self.counts(),
            "last": {kind: self._last.get(kind) for kind in kinds},
            "posts": {kind: self._posts.get(kind, 0) for kind in kinds},
            "snapshot_rows": self._snapshot_rows,
            "snapshot_received": self.snapshot_received,
            "app_version": self.app_version,
            "store_routes": self.store_routes,
            "routes_declined": len(self.declined),
            "routes_discarded": self._discarded_routes,
            "rejected": self._rejected,
            "last_error": self._last_error,
            "last_error_at": self._last_error_at,
            "started": self._started,
        }

    # ----- persistence ---------------------------------------------------------------------

    def dump(self, name: str) -> dict[str, Any]:
        """Return the data to persist for one set (the live dict, no copy)."""
        if name not in SETS:
            raise KeyError(name)
        if name == "snapshot":
            return {
                "body": self.snapshot,
                "received": self.snapshot_received,
                "version": self.app_version,
            }
        return getattr(self, name)

    def load(self, name: str, raw: Any) -> str | None:
        """Take over one set as read back from storage.

        Returns None when all is well, else a short text for a log warning
        (it never contains stored data).  Missing or wrongly shaped data
        means that set starts empty; single bad entries are dropped.
        """
        if name not in SETS:
            raise KeyError(name)
        if name == "snapshot":
            return self._load_snapshot(raw)
        empty = self._empty_dyno() if name == "dyno" else {}
        if raw is None:
            setattr(self, name, empty)
            return "nothing stored yet, starting empty"
        cleaned = self._clean(name, raw)
        if cleaned is None:
            setattr(self, name, empty)
            return "stored data is not the expected shape, starting empty"
        data, dropped = cleaned
        setattr(self, name, data)
        if dropped:
            return f"{dropped} stored entries were not the expected shape and were dropped"
        return None

    def _load_snapshot(self, raw: Any) -> str | None:
        """Take over the stored snapshot."""
        self.snapshot = None
        self.snapshot_received = None
        if raw is None:
            return "nothing stored yet, starting empty"
        if not isinstance(raw, dict) or not isinstance(raw.get("body"), (dict, type(None))):
            return "stored data is not the expected shape, starting empty"
        self.snapshot = raw.get("body")
        received = raw.get("received")
        self.snapshot_received = received if isinstance(received, str) else None
        version = raw.get("version")
        if isinstance(version, str) and 0 < len(version) <= MAX_VERSION_LEN:
            self.app_version = version
        return None

    @staticmethod
    def _clean(name: str, raw: Any) -> tuple[dict[str, Any], int] | None:
        """Check stored data; return (data, entries dropped) or None if unusable."""
        if not isinstance(raw, dict):
            return None

        def keep(source: dict, field: str | None, check=None) -> tuple[dict, int]:
            """Keep the entries of source that look right; count the others."""
            good: dict[str, Any] = {}
            for key, entry in source.items():
                if (
                    _key_ok(key)
                    and isinstance(entry, dict)
                    and (field is None or entry.get(field) == key)
                    and (check is None or check(key, entry))
                ):
                    good[key] = entry
            return good, len(source) - len(good)

        if name in ("trips", "charges"):
            return keep(raw, "start")
        if name == "dyno":
            pulls = raw.get("pulls")
            if not isinstance(pulls, dict):
                return None
            data: dict[str, Any] = {key: raw.get(key) for key in DYNO_REPLACED}
            data["pulls"], dropped = keep(pulls, "when")
            return data, dropped
        if name == "curves":
            return keep(raw, None, lambda key, entry: type(entry.get("points")) is list)
        if name == "declined":
            good = {key: value for key, value in raw.items() if _key_ok(key)}
            return good, len(raw) - len(good)
        # routes: the file name must be the one made from the key
        good, dropped = keep(
            raw, None, lambda key, entry: entry.get("file") == route_file_name(key)
        )
        index = {
            key: {
                "file": entry["file"],
                "km": entry.get("km"),
                "n": entry.get("n"),
                "trip_end": entry.get("trip_end"),
            }
            for key, entry in good.items()
        }
        return index, dropped

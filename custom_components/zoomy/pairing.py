"""Pairing a car by a 6-digit code (pure Python, no Home Assistant).

How it works (the car side is built later; this side is ready now):

1. The customer opens Settings > Devices & services > Add integration >
   Zoomy > "Pair a car".  While that step waits for a code, the integration
   listens on the fixed webhook "zoomy_pair" (local network only).
2. In the car, Zoomy finds Home Assistant by mDNS, makes its own webhook id
   and a 6-digit code, shows the code, and POSTs
   {"code": "123456", "car_id": "...", "webhook_id": "...", "name": "..."}
   to /api/webhook/zoomy_pair.  It is told {"ok": true, "status": "waiting"}.
3. The customer types the code in Home Assistant.  The code is matched,
   the config entry for that car is made, and from then on the car's own
   webhook answers its posts with JSON ("paired").

Guards: offers are taken only while an "Add Zoomy" step is waiting (and for
at most 10 minutes after it was last shown), an offer is kept for 10
minutes, at most MAX_OFFERS are held at once, each sender may make
PER_SENDER_LIMIT offers a minute and everyone together GLOBAL_LIMIT per 10
minutes, codes are compared in constant time, and when two different cars
offer the same code neither is taken (the customer starts again).  A
pairing reply never echoes the car's webhook id.
"""

from __future__ import annotations

from collections import deque
from collections.abc import Callable
from dataclasses import dataclass
import hmac
import re
import time
from typing import Any

CODE_TTL = 600.0  # seconds an offered code (and a waiting step) stays good
MAX_OFFERS = 10  # offers held at once
PER_SENDER_LIMIT = 5  # offers per sender per minute
GLOBAL_LIMIT = 30  # offers from everyone per 10 minutes
MAX_BODY_BYTES = 4096  # a pairing post is tiny
MAX_NAME_LEN = 40

CODE_RE = re.compile(r"[0-9]{6}")
# The car's own webhook id: URL-safe, long enough to be a secret.
WEBHOOK_ID_RE = re.compile(r"[A-Za-z0-9_-]{16,128}")
CAR_ID_RE = re.compile(r"[\x21-\x7e]{1,128}")
_CONTROL_RE = re.compile(r"[\x00-\x1f\x7f]")


class PairingError(Exception):
    """A pairing post that is refused; the text is safe to show the car."""

    def __init__(self, text: str, status: int = 400) -> None:
        """Remember the HTTP status and the (payload free) text."""
        super().__init__(text)
        self.text = text
        self.status = status


class CodeClash(Exception):
    """Two different cars offered the code that was typed."""


@dataclass(frozen=True, slots=True)
class Offer:
    """One car waiting to be paired."""

    code: str
    car_id: str
    webhook_id: str
    name: str | None
    version: str | None
    expires: float


def normalise_code(value: Any) -> str | None:
    """Return the 6-digit code typed by a person, or None if it is not one.

    Spaces and dashes are ignored ("123 456", "123-456").
    """
    if isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= 999999:
        return f"{value:06d}"
    if not isinstance(value, str):
        return None
    cleaned = value.replace(" ", "").replace("-", "").strip()
    return cleaned if CODE_RE.fullmatch(cleaned) else None


def clean_name(value: Any) -> str | None:
    """Return a car name fit for a title, or None."""
    if not isinstance(value, str):
        return None
    name = " ".join(_CONTROL_RE.sub(" ", value).split())[:MAX_NAME_LEN]
    return name or None


def parse_offer(body: Any, expires: float) -> Offer:
    """Check a pairing post and return its Offer, or raise PairingError."""
    if not isinstance(body, dict):
        raise PairingError("body must be a JSON object")
    code = body.get("code")
    # The car sends the code as text; a number keeps no leading zeros.
    if not isinstance(code, str) or CODE_RE.fullmatch(code) is None:
        raise PairingError("code must be 6 digits, sent as text")
    car_id = body.get("car_id")
    if not isinstance(car_id, str) or CAR_ID_RE.fullmatch(car_id) is None:
        raise PairingError("car_id must be 1 to 128 letters, digits or signs")
    webhook_id = body.get("webhook_id")
    if not isinstance(webhook_id, str) or WEBHOOK_ID_RE.fullmatch(webhook_id) is None:
        raise PairingError("webhook_id must be 16 to 128 letters, digits, - or _")
    version = body.get("version")
    return Offer(
        code=code,
        car_id=car_id,
        webhook_id=webhook_id,
        name=clean_name(body.get("name")),
        version=version[:40] if isinstance(version, str) and version else None,
        expires=expires,
    )


class PairingBook:
    """The flows waiting for a code, the offers made, and the rate limits."""

    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        """Start with nothing waiting."""
        self._clock = clock
        self._waiting: dict[str, float] = {}  # flow id -> until when
        self._offers: dict[str, Offer] = {}  # car_id -> offer
        self._by_sender: dict[str, deque[float]] = {}
        self._recent: deque[float] = deque()

    # ----- the flows ------------------------------------------------------

    def flow_waiting(self, flow_id: str) -> None:
        """A flow shows the code form (again): offers are taken for 10 minutes."""
        self._waiting[flow_id] = self._clock() + CODE_TTL

    def flow_done(self, flow_id: str) -> None:
        """A flow ended (paired, aborted or closed)."""
        self._waiting.pop(flow_id, None)
        if not self._waiting:
            # Nobody is waiting any more: no offer may be claimed later.
            self._offers.clear()

    def is_waiting(self) -> bool:
        """Tell if any flow is waiting for a code right now."""
        now = self._clock()
        for flow_id, until in list(self._waiting.items()):
            if until <= now:
                del self._waiting[flow_id]
        return bool(self._waiting)

    def waiting_until(self) -> float | None:
        """Return when the last waiting flow stops waiting (clock time)."""
        return max(self._waiting.values(), default=None)

    # ----- the car's post ---------------------------------------------------

    def _purge(self, now: float) -> None:
        """Drop offers that have expired."""
        for car_id, offer in list(self._offers.items()):
            if offer.expires <= now:
                del self._offers[car_id]

    def _rate_ok(self, sender: str, now: float) -> bool:
        """Count one post from sender; tell if it is within the limits."""
        while self._recent and self._recent[0] <= now - CODE_TTL:
            self._recent.popleft()
        times = self._by_sender.setdefault(sender, deque())
        while times and times[0] <= now - 60:
            times.popleft()
        for key in [key for key, value in self._by_sender.items() if not value and key != sender]:
            del self._by_sender[key]
        if len(times) >= PER_SENDER_LIMIT or len(self._recent) >= GLOBAL_LIMIT:
            return False
        times.append(now)
        self._recent.append(now)
        return True

    def offer(self, body: Any, sender: str | None) -> tuple[int, dict[str, Any]]:
        """Handle one pairing post; return (http status, JSON reply)."""
        now = self._clock()
        if not self.is_waiting():
            return 409, _error("Home Assistant is not waiting for a car. Open Add integration > Zoomy first.")
        if not self._rate_ok(sender or "unknown", now):
            return 429, _error("too many pairing posts, wait a minute")
        try:
            offer = parse_offer(body, now + CODE_TTL)
        except PairingError as err:
            return err.status, _error(err.text)
        self._purge(now)
        if offer.car_id not in self._offers and len(self._offers) >= MAX_OFFERS:
            return 429, _error("too many cars are pairing, try again in a few minutes")
        # A car that starts again (a new code) replaces its own offer.
        self._offers[offer.car_id] = offer
        return 200, {
            "ok": True,
            "kind": "pair",
            "status": "waiting",
            "expires_in": int(CODE_TTL),
        }

    # ----- the code typed in Home Assistant ------------------------------------

    def claim(self, code: str) -> Offer | None:
        """Take the offer with this code; None when there is none.

        Raises CodeClash when two different cars offered this code (both
        offers are dropped).  Every held code is compared, in constant time.
        """
        self._purge(self._clock())
        matches = [
            offer
            for offer in list(self._offers.values())
            if hmac.compare_digest(offer.code.encode(), code.encode())
        ]
        if not matches:
            return None
        for offer in matches:
            del self._offers[offer.car_id]
        if len(matches) > 1:
            raise CodeClash
        return matches[0]

    def offers_held(self) -> int:
        """Return how many offers are held (for tests and diagnostics)."""
        self._purge(self._clock())
        return len(self._offers)


def _error(text: str) -> dict[str, Any]:
    """Build a refusal for the car (under 120 characters)."""
    return {"ok": False, "error": text[:119]}

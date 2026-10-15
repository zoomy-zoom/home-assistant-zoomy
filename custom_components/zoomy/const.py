"""Constants for the Zoomy integration."""

from __future__ import annotations

from typing import Final

DOMAIN: Final = "zoomy"
MANUFACTURER: Final = "Zoomy"
MODEL: Final = "Zoomy app"
DEFAULT_CAR_NAME: Final = "Zoomy car"

# Config entry data / options
CONF_WEBHOOK_ID: Final = "webhook_id"  # the car's webhook id (a secret)
CONF_CAR_ID: Final = "car_id"  # sent by paired cars (and later app versions)
CONF_CAR_NAME: Final = "car_name"
CONF_STORE_ROUTES: Final = "store_routes"
CONF_DELETE_ROUTES: Final = "delete_routes"  # one-shot option, never stored
DEFAULT_STORE_ROUTES: Final = True

# Pairing (see pairing.py)
PAIR_WEBHOOK_ID: Final = "zoomy_pair"
MAX_CODE_TRIES: Final = 5  # wrong codes typed in one "Pair a car" step

# Webhook ids pasted for the "already sending" path: URL-safe characters.
MIN_WEBHOOK_ID_LEN: Final = 8
MAX_WEBHOOK_ID_LEN: Final = 200

# Storage
STORAGE_VERSION: Final = 1
SAVE_DELAY: Final = 5  # seconds between a change and the write to .storage
READ_CHUNK: Final = 65536  # the POST body is read in pieces of this size

# hass.data keys (plain strings so the pure tests need no Home Assistant)
DATA_PAIRING: Final = f"{DOMAIN}_pairing"
DATA_FRONTEND: Final = f"{DOMAIN}_frontend"
DATA_DASHBOARD_LOCK: Final = f"{DOMAIN}_dashboard_lock"

# Signal sent (with the entry id) after a post changed something
SIGNAL_CHANGED: Final = f"{DOMAIN}_changed_{{}}"

# ---------------------------------------------------------------------------
# Frontend (the next agent fills custom_components/zoomy/frontend/)
# ---------------------------------------------------------------------------
# Every file under frontend/ is served at /zoomy_static/<version>/<file>, so a
# new integration version always gets fresh files (long browser caching is
# safe).  FRONTEND_ENTRY is loaded as a module on every Home Assistant page
# (frontend.add_extra_js_url): it must define the dashboard strategy element
# "ll-strategy-dashboard-zoomy" and the cards, and may add an entry to
# window.customStrategies so "Zoomy" shows in the Add dashboard dialog.
STATIC_URL_BASE: Final = "/zoomy_static"
FRONTEND_DIR: Final = "frontend"
FRONTEND_ENTRY: Final = "zoomy.js"

# The dashboard the integration adds once: a storage dashboard whose whole
# config is {"strategy": {"type": "custom:zoomy"}} (see dashboard.py).
DASHBOARD_URL_PATH: Final = "zoomy"
DASHBOARD_TITLE: Final = "ZOOMY"
DASHBOARD_ICON: Final = "mdi:car-electric"
STRATEGY_TYPE: Final = "custom:zoomy"
DASHBOARD_CONFIG: Final = {"strategy": {"type": STRATEGY_TYPE}}
ISSUE_DASHBOARD: Final = "add_dashboard"

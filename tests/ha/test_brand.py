"""Home Assistant serves the integration's own icon (custom_components/zoomy/brand/).

Home Assistant 2026.9 and later answer /api/brands/integration/<domain>/<image>
from a custom integration's "brand" folder before asking the brands CDN
(homeassistant/components/brands/__init__.py, _serve_from_custom_integration).
The other images fall back to icon.png (brands/const.py IMAGE_FALLBACKS).
"""

from __future__ import annotations

import os

from custom_components.zoomy.const import DOMAIN
from homeassistant.core import HomeAssistant
from homeassistant.setup import async_setup_component

BRAND = os.path.join(os.path.dirname(__file__), "..", "..", "custom_components", DOMAIN, "brand")


def brand_file(name: str) -> bytes:
    with open(os.path.join(BRAND, name), "rb") as handle:
        return handle.read()


async def test_home_assistant_serves_the_zoomy_icon(hass: HomeAssistant, hass_client) -> None:
    assert await async_setup_component(hass, "http", {})
    assert await async_setup_component(hass, "brands", {})
    client = await hass_client()  # signed in, as the frontend is

    for image, source in (
        ("icon.png", "icon.png"),
        ("icon@2x.png", "icon@2x.png"),
        ("logo.png", "icon.png"),  # no logo: Home Assistant falls back to the icon
        ("dark_icon.png", "icon.png"),
    ):
        resp = await client.get(f"/api/brands/integration/{DOMAIN}/{image}")
        assert resp.status == 200, image
        assert resp.headers["Content-Type"] == "image/png"
        assert await resp.read() == brand_file(source), image


async def test_brand_images_need_a_signed_in_user(hass: HomeAssistant, hass_client_no_auth) -> None:
    assert await async_setup_component(hass, "http", {})
    assert await async_setup_component(hass, "brands", {})
    client = await hass_client_no_auth()
    resp = await client.get(f"/api/brands/integration/{DOMAIN}/icon.png")
    assert resp.status in (401, 403)

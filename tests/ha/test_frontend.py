"""The frontend hook (static files, module URL) and the ZOOMY dashboard."""

from __future__ import annotations

import os
from unittest.mock import patch

import pytest

from custom_components.zoomy import dashboard, frontend
from custom_components.zoomy.const import (
    DASHBOARD_CONFIG,
    DASHBOARD_URL_PATH,
    DATA_FRONTEND,
    DOMAIN,
    ISSUE_DASHBOARD,
)
from homeassistant.components.frontend import DATA_EXTRA_MODULE_URL, async_panel_exists
from homeassistant.core import HomeAssistant
from homeassistant.helpers import issue_registry as ir

from .conftest import OTHER_WEBHOOK_ID


@pytest.fixture
def frontend_files(tmp_path):
    """A stand-in frontend folder with an entry module."""
    folder = tmp_path / "frontend"
    folder.mkdir()
    (folder / "zoomy.js").write_text("customElements.define('ll-strategy-dashboard-zoomy', class {});\n")
    (folder / "charts.html").write_text("<!doctype html><title>t</title>\n")
    with patch.object(frontend, "FRONTEND_PATH", str(folder)):
        yield folder


async def test_no_frontend_files_registers_nothing(hass: HomeAssistant, setup_car) -> None:
    with patch.object(frontend, "FRONTEND_PATH", os.path.join(os.path.dirname(frontend.__file__), "no-such-folder")):
        await setup_car()
    assert hass.data[DATA_FRONTEND] == {}
    assert not [url for url in hass.data[DATA_EXTRA_MODULE_URL].urls if "zoomy" in url]


async def test_frontend_files_are_served_by_version(
    hass: HomeAssistant, setup_car, frontend_files, hass_client_no_auth
) -> None:
    await setup_car()
    info = hass.data[DATA_FRONTEND]
    assert info["base_url"] == f"/zoomy_static/{info['version']}"
    assert info["entry_url"] in hass.data[DATA_EXTRA_MODULE_URL].urls
    client = await hass_client_no_auth()
    resp = await client.get(info["entry_url"])
    assert resp.status == 200
    assert "ll-strategy-dashboard-zoomy" in await resp.text()
    assert "max-age" in resp.headers.get("Cache-Control", "")
    resp = await client.get(f"{info['base_url']}/charts.html")
    assert resp.status == 200
    resp = await client.get(f"{info['base_url']}/../manifest.json")
    assert resp.status in (403, 404)


async def test_dashboard_is_added_once(hass: HomeAssistant, setup_car, hass_ws_client) -> None:
    await setup_car()
    await hass.async_block_till_done()
    assert async_panel_exists(hass, DASHBOARD_URL_PATH)
    ws = await hass_ws_client(hass)
    await ws.send_json_auto_id({"type": "lovelace/config", "url_path": DASHBOARD_URL_PATH})
    reply = await ws.receive_json()
    assert reply["result"] == DASHBOARD_CONFIG
    await ws.send_json_auto_id({"type": "lovelace/dashboards/list"})
    reply = await ws.receive_json()
    (item,) = [d for d in reply["result"] if d["url_path"] == DASHBOARD_URL_PATH]
    assert item["title"] == "ZOOMY" and item["require_admin"] is False and item["show_in_sidebar"] is True

    # the customer deletes it: a second car does not bring it back
    await ws.send_json_auto_id({"type": "lovelace/dashboards/delete", "dashboard_id": item["id"]})
    assert (await ws.receive_json())["success"]
    await setup_car(webhook_id=OTHER_WEBHOOK_ID, title="Second car")
    await hass.async_block_till_done()
    assert not async_panel_exists(hass, DASHBOARD_URL_PATH)
    assert await dashboard.async_ensure_dashboard(hass) == "already"


async def test_dashboard_removed_with_the_last_car(hass: HomeAssistant, setup_car) -> None:
    first = await setup_car()
    second = await setup_car(webhook_id=OTHER_WEBHOOK_ID, title="Second car")
    await hass.async_block_till_done()
    await hass.config_entries.async_remove(first.entry_id)
    await hass.async_block_till_done()
    assert async_panel_exists(hass, DASHBOARD_URL_PATH)  # one car is left
    await hass.config_entries.async_remove(second.entry_id)
    await hass.async_block_till_done()
    assert not async_panel_exists(hass, DASHBOARD_URL_PATH)


async def test_edited_dashboard_is_kept(hass: HomeAssistant, setup_car, hass_ws_client) -> None:
    entry = await setup_car()
    await hass.async_block_till_done()
    ws = await hass_ws_client(hass)
    await ws.send_json_auto_id(
        {"type": "lovelace/config/save", "url_path": DASHBOARD_URL_PATH, "config": {"views": [{"title": "Mine"}]}}
    )
    assert (await ws.receive_json())["success"]
    await hass.config_entries.async_remove(entry.entry_id)
    await hass.async_block_till_done()
    assert async_panel_exists(hass, DASHBOARD_URL_PATH)


async def test_url_already_taken(hass: HomeAssistant, setup_car, hass_ws_client) -> None:
    from homeassistant.setup import async_setup_component

    assert await async_setup_component(hass, "lovelace", {})
    ws = await hass_ws_client(hass)
    await ws.send_json_auto_id(
        {"type": "lovelace/dashboards/create", "url_path": DASHBOARD_URL_PATH, "title": "Mine", "allow_single_word": True}
    )
    assert (await ws.receive_json())["success"]
    await setup_car()
    await hass.async_block_till_done()
    await ws.send_json_auto_id({"type": "lovelace/dashboards/list"})
    reply = await ws.receive_json()
    assert [d["title"] for d in reply["result"] if d["url_path"] == DASHBOARD_URL_PATH] == ["Mine"]


async def test_falls_back_to_a_repair_issue(hass: HomeAssistant, setup_car) -> None:
    with patch.object(dashboard, "find_dashboards_collection", return_value=None):
        await setup_car()
        await hass.async_block_till_done()
    assert not async_panel_exists(hass, DASHBOARD_URL_PATH)
    issue = ir.async_get(hass).async_get_issue(DOMAIN, ISSUE_DASHBOARD)
    assert issue is not None and issue.translation_key == ISSUE_DASHBOARD
    # next start it works: the issue goes away
    assert await dashboard.async_ensure_dashboard(hass) == "added"
    assert ir.async_get(hass).async_get_issue(DOMAIN, ISSUE_DASHBOARD) is None

"""The zoomy/... websocket commands the pages use."""

from __future__ import annotations

from homeassistant.core import HomeAssistant

from .conftest import OTHER_WEBHOOK_ID, car_post, route_points, snapshot


async def fill(post) -> None:
    await post(snapshot())
    await post(car_post("trips", rows=[{"start": "2030-01-01T08:00", "km": 3}, {"start": "2030-01-02T08:00", "km": 4}]))
    await post(car_post("charges", rows=[{"start": "2030-01-01T22:00", "kwh_added": 10}]))
    await post(car_post("dyno", envelope=[[20, 60]], best={"kw": 150, "kmh": 70},
                        pulls=[{"when": "2030-01-01T10:00", "points": [[20, 60]]}]))
    await post(car_post("charge_curve", charge_start="2030-01-01T22:00", points=[[0, 30, 7.0], [10, 40, 7.1]]))
    await post(car_post("route", trip_start="2030-01-02T08:00", trip_end="2030-01-02T08:20", km=4, points=route_points(4)))


async def test_all_reads(hass: HomeAssistant, setup_car, post, hass_ws_client) -> None:
    entry = await setup_car()
    await fill(post)
    ws = await hass_ws_client(hass)

    async def ask(msg):
        await ws.send_json_auto_id(msg)
        return await ws.receive_json()

    reply = await ask({"type": "zoomy/cars"})
    assert reply["success"]
    (car,) = reply["result"]["cars"]
    assert car["entry_id"] == entry.entry_id
    assert car["title"] == "Test car"
    assert car["app_version"] == "4.18.20"
    assert car["counts"] == {"trips": 2, "charges": 1, "dyno_pulls": 1, "charge_curves": 1, "routes": 1, "runs": 0}
    assert car["entities"]["last_trip_distance"] == "sensor.zoomy_test_car_last_trip_distance"
    assert len(car["entities"]) == 40
    assert "webhook" not in str(reply).lower()  # the webhook id is never served

    reply = await ask({"type": "zoomy/status"})
    assert reply["result"]["counts"]["trips"] == 2
    assert reply["result"]["posts"]["route"] == 1

    reply = await ask({"type": "zoomy/snapshot"})
    assert reply["result"]["snapshot"]["runs"] == [{"when": "2030-01-01T10:00:00", "s_0_100": 3.9}]
    assert reply["result"]["received"]

    reply = await ask({"type": "zoomy/trips"})
    assert reply["result"]["source"] == "store"
    assert [row["start"] for row in reply["result"]["rows"]] == ["2030-01-02T08:00", "2030-01-01T08:00"]

    reply = await ask({"type": "zoomy/charges", "entry_id": entry.entry_id})
    assert reply["result"]["rows"] == [{"start": "2030-01-01T22:00", "kwh_added": 10}]

    reply = await ask({"type": "zoomy/dyno"})
    assert reply["result"]["best"] == {"kw": 150, "kmh": 70}
    assert reply["result"]["pulls"][0]["when"] == "2030-01-01T10:00"

    reply = await ask({"type": "zoomy/curve_keys"})
    assert reply["result"] == {"keys": ["2030-01-01T22:00"]}
    reply = await ask({"type": "zoomy/charge_curve", "charge_start": "2030-01-01T22:00"})
    assert reply["result"]["points"] == [[0, 30, 7.0], [10, 40, 7.1]]
    reply = await ask({"type": "zoomy/charge_curve", "charge_start": "nope"})
    assert not reply["success"] and reply["error"]["code"] == "not_found"

    reply = await ask({"type": "zoomy/route_keys"})
    assert reply["result"] == {
        "routes": [{"trip_start": "2030-01-02T08:00", "trip_end": "2030-01-02T08:20", "km": 4, "n": 4}],
        "store_routes": True,
    }
    reply = await ask({"type": "zoomy/route", "trip_start": "2030-01-02T08:00"})
    assert reply["result"]["points"] == route_points(4)
    reply = await ask({"type": "zoomy/route", "trip_start": "2030-01-09T08:00"})
    assert reply["error"]["code"] == "not_found"

    reply = await ask({"type": "zoomy/trips", "entry_id": "no-such-entry"})
    assert reply["error"]["code"] == "not_found"


async def test_snapshot_rows_until_details_arrive(hass: HomeAssistant, setup_car, post, hass_ws_client) -> None:
    await setup_car()
    await post(snapshot())
    ws = await hass_ws_client(hass)
    await ws.send_json_auto_id({"type": "zoomy/trips"})
    reply = await ws.receive_json()
    assert reply["result"] == {"rows": [{"start": "2030-01-02T07:00:00", "km": 31.4}], "source": "snapshot"}


async def test_two_cars_need_entry_id(hass: HomeAssistant, setup_car, post, hass_ws_client) -> None:
    await setup_car()
    second = await setup_car(webhook_id=OTHER_WEBHOOK_ID, title="Second car")
    await post(car_post("trips", rows=[{"start": "2030-02-01T08:00"}]), OTHER_WEBHOOK_ID)
    ws = await hass_ws_client(hass)
    await ws.send_json_auto_id({"type": "zoomy/trips"})
    reply = await ws.receive_json()
    assert reply["error"]["code"] == "invalid_format"
    await ws.send_json_auto_id({"type": "zoomy/trips", "entry_id": second.entry_id})
    reply = await ws.receive_json()
    assert [row["start"] for row in reply["result"]["rows"]] == ["2030-02-01T08:00"]
    await ws.send_json_auto_id({"type": "zoomy/cars"})
    reply = await ws.receive_json()
    assert len(reply["result"]["cars"]) == 2


async def test_no_car_yet(hass: HomeAssistant, setup_car, hass_ws_client) -> None:
    entry = await setup_car()
    await hass.config_entries.async_unload(entry.entry_id)
    ws = await hass_ws_client(hass)
    await ws.send_json_auto_id({"type": "zoomy/status"})
    reply = await ws.receive_json()
    assert reply["error"]["code"] == "not_found"
    await ws.send_json_auto_id({"type": "zoomy/cars"})
    assert (await ws.receive_json())["result"] == {"cars": []}


async def test_subscribe(hass: HomeAssistant, setup_car, post, hass_ws_client) -> None:
    entry = await setup_car()
    ws = await hass_ws_client(hass)
    await ws.send_json_auto_id({"type": "zoomy/subscribe"})
    reply = await ws.receive_json()
    assert reply["success"]
    await post(car_post("trips", rows=[{"start": "2030-01-01T08:00"}]))
    event = await ws.receive_json()
    assert event["type"] == "event"
    assert event["event"] == {
        "entry_id": entry.entry_id,
        "changed": ["trips", "version"],  # the first post also told the app version
        "counts": {"trips": 1, "charges": 0, "dyno_pulls": 0, "charge_curves": 0, "routes": 0, "runs": 0},
    }
    # an empty "have" changes nothing: no event; the next change does send one
    await post(car_post("have", what="trips"))
    await post(snapshot())
    event = await ws.receive_json()
    assert event["event"]["changed"] == ["snapshot"]


async def test_read_only_user_may_read(hass: HomeAssistant, setup_car, post, hass_ws_client, hass_read_only_access_token) -> None:
    await setup_car()
    await post(car_post("route", trip_start="2030-01-02T08:00", points=route_points(2)))
    ws = await hass_ws_client(hass, hass_read_only_access_token)
    await ws.send_json_auto_id({"type": "zoomy/route", "trip_start": "2030-01-02T08:00"})
    reply = await ws.receive_json()
    assert reply["success"] and reply["result"]["points"] == route_points(2)


async def test_user_without_access_to_the_car_reads_nothing(
    hass: HomeAssistant, setup_car, post, hass_ws_client, hass_read_only_user, hass_read_only_access_token
) -> None:
    """A user whose permissions do not cover the car's sensors gets no data, routes least of all."""
    await setup_car()
    await post(car_post("route", trip_start="2030-01-02T08:00", points=route_points(2)))
    hass_read_only_user.mock_policy({"entities": {"entity_ids": {"light.kitchen": True}}})
    ws = await hass_ws_client(hass, hass_read_only_access_token)
    await ws.send_json_auto_id({"type": "zoomy/cars"})
    reply = await ws.receive_json()
    assert reply["success"] and reply["result"]["cars"] == []
    for msg in ({"type": "zoomy/route", "trip_start": "2030-01-02T08:00"}, {"type": "zoomy/route_keys"},
                {"type": "zoomy/trips"}, {"type": "zoomy/runs"}, {"type": "zoomy/subscribe"}):
        await ws.send_json_auto_id(msg)
        reply = await ws.receive_json()
        assert not reply["success"] and reply["error"]["code"] == "unauthorized", msg

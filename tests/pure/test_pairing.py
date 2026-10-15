"""Tests for custom_components/zoomy/pairing.py (no Home Assistant)."""

import unittest

from tests.pure.test_summary import load

pairing = load("pairing")

GOOD_ID = "abcdefghijklmnopqrstuvwxyzABCDEF0123456789_-"


def body(code="123456", car_id="car-1", webhook_id=GOOD_ID, **extra):
    data = {"code": code, "car_id": car_id, "webhook_id": webhook_id}
    data.update(extra)
    return data


class Clock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


class Base(unittest.TestCase):
    def setUp(self):
        self.clock = Clock()
        self.book = pairing.PairingBook(self.clock)


class TestOffers(Base):
    def test_refused_while_nobody_waits(self):
        status, reply = self.book.offer(body(), "192.0.2.10")
        self.assertEqual(status, 409)
        self.assertIs(reply["ok"], False)
        self.assertLess(len(reply["error"]), 120)

    def test_offer_then_claim(self):
        self.book.flow_waiting("flow1")
        status, reply = self.book.offer(body(name="  MG4 \n Long Range  ", version="4.19.0"), "192.0.2.10")
        self.assertEqual(status, 200)
        self.assertEqual(reply, {"ok": True, "kind": "pair", "status": "waiting", "expires_in": 600})
        self.assertNotIn(GOOD_ID, str(reply))  # never echoed
        self.assertIsNone(self.book.claim("654321"))
        offer = self.book.claim("123456")
        self.assertEqual((offer.car_id, offer.webhook_id, offer.name, offer.version),
                         ("car-1", GOOD_ID, "MG4 Long Range", "4.19.0"))
        self.assertIsNone(self.book.claim("123456"))  # used up

    def test_offers_expire(self):
        self.book.flow_waiting("flow1")
        self.book.offer(body(), "192.0.2.10")
        self.clock.now += pairing.CODE_TTL - 1
        self.book.flow_waiting("flow1")  # the step is shown again
        self.assertEqual(self.book.offers_held(), 1)
        self.clock.now += 2
        self.assertIsNone(self.book.claim("123456"))

    def test_waiting_step_times_out(self):
        self.book.flow_waiting("flow1")
        self.assertTrue(self.book.is_waiting())
        self.clock.now += pairing.CODE_TTL + 1
        self.assertFalse(self.book.is_waiting())
        self.assertEqual(self.book.offer(body(), "192.0.2.10")[0], 409)

    def test_flow_done_drops_offers(self):
        self.book.flow_waiting("flow1")
        self.book.flow_waiting("flow2")
        self.book.offer(body(), "192.0.2.10")
        self.book.flow_done("flow1")
        self.assertEqual(self.book.offers_held(), 1)  # flow2 still waits
        self.book.flow_done("flow2")
        self.assertEqual(self.book.offers_held(), 0)
        self.assertFalse(self.book.is_waiting())

    def test_same_car_new_code_replaces(self):
        self.book.flow_waiting("flow1")
        self.book.offer(body(code="111111"), "192.0.2.10")
        self.book.offer(body(code="222222"), "192.0.2.10")
        self.assertIsNone(self.book.claim("111111"))
        self.assertEqual(self.book.claim("222222").car_id, "car-1")

    def test_two_cars_same_code_is_a_clash(self):
        self.book.flow_waiting("flow1")
        self.book.offer(body(car_id="car-1"), "192.0.2.10")
        self.book.offer(body(car_id="car-2", webhook_id=GOOD_ID[::-1]), "192.0.2.11")
        with self.assertRaises(pairing.CodeClash):
            self.book.claim("123456")
        self.assertEqual(self.book.offers_held(), 0)

    def test_bad_bodies(self):
        self.book.flow_waiting("flow1")
        bad = [
            None, [], "x",
            body(code=123456), body(code="12345"), body(code="1234567"), body(code="12a456"), body(code=None),
            body(car_id=""), body(car_id="has space"), body(car_id="x" * 129), body(car_id=5),
            body(webhook_id="short"), body(webhook_id="has/slash" + "x" * 20), body(webhook_id="x" * 129),
            body(webhook_id=None),
        ]
        for item in bad:
            self.book.flow_waiting("flow1")  # the step is still on screen
            status, reply = self.book.offer(item, f"192.0.2.{len(str(item)) % 200}")
            self.assertEqual(status, 400, item)
            self.assertNotIn(GOOD_ID, reply["error"])
            # spread the posts over time so the rate limit does not kick in
            self.clock.now += 61

    def test_rate_limits(self):
        self.book.flow_waiting("flow1")
        for i in range(pairing.PER_SENDER_LIMIT):
            self.assertEqual(self.book.offer(body(car_id=f"c{i}", code=f"{i:06d}"), "192.0.2.10")[0], 200)
        self.assertEqual(self.book.offer(body(car_id="c9"), "192.0.2.10")[0], 429)
        self.assertEqual(self.book.offer(body(car_id="c9"), "192.0.2.99")[0], 200)  # another sender
        self.clock.now += 61
        self.assertEqual(self.book.offer(body(car_id="c8", code="888888"), "192.0.2.10")[0], 200)

    def test_global_limit(self):
        self.book.flow_waiting("flow1")
        ok = 0
        for i in range(pairing.GLOBAL_LIMIT + 5):
            status, _ = self.book.offer(body(car_id="same"), f"192.0.2.{i}")
            ok += status == 200
        self.assertEqual(ok, pairing.GLOBAL_LIMIT)

    def test_max_offers(self):
        self.book.flow_waiting("flow1")
        for i in range(pairing.MAX_OFFERS):
            self.assertEqual(self.book.offer(body(car_id=f"c{i}", code=f"{i:06d}"), f"192.0.2.{i}")[0], 200)
        status, reply = self.book.offer(body(car_id="one-more"), "192.0.2.200")
        self.assertEqual(status, 429)
        # a car already holding an offer may still replace it
        self.assertEqual(self.book.offer(body(car_id="c1", code="999999"), "192.0.2.201")[0], 200)


class TestHelpers(unittest.TestCase):
    def test_normalise_code(self):
        self.assertEqual(pairing.normalise_code(" 123 456 "), "123456")
        self.assertEqual(pairing.normalise_code("123-456"), "123456")
        self.assertEqual(pairing.normalise_code(42), "000042")
        for bad in ("12345", "abcdef", None, True, -1, 1000000, "1234567"):
            self.assertIsNone(pairing.normalise_code(bad))

    def test_clean_name(self):
        self.assertEqual(pairing.clean_name(" My\tcar\x00 "), "My car")
        self.assertEqual(len(pairing.clean_name("x" * 100)), pairing.MAX_NAME_LEN)
        self.assertIsNone(pairing.clean_name("   "))
        self.assertIsNone(pairing.clean_name(5))


if __name__ == "__main__":
    unittest.main()

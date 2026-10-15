"""Every text the flows can show has an English string; the JSON files are valid."""

import json
import os
import re
import unittest

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
PKG = os.path.join(ROOT, "custom_components", "zoomy")


def read(*parts):
    with open(os.path.join(*parts), encoding="utf-8") as handle:
        return handle.read()


class TestStrings(unittest.TestCase):
    def setUp(self):
        self.strings = json.loads(read(PKG, "strings.json"))
        self.flow = read(PKG, "config_flow.py")

    def test_errors_and_aborts_have_text(self):
        errors = set(re.findall(r'errors\[[^\]]+\] = "([a-z_]+)"', self.flow))
        aborts = set(re.findall(r'reason="([a-z_]+)"', self.flow)) | {"already_configured", "reconfigure_successful"}
        self.assertTrue(errors and aborts)
        self.assertLessEqual(errors, set(self.strings["config"]["error"]))
        self.assertLessEqual(aborts, set(self.strings["config"]["abort"]))

    def test_steps_have_text(self):
        steps = set(re.findall(r'step_id="([a-z_]+)"', self.flow))
        self.assertEqual(steps, {"user", "pair", "existing", "reconfigure", "init"})
        self.assertLessEqual(steps - {"init"}, set(self.strings["config"]["step"]))
        self.assertIn("init", self.strings["options"]["step"])
        self.assertEqual(set(self.strings["config"]["step"]["user"]["menu_options"]), {"pair", "existing"})

    def test_issue_and_exception_texts(self):
        self.assertIn("add_dashboard", self.strings["issues"])
        self.assertIn("webhook_in_use", self.strings["exceptions"])

    def test_texts_are_short_and_plain(self):
        def walk(node):
            if isinstance(node, dict):
                for value in node.values():
                    yield from walk(value)
            else:
                yield node

        for text in walk(self.strings):
            self.assertIsInstance(text, str)
            self.assertLess(len(text), 220, text)

    def test_manifest_and_hacs(self):
        manifest = json.loads(read(PKG, "manifest.json"))
        self.assertEqual(manifest["domain"], "zoomy")
        self.assertTrue(manifest["config_flow"])
        self.assertEqual(manifest["iot_class"], "local_push")
        self.assertRegex(manifest["version"], r"^\d+\.\d+\.\d+$")
        self.assertEqual(manifest["requirements"], [])
        for needed in ("http", "webhook", "websocket_api", "frontend", "lovelace"):
            self.assertIn(needed, manifest["dependencies"])
        hacs = json.loads(read(ROOT, "hacs.json"))
        self.assertEqual(hacs["name"], "Zoomy")
        self.assertIn("homeassistant", hacs)
        json.loads(read(PKG, "icons.json"))


if __name__ == "__main__":
    unittest.main()

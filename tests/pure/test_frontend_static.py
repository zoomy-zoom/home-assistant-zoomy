"""Static checks of the frontend files (custom_components/zoomy/frontend), plain Python.

* every module the entry module pulls in is there, and nothing is loaded from anywhere else;
* the strategy and card names match what the backend adds (const.py, dashboard.py);
* no secrets, places, addresses or tracker reads in the files; nothing written to browser storage
  except the picked car;
* node --check on every file, when Node is installed.
"""

from __future__ import annotations

import importlib.util
import os
import re
import shutil
import subprocess
import unittest

PACKAGE = os.path.join(os.path.dirname(__file__), "..", "..", "custom_components", "zoomy")
FRONTEND = os.path.join(PACKAGE, "frontend")

# const.py imports nothing from Home Assistant: load it on its own (the package's __init__ needs Home Assistant)
_spec = importlib.util.spec_from_file_location("zoomy_const_under_test", os.path.join(PACKAGE, "const.py"))
const = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(const)
IMPORT_RE = re.compile(r"""^\s*import\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]""", re.MULTILINE)
COMMENT_RE = re.compile(r"/\*.*?\*/|(?<![:'\"\\])//[^\n]*", re.DOTALL)


def js_files() -> dict[str, str]:
    """Return {file name: text} of the frontend's JavaScript files."""
    out = {}
    for name in sorted(os.listdir(FRONTEND)):
        if name.endswith(".js"):
            with open(os.path.join(FRONTEND, name), encoding="utf-8") as handle:
                out[name] = handle.read()
    return out


class FrontendFilesTest(unittest.TestCase):
    """The files the integration serves at /zoomy_static/<version>/."""

    def setUp(self) -> None:
        self.files = js_files()

    def test_entry_module_and_its_imports(self) -> None:
        self.assertIn(const.FRONTEND_ENTRY, self.files)
        seen, todo = set(), [const.FRONTEND_ENTRY]
        while todo:
            name = todo.pop()
            if name in seen:
                continue
            seen.add(name)
            for target in IMPORT_RE.findall(self.files[name]):
                self.assertTrue(target.startswith("./"), f"{name} imports {target}: only files next to it")
                self.assertIn(target[2:], self.files, f"{name} imports {target}, which is missing")
                todo.append(target[2:])
        # every file is used, nothing is left lying about
        self.assertEqual(seen, set(self.files))

    def test_strategy_and_cards(self) -> None:
        entry = self.files[const.FRONTEND_ENTRY]
        name = const.STRATEGY_TYPE.removeprefix("custom:")
        self.assertIn(f"'ll-strategy-dashboard-{name}'", entry)
        self.assertIn(f"type: '{name}'", entry)
        self.assertIn("strategyType: 'dashboard'", entry)
        strategy = self.files["strategy.js"]
        for title in ("Summary", "Trips", "Charges", "Trip map", "Performance", "Charge sheet"):
            self.assertIn(f"title: '{title}'", strategy)
        cards = re.findall(r"registerCard\('([a-z-]+)'", "\n".join(self.files.values()))
        self.assertEqual(
            sorted(cards),
            sorted(re.findall(r"card: '([a-z-]+)'", strategy)),
            "every card the strategy uses is defined, and only those",
        )

    def no_match(self, pattern: str, text: str, what: str) -> None:
        """Fail with the bit that matched (not the whole file) when pattern is found."""
        found = re.search(pattern, text)
        self.assertIsNone(found, f"{what}: {found.group(0)!r}" if found else "")

    def test_data_only_from_zoomy_websocket_commands(self) -> None:
        text = "\n".join(self.files.values())
        asked = set(re.findall(r"\bask\('([a-z_]+)'", text))
        self.assertEqual(asked, {"trips", "charges", "dyno", "runs", "snapshot", "curve_keys", "charge_curve", "route_keys", "route"})
        # every command a page asks is one the integration answers
        ws_path = os.path.join(os.path.dirname(FRONTEND), "websocket_api.py")
        with open(ws_path, encoding="utf-8") as handle:
            served = set(re.findall(r'"zoomy/([a-z_]+)"', handle.read()))
        self.assertLessEqual(asked | {"cars", "status", "subscribe"}, served)
        self.assertIn("type: 'zoomy/' + type", self.files["core.js"])
        code = re.sub(COMMENT_RE, "", text)
        for word in ("zoomy_store", "history/", "device_tracker", "/local/", "/api/", "fetch(", "XMLHttpRequest", "WebSocket(", "callApi", "callService"):
            self.assertNotIn(word, code, word)

    def test_nothing_from_elsewhere_and_no_secrets(self) -> None:
        for name, text in self.files.items():
            code = re.sub(COMMENT_RE, "", text)
            self.no_match(r"https?://", text, f"{name}: a web address")
            self.no_match(r"\b\d{1,3}(?:\.\d{1,3}){3}\b", code, f"{name}: an IP address")
            self.no_match(r"-?\b\d{1,3}\.\d{5,}\b", code, f"{name}: something like a coordinate")
            self.no_match(r"(?i)webhook|access_token|password|secret|token", code, f"{name}: a secret")
            self.no_match(r"\bMG4\b|\bIM6\b|(?i:connected living)", text, f"{name}: the first owner's own words")
            # browser storage: only the picked car, in core.js
            if name != "core.js":
                self.no_match(r"localStorage|sessionStorage|indexedDB|document\.cookie", code, f"{name}: browser storage")
            self.no_match(r"console\.(log|info|warn|error|debug)", code, f"{name}: logs something")
        core = re.sub(COMMENT_RE, "", self.files["core.js"])
        self.assertEqual(re.findall(r"localStorage\.(\w+)\(([^,)]+)", core), [("getItem", "PICK_KEY"), ("setItem", "PICK_KEY")])

    @unittest.skipUnless(shutil.which("node"), "Node is not installed")
    def test_node_check(self) -> None:
        for name in self.files:
            result = subprocess.run(
                ["node", "--check", os.path.join(FRONTEND, name)], capture_output=True, text=True, timeout=60, check=False
            )
            self.assertEqual(result.returncode, 0, f"{name}: {result.stderr}")


if __name__ == "__main__":  # pragma: no cover
    unittest.main()

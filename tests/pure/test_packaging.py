"""Offline packaging checks, plain Python: what hassfest and the HACS check look at.

The GitHub workflow (.github/workflows/validate.yaml) runs the real hassfest
and the real HACS check once the repository is on GitHub.  These tests catch
the same kind of mistake before that, without a network:

* manifest.json: the keys HACS requires, and hassfest's rules for a custom
  integration (key order, domain = folder name, https documentation, version,
  iot_class, integration_type, imports listed as dependencies);
* hacs.json: only the keys HACS knows;
* strings.json / translations/en.json: hassfest's translation rules;
* icons.json: hassfest's icon rules;
* brand/: the images Home Assistant and HACS look for, at the right sizes;
* the repository files HACS and customers need (README, LICENSE, CHANGELOG,
  PAIRING.md, the workflow);
* PAIRING.md: every number and reply in it still matches the code;
* no file holds a word from the local, git-ignored private list
  (tests/private_words.txt): run before every push.

Where the rules come from (Home Assistant 2026.10.1, hacs/integration main):
    script/hassfest/manifest.py:151-161, 180-195, 342-351, 354-363, 378-379,
        386-394, 421-443 (custom schema, documentation url, version, domain,
        iot_class, key order)
    script/hassfest/translations.py:24-32, 139-164 (keys and values)
    script/hassfest/icons.py:16-24, 178-191 (icons)
    script/hassfest/dependencies.py (ALLOWED_USED_COMPONENTS, local modules)
    script/hassfest/config_schema.py (CONFIG_SCHEMA with async_setup)
    hacs custom_components/hacs/utils/validate.py:46-71 (hacs.json, manifest)
    hacs custom_components/hacs/validate/brands.py:32-40 (brand/icon.png)
    hacs custom_components/hacs/validate/license.py:53-87 (OSI licence)
    homeassistant/components/brands/const.py:27-55 (brand image names)
"""

from __future__ import annotations

import ast
import json
import os
import re
import struct
import unittest

from tests.pure.test_summary import load

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
PKG = os.path.join(ROOT, "custom_components", "zoomy")

const = load("const")
pairing = load("pairing")
logic = load("logic")


def read(*parts: str) -> str:
    with open(os.path.join(*parts), encoding="utf-8") as handle:
        return handle.read()


def read_json(*parts: str):
    return json.loads(read(*parts))


def walk_strings(node, path=()):
    """Yield (path, text) for every string value in a JSON tree."""
    if isinstance(node, dict):
        for key, value in node.items():
            yield from walk_strings(value, (*path, key))
    elif isinstance(node, list):
        for index, value in enumerate(node):
            yield from walk_strings(value, (*path, index))
    else:
        yield path, node


# ----- hassfest's rules, copied from script/hassfest (2026.10.1) -------------------

RE_TRANSLATION_KEY = re.compile(r"^(?!.+[_-]{2})(?![_-])[a-z0-9-_]+(?<![_-])$")
RE_COMBINED_REFERENCE = re.compile(r"(.+\[%)|(%\].+)")
RE_PLACEHOLDER_IN_SINGLE_QUOTES = re.compile(r"'{\w+}'")
RE_URL = re.compile(
    r"(((ftp|ftps|scp|http|https|mqtt|mqtts|socket|socks5):\/\/|www\.)"
    r"[a-z0-9]+([\-\.]{1}[a-z0-9]+)*\.[a-z]{2,5}(:[0-9]{1,5})?(\/.*)?)",
    re.IGNORECASE,
)
RE_HTML = re.compile(r"<[a-z].*?>", re.IGNORECASE)  # config_validation.string_with_no_html
RE_SLUG = re.compile(r"^[a-z0-9]+(_[a-z0-9]+)*$")  # what cv.slug leaves unchanged

TRANSLATION_TOP_KEYS = {
    "title", "config", "config_subentries", "options", "preview_features", "selector",
    "device_automation", "system_health", "config_panel", "application_credentials", "issues",
    "entity_component", "device", "entity", "exceptions", "services", "conditions", "triggers",
    "conversation", "common",
}
FLOW_KEYS = {"flow_title", "step", "error", "abort", "progress", "create_entry", "initiate_flow"}
STEP_KEYS = {
    "title", "description", "data", "data_description", "menu_options",
    "menu_option_descriptions", "submit", "sections",
}
ENTITY_KEYS = {"name", "state", "state_attributes", "unit_of_measurement"}
ICON_TOP_KEYS = {
    "conditions", "config", "issues", "options", "services", "triggers", "entity_component", "entity",
}

CUSTOM_MANIFEST_KEYS = {
    "domain", "name", "integration_type", "config_flow", "mqtt", "zeroconf", "ssdp", "bluetooth",
    "homekit", "dhcp", "usb", "documentation", "quality_scale", "requirements", "dependencies",
    "after_dependencies", "codeowners", "loggers", "disabled", "iot_class", "single_config_entry",
    "preview_features", "version", "issue_tracker", "import_executor",
}
IOT_CLASSES = {"assumed_state", "calculated", "cloud_polling", "cloud_push", "local_polling", "local_push"}
INTEGRATION_TYPES = {"device", "entity", "hardware", "helper", "hub", "service", "system"}
# hassfest dependencies.py: components any integration may import without listing them
ALLOWED_USED_COMPONENTS = {
    "homeassistant", "persistent_notification", "frontend", "webhook", "websocket_api",
    "sensor", "binary_sensor", "button", "number", "select", "switch",
}

HACS_JSON_KEYS = {
    "content_in_root", "country", "filename", "hacs", "hide_default_branch", "homeassistant",
    "persistent_directory", "render_readme", "zip_release", "name",
}
HACS_MANIFEST_REQUIRED = {"codeowners", "documentation", "domain", "issue_tracker", "name", "version"}

BRAND_IMAGES = {
    "icon.png", "logo.png", "icon@2x.png", "logo@2x.png",
    "dark_icon.png", "dark_logo.png", "dark_icon@2x.png", "dark_logo@2x.png",
}
SEMVER = re.compile(r"^\d+\.\d+\.\d+$")


def translation_value_problem(text: str) -> str | None:
    """Return why hassfest would refuse a translation text, or None."""
    if not isinstance(text, str):
        return "not a string"
    if RE_HTML.search(text):
        return "HTML"
    if RE_PLACEHOLDER_IN_SINGLE_QUOTES.search(text):
        return "placeholder in single quotes"
    for name in re.findall(r"{([^{}]*)}", text):
        if not name.isidentifier():
            return "placeholder is not an identifier"
    if RE_COMBINED_REFERENCE.search(text):
        return "combined translation"
    if text != text.strip():
        return "leading or trailing spaces"
    if RE_URL.search(text):
        return "URL"
    return None


def png_size(path: str) -> tuple[int, int, int]:
    """Return (width, height, colour type) from a PNG file's header."""
    with open(path, "rb") as handle:
        head = handle.read(26)
    assert head[:8] == b"\x89PNG\r\n\x1a\n", "not a PNG"
    assert head[12:16] == b"IHDR"
    width, height = struct.unpack(">II", head[16:24])
    return width, height, head[25]


class ManifestTest(unittest.TestCase):
    def setUp(self):
        self.text = read(PKG, "manifest.json")
        self.manifest = json.loads(self.text)

    def test_hacs_required_keys(self):
        missing = HACS_MANIFEST_REQUIRED - set(self.manifest)
        self.assertFalse(missing, missing)
        self.assertIsInstance(self.manifest["codeowners"], list)
        for owner in self.manifest["codeowners"]:
            self.assertTrue(owner.startswith("@"), owner)
        for key in ("documentation", "issue_tracker"):
            self.assertRegex(self.manifest[key], r"^https://[^\s/]+\.[a-z]{2,}/\S*$")
            self.assertNotIn("OWNER", self.manifest[key])

    def test_hassfest_custom_integration_rules(self):
        self.assertLessEqual(set(self.manifest), CUSTOM_MANIFEST_KEYS)
        self.assertEqual(self.manifest["domain"], os.path.basename(PKG))
        keys = list(self.manifest)
        self.assertEqual(keys[:2], ["domain", "name"])
        self.assertEqual(keys[2:], sorted(keys[2:]), "hassfest: domain, name, then alphabetical order")
        self.assertRegex(self.manifest["version"], SEMVER)
        self.assertTrue(self.manifest["documentation"].startswith("https://"))
        self.assertFalse(self.manifest["documentation"].startswith("https://www.home-assistant.io/integrations"))
        self.assertIn(self.manifest["iot_class"], IOT_CLASSES)
        self.assertIn(self.manifest["integration_type"], INTEGRATION_TYPES)
        self.assertIs(self.manifest["config_flow"], True)
        self.assertTrue(os.path.isfile(os.path.join(PKG, "config_flow.py")))
        self.assertTrue(self.text.endswith("}\n"))

    def test_config_schema_with_async_setup(self):
        init = read(PKG, "__init__.py")
        self.assertIn("async def async_setup(", init)
        self.assertRegex(init, r"(?m)^CONFIG_SCHEMA = cv\.config_entry_only_config_schema\(DOMAIN\)$")

    def test_imported_components_are_dependencies(self):
        """hassfest dependencies.py: every homeassistant.components.X used is listed."""
        allowed = (
            set(self.manifest.get("dependencies", []))
            | set(self.manifest.get("after_dependencies", []))
            | ALLOWED_USED_COMPONENTS
            | {const.DOMAIN}
        )
        used: dict[str, str] = {}
        for name in sorted(os.listdir(PKG)):
            if not name.endswith(".py"):
                continue
            tree = ast.parse(read(PKG, name))
            for node in ast.walk(tree):
                modules = []
                if isinstance(node, ast.ImportFrom) and node.module:
                    if node.module == "homeassistant.components":
                        modules = [f"homeassistant.components.{alias.name}" for alias in node.names]
                    else:
                        modules = [node.module]
                elif isinstance(node, ast.Import):
                    modules = [alias.name for alias in node.names]
                for module in modules:
                    parts = module.split(".")
                    if parts[:2] == ["homeassistant", "components"] and len(parts) > 2:
                        used.setdefault(parts[2], name)
        self.assertTrue(used)
        for component, where in used.items():
            local = os.path.isfile(os.path.join(PKG, f"{component}.py")) or os.path.isdir(os.path.join(PKG, component))
            self.assertTrue(component in allowed or local, f"{where} uses {component}, not in dependencies")

    def test_no_requirements(self):
        self.assertEqual(self.manifest["requirements"], [])


class HacsJsonTest(unittest.TestCase):
    def test_keys_and_layout(self):
        hacs = read_json(ROOT, "hacs.json")
        self.assertLessEqual(set(hacs), HACS_JSON_KEYS)
        self.assertIsInstance(hacs["name"], str)
        self.assertFalse(hacs.get("content_in_root", False))
        folders = [
            name for name in os.listdir(os.path.join(ROOT, "custom_components")) if not name.startswith(("_", "."))
        ]
        self.assertEqual(folders, ["zoomy"])  # HACS: one integration per repository
        self.assertRegex(hacs["homeassistant"], r"^\d{4}\.\d{1,2}\.\d+$")
        # The README names the same lowest Home Assistant version.
        year, month, _patch = hacs["homeassistant"].split(".")
        self.assertIn(f"Home Assistant {year}.{month} or later", read(ROOT, "README.md"))


class TranslationsTest(unittest.TestCase):
    def setUp(self):
        self.strings = read_json(PKG, "strings.json")

    def test_en_json_is_strings_json(self):
        self.assertEqual(read(PKG, "strings.json"), read(PKG, "translations", "en.json"))

    def test_structure(self):
        self.assertLessEqual(set(self.strings), TRANSLATION_TOP_KEYS)
        for flow in ("config", "options"):
            section = self.strings[flow]
            self.assertLessEqual(set(section), FLOW_KEYS, flow)
            self.assertNotIn("title", section)  # removed for config flows
            for step_id, step in section["step"].items():
                self.assertLessEqual(set(step), STEP_KEYS, step_id)
                if "data_description" in step:
                    self.assertLessEqual(set(step["data_description"]), set(step["data"]), step_id)
        for domain, entities in self.strings["entity"].items():
            self.assertRegex(domain, RE_SLUG)
            for key, entity in entities.items():
                self.assertRegex(key, RE_TRANSLATION_KEY)
                self.assertLessEqual(set(entity), ENTITY_KEYS, key)
                self.assertNotIn("{", entity.get("name", ""), key)
        for issue_id, issue in self.strings["issues"].items():
            self.assertIn("title", issue, issue_id)
            self.assertTrue(("description" in issue) != ("fix_flow" in issue), issue_id)
        for key in self.strings["exceptions"]:
            self.assertRegex(key, RE_SLUG)

    def test_values(self):
        for path, text in walk_strings(self.strings):
            problem = translation_value_problem(text)
            self.assertIsNone(problem, f"{'.'.join(map(str, path))}: {problem}")

    def test_sensor_count_in_docs(self):
        count = len(self.strings["entity"]["sensor"])
        self.assertIn(f"{count} sensors", read(ROOT, "README.md"))
        self.assertIn(f"{count} sensors", read(ROOT, "CHANGELOG.md"))


class IconsTest(unittest.TestCase):
    def test_icons(self):
        icons = read_json(PKG, "icons.json")
        self.assertLessEqual(set(icons), ICON_TOP_KEYS)
        sensors = read_json(PKG, "strings.json")["entity"]["sensor"]
        for key, entry in icons["entity"]["sensor"].items():
            self.assertIn(key, sensors)
            self.assertLessEqual(set(entry), {"default", "state", "range", "state_attributes"})
            for path, icon in walk_strings(entry):
                self.assertTrue(icon.startswith("mdi:"), f"{key}.{path}")
                self.assertIsNone(RE_HTML.search(icon))
            for state_icon in entry.get("state", {}).values():
                self.assertNotEqual(state_icon, entry.get("default"))


class BrandTest(unittest.TestCase):
    def test_brand_images(self):
        folder = os.path.join(PKG, "brand")
        names = set(os.listdir(folder))
        self.assertLessEqual(names, BRAND_IMAGES)
        self.assertIn("icon.png", names)  # what HACS looks for
        self.assertEqual(png_size(os.path.join(folder, "icon.png")), (256, 256, 6))  # RGBA
        if "icon@2x.png" in names:
            self.assertEqual(png_size(os.path.join(folder, "icon@2x.png")), (512, 512, 6))
        for name in names:
            with open(os.path.join(folder, name), "rb") as handle:
                data = handle.read()
            for chunk in (b"tEXt", b"iTXt", b"zTXt", b"eXIf"):  # no text or camera data inside
                self.assertNotIn(chunk, data, f"{name}: {chunk.decode()}")


class RepositoryFilesTest(unittest.TestCase):
    def test_files_customers_and_hacs_need(self):
        for name in ("README.md", "LICENSE", "CHANGELOG.md", "PAIRING.md", "hacs.json"):
            self.assertTrue(os.path.isfile(os.path.join(ROOT, name)), name)
        lic = read(ROOT, "LICENSE")
        self.assertIn("GNU GENERAL PUBLIC LICENSE", lic)  # GPL-3.0, OSI approved
        self.assertIn("Version 3, 29 June 2007", lic)

    def test_changelog_has_this_version(self):
        version = read_json(PKG, "manifest.json")["version"]
        self.assertRegex(read(ROOT, "CHANGELOG.md"), rf"(?m)^## {re.escape(version)}\b")

    def test_readme_essentials(self):
        readme = read(ROOT, "README.md")
        manifest = read_json(PKG, "manifest.json")
        repo = manifest["documentation"].rstrip("/")
        owner, name = repo.split("/")[-2:]
        self.assertIn(f"owner={owner}&repository={name}&category=integration", readme)
        self.assertIn("config_flow_start/?domain=zoomy", readme)
        for heading in ("## Install", "## Screenshots", "## What stays at home", "## Remove"):
            self.assertIn(heading, readme)
        self.assertIn("Keep GPS routes", readme)
        self.assertIn("PAIRING.md", readme)

    def test_workflow(self):
        workflow = read(ROOT, ".github", "workflows", "validate.yaml")
        self.assertIn("uses: home-assistant/actions/hassfest@master", workflow)
        self.assertIn("uses: hacs/action@main", workflow)
        self.assertIn("category: integration", workflow)
        self.assertIn("python run_tests.py", workflow)


PRIVATE_WORDS_FILE = os.path.join(ROOT, "tests", "private_words.txt")
SKIP_DIRS = {".git", ".venv", "venv", ".ruff_cache", ".pytest_cache", "__pycache__", "node_modules", "shots"}


def private_words() -> list[str]:
    """Return the words that must never be in the repository.

    They are private (a name, a place, a network address, a phrase from an
    owner's own pages), so they are not written here: they come from
    tests/private_words.txt (git-ignored, one per line, # for comments) and
    from the ZOOMY_PRIVATE_WORDS environment variable (separated by "|").
    """
    words = [word for word in os.environ.get("ZOOMY_PRIVATE_WORDS", "").split("|") if word.strip()]
    if os.path.isfile(PRIVATE_WORDS_FILE):
        for line in read(PRIVATE_WORDS_FILE).splitlines():
            line = line.strip()
            if line and not line.startswith("#"):
                words.append(line)
    return [word.strip() for word in words]


class PrivateWordsTest(unittest.TestCase):
    """No file in the repository holds a word from the private list."""

    def test_private_words_file_is_ignored_by_git(self):
        self.assertIn("tests/private_words.txt", read(ROOT, ".gitignore").splitlines())

    def test_no_private_words(self):
        words = private_words()
        if not words:
            self.skipTest("no private word list (tests/private_words.txt or ZOOMY_PRIVATE_WORDS)")
        pattern = re.compile(
            "|".join(rf"(?<![A-Za-z0-9]){re.escape(word)}(?![A-Za-z0-9])" for word in words), re.IGNORECASE
        )
        checked = 0
        for folder, dirs, files in os.walk(ROOT):
            dirs[:] = [name for name in dirs if name not in SKIP_DIRS]
            for name in files:
                path = os.path.join(folder, name)
                if os.path.normcase(os.path.abspath(path)) == os.path.normcase(PRIVATE_WORDS_FILE):
                    continue
                try:
                    with open(path, encoding="utf-8") as handle:
                        text = handle.read()
                except UnicodeDecodeError:
                    continue  # images: BrandTest checks they carry no text
                checked += 1
                found = pattern.search(text)
                # The word itself is not printed: the test output may be shared.
                if found is not None:
                    self.fail(f"{os.path.relpath(path, ROOT)} holds a private word (character {found.start()})")
        self.assertGreater(checked, 20)


class PairingDocTest(unittest.TestCase):
    """PAIRING.md says what the code does."""

    def setUp(self):
        self.doc = read(ROOT, "PAIRING.md")

    def assert_in_doc(self, text):
        self.assertIn(text, self.doc)

    def test_pairing_numbers(self):
        self.assert_in_doc(f"/api/webhook/{const.PAIR_WEBHOOK_ID}")
        self.assert_in_doc(f'"expires_in": {int(pairing.CODE_TTL)}')
        self.assert_in_doc(f"| Offers per sender | {pairing.PER_SENDER_LIMIT} a minute")
        self.assert_in_doc(f"| Offers from everyone | {pairing.GLOBAL_LIMIT} per {int(pairing.CODE_TTL // 60)} minutes")
        self.assert_in_doc(f"| Offers held at once | {pairing.MAX_OFFERS} cars")
        self.assert_in_doc(f"| Wrong codes typed | {const.MAX_CODE_TRIES} per step")
        self.assert_in_doc(f"at most {pairing.MAX_BODY_BYTES} bytes")
        self.assert_in_doc(f"cut to {pairing.MAX_NAME_LEN} characters")
        self.assertEqual(pairing.WEBHOOK_ID_RE.pattern, r"[A-Za-z0-9_-]{16,128}")
        self.assert_in_doc("16 to 128 characters from `A-Z a-z 0-9 - _`")
        self.assertEqual(pairing.CAR_ID_RE.pattern, r"[\x21-\x7e]{1,128}")
        self.assert_in_doc("1 to 128 printable ASCII characters, no spaces")
        self.assert_in_doc(f"{const.MIN_WEBHOOK_ID_LEN} to {const.MAX_WEBHOOK_ID_LEN} characters from `A-Z a-z 0-9 - _ . ~`")

    def test_pairing_replies(self):
        clock = [100.0]
        book = pairing.PairingBook(lambda: clock[0])
        book.flow_waiting("flow")
        offer = json.loads(re.search(r"### 2\.3.*?```json\n(.*?)```", self.doc, re.DOTALL).group(1))
        status, reply = book.offer(offer, "sender")
        self.assertEqual(status, 200)
        self.assert_in_doc(json.dumps(reply))  # the "waiting" reply, exactly
        self.assertEqual(book.claim(offer["code"]).webhook_id, offer["webhook_id"])
        for text in (
            "too many pairing posts, wait a minute",
            "too many cars are pairing, try again in a few minutes",
            "Home Assistant is not waiting for a car.",
        ):
            self.assertIn(text, read(PKG, "pairing.py"))
            self.assert_in_doc(text)
        for text in ('"body too large"', '"internal error"'):
            self.assertIn(text, read(PKG, "pair_webhook.py"))
            self.assert_in_doc(text)

    def test_post_limits(self):
        self.assertEqual(logic.MAX_BODY_BYTES, 2 * 1024 * 1024)
        self.assert_in_doc("| Body | 2 MB |")
        self.assert_in_doc(f"| Nesting | {logic.MAX_DEPTH} levels")
        self.assert_in_doc(f"| Rows, or dyno pulls, in one post | {logic.MAX_ROWS} |")
        self.assert_in_doc(f"| Points in one dyno pull or charge curve | {logic.MAX_POINTS};")
        self.assert_in_doc(f"| Points in one route | {logic.MAX_ROUTE_POINTS:,} `[lat, lon]` pairs")
        self.assert_in_doc(f"| Key length | {logic.MAX_KEY_LEN} characters |")
        self.assert_in_doc(f"| `version` | {logic.MAX_VERSION_LEN} characters |")
        self.assert_in_doc(f"over {logic.SNAPSHOT_LIMIT // 1024} KiB")
        self.assert_in_doc(f"Home Assistant keeps {logic.MAX_RUNS}. The best {logic.RUNS_PROTECTED} by `s_0_60`")
        self.assertEqual(logic.RUN_PROTECT_COLUMNS, ("s_0_60", "s_0_100", "s_400m"))
        self.assertEqual(logic.MAX_ERROR_LEN, 119)
        self.assert_in_doc("under 120 characters")

    def test_every_kind_is_documented(self):
        kinds = set(logic.ZoomyData()._kinds)
        for kind in kinds:
            self.assert_in_doc(f'`"{kind}"`')
        for what in logic.HAVE_SETS:
            self.assert_in_doc(f'"{what}"')


if __name__ == "__main__":
    unittest.main()

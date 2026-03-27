import json
import os
import re
import subprocess
import unittest


ROOT_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PACKAGE_JSON = os.path.join(ROOT_DIR, "package.json")
CONFIG_YAML = os.path.join(ROOT_DIR, "backend", "config.yaml")
SHARED_CONFIG = os.path.join(ROOT_DIR, "backend", "shared-config.json")
CHECK_SCRIPT = os.path.join(ROOT_DIR, "scripts", "check-version-sync.js")


def normalize_version(raw: str) -> str:
    text = str(raw).strip()
    return text[1:] if text.lower().startswith("v") else text


class VersionGateTests(unittest.TestCase):
    def test_versions_are_synced_across_files(self):
        with open(PACKAGE_JSON, "r", encoding="utf-8") as file:
            package_version = normalize_version(json.load(file)["version"])

        with open(CONFIG_YAML, "r", encoding="utf-8") as file:
            config_text = file.read()
        match = re.search(r"^version:\s*V?([\d.]+)", config_text, re.MULTILINE)
        if match is None:
            self.fail("backend/config.yaml missing version field")
        backend_version = normalize_version(match.group(1))

        with open(SHARED_CONFIG, "r", encoding="utf-8") as file:
            shared_version = normalize_version(json.load(file).get("app", {}).get("version", ""))

        self.assertEqual(package_version, backend_version)
        self.assertEqual(package_version, shared_version)

    def test_check_version_script_passes(self):
        process = subprocess.run(
            ["node", CHECK_SCRIPT],
            cwd=ROOT_DIR,
            capture_output=True,
            text=True,
            check=False,
        )
        output = f"{process.stdout}\n{process.stderr}".strip()
        self.assertEqual(process.returncode, 0, msg=output)


if __name__ == "__main__":
    unittest.main()

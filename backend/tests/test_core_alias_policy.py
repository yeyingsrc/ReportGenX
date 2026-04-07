import sys
import types
import unittest
from unittest import mock

import backend.api as api_module


class CoreAliasPolicyTests(unittest.TestCase):
    def test_normalize_shared_config_disables_legacy_alias_by_default(self):
        normalized = api_module._normalize_shared_config({})
        plugin_runtime = normalized.get("plugin_runtime", {})
        self.assertEqual(plugin_runtime.get("mode"), "hybrid")
        self.assertFalse(plugin_runtime.get("use_legacy_core_alias"))
        self.assertEqual(plugin_runtime.get("force_legacy_templates"), [])

    def test_normalize_shared_config_accepts_explicit_legacy_alias(self):
        normalized = api_module._normalize_shared_config(
            {
                "plugin_runtime": {
                    "mode": "legacy",
                    "use_legacy_core_alias": True,
                    "force_legacy_templates": ["intrusion_report"],
                }
            }
        )
        plugin_runtime = normalized.get("plugin_runtime", {})
        self.assertEqual(plugin_runtime.get("mode"), "legacy")
        self.assertTrue(plugin_runtime.get("use_legacy_core_alias"))
        self.assertEqual(plugin_runtime.get("force_legacy_templates"), ["intrusion_report"])

    def test_ensure_alias_raises_when_core_missing_and_alias_disabled(self):
        real_import = api_module.importlib.import_module

        def fake_import(name, *args, **kwargs):
            if name == "core":
                raise ModuleNotFoundError("No module named 'core'")
            return real_import(name, *args, **kwargs)

        with mock.patch.object(api_module.importlib, "import_module", side_effect=fake_import):
            with self.assertRaises(RuntimeError):
                api_module._ensure_legacy_core_import_aliases(
                    use_alias_fallback=False,
                    fail_on_missing_core=True,
                )

    def test_ensure_alias_registers_fallback_modules_when_enabled(self):
        module_snapshot = dict(sys.modules)

        backend_module_cache = {}
        real_import = api_module.importlib.import_module

        def fake_import(name, *args, **kwargs):
            if name == "core":
                raise ModuleNotFoundError("No module named 'core'")
            if name.startswith("backend.core."):
                backend_module_cache.setdefault(name, types.ModuleType(name))
                return backend_module_cache[name]
            return real_import(name, *args, **kwargs)

        try:
            with mock.patch.object(api_module.importlib, "import_module", side_effect=fake_import):
                api_module._ensure_legacy_core_import_aliases(
                    use_alias_fallback=True,
                    fail_on_missing_core=True,
                )

            self.assertIn("core", sys.modules)
            self.assertIs(sys.modules.get("core.base_handler"), backend_module_cache["backend.core.base_handler"])
            self.assertIs(sys.modules.get("core.handler_utils"), backend_module_cache["backend.core.handler_utils"])
            self.assertIs(sys.modules.get("core.logger"), backend_module_cache["backend.core.logger"])
        finally:
            current_keys = set(sys.modules.keys())
            original_keys = set(module_snapshot.keys())

            for key in current_keys - original_keys:
                sys.modules.pop(key, None)

            for key, value in module_snapshot.items():
                sys.modules[key] = value


if __name__ == "__main__":
    unittest.main()

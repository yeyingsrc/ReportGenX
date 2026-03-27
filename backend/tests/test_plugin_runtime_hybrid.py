import importlib
import sys
import types
import unittest
from typing import Any, Dict, List, Optional, Tuple
from unittest import mock

from backend.core.handler_registry import HandlerRegistry

PluginRuntime = __import__("backend.plugin_host.runtime", fromlist=["PluginRuntime"]).PluginRuntime


class _LegacyHandler:
    def __init__(
        self,
        template_manager: Any,
        template_id: str,
        config: Optional[Dict[str, Any]] = None,
    ):
        _ = (template_manager, config)
        self.template_id = template_id

    def run(self, data: Dict[str, Any], output_dir: str) -> Dict[str, Any]:
        return {
            "success": True,
            "report_path": f"{output_dir}/legacy_{self.template_id}.docx",
            "message": "legacy path",
            "errors": [],
        }


class PluginRuntimeHybridTests(unittest.TestCase):
    _registry_snapshot: Dict[str, Any] = {}
    _module_snapshot: Dict[str, Any] = {}

    def setUp(self) -> None:
        self._registry_snapshot = dict(HandlerRegistry._handlers)
        self._module_snapshot = dict(sys.modules)

    def tearDown(self) -> None:
        HandlerRegistry._handlers = dict(self._registry_snapshot)

        current_keys = set(sys.modules.keys())
        original_keys = set(self._module_snapshot.keys())
        for key in current_keys - original_keys:
            sys.modules.pop(key, None)

        for key, value in self._module_snapshot.items():
            sys.modules[key] = value

    def _install_template_module(
        self,
        template_id: str,
        plugin_descriptor: Any = None,
        legacy_handler_class: Optional[type] = None,
    ) -> None:
        templates_pkg = sys.modules.get("templates")
        if templates_pkg is None:
            templates_pkg = types.ModuleType("templates")
            templates_pkg.__path__ = []
            sys.modules["templates"] = templates_pkg

        template_pkg_name = f"templates.{template_id}"
        template_pkg = types.ModuleType(template_pkg_name)
        template_pkg.__path__ = []
        sys.modules[template_pkg_name] = template_pkg

        handler_module_name = f"{template_pkg_name}.handler"
        handler_module = types.ModuleType(handler_module_name)
        if plugin_descriptor is not None:
            setattr(handler_module, "PLUGIN", plugin_descriptor)
        if legacy_handler_class is not None:
            setattr(handler_module, "LEGACY_HANDLER", legacy_handler_class)
        sys.modules[handler_module_name] = handler_module

    def test_hybrid_prefers_descriptor_when_available(self):
        template_id = "hybrid_descriptor_first"
        HandlerRegistry.register(template_id, _LegacyHandler)

        def descriptor_execute(**kwargs: Any) -> Dict[str, Any]:
            return {
                "success": True,
                "report_path": f"{kwargs['output_dir']}/descriptor.docx",
                "message": "descriptor path",
                "errors": [],
            }

        self._install_template_module(template_id, {"execute": descriptor_execute})

        result = PluginRuntime.execute(
            template_id=template_id,
            data={},
            output_dir="/tmp",
            template_manager=object(),
            config={"plugin_runtime": {"mode": "hybrid", "force_legacy_templates": []}},
        )

        self.assertTrue(result["success"])
        self.assertEqual(result["message"], "descriptor path")
        self.assertIn("descriptor.docx", result["report_path"])

    def test_default_mode_is_descriptor_when_config_missing(self):
        template_id = "default_descriptor_mode"
        HandlerRegistry.register(template_id, _LegacyHandler)

        def descriptor_execute(**kwargs: Any) -> Dict[str, Any]:
            return {
                "success": True,
                "report_path": f"{kwargs['output_dir']}/default_descriptor.docx",
                "message": "descriptor default",
                "errors": [],
            }

        self._install_template_module(template_id, {"execute": descriptor_execute})

        result = PluginRuntime.execute(
            template_id=template_id,
            data={},
            output_dir="/tmp",
            template_manager=object(),
            config=None,
        )

        self.assertTrue(result["success"])
        self.assertEqual(result["message"], "descriptor default")
        self.assertIn("default_descriptor.docx", result["report_path"])

    def test_hybrid_falls_back_to_legacy_when_descriptor_missing(self):
        template_id = "hybrid_legacy_fallback"
        HandlerRegistry.register(template_id, _LegacyHandler)

        result = PluginRuntime.execute(
            template_id=template_id,
            data={},
            output_dir="/tmp",
            template_manager=object(),
            config={"plugin_runtime": {"mode": "hybrid", "force_legacy_templates": []}},
        )

        self.assertTrue(result["success"])
        self.assertEqual(result["message"], "legacy path")
        self.assertIn("legacy_hybrid_legacy_fallback.docx", result["report_path"])

    def test_legacy_mode_uses_module_legacy_handler_without_registry(self):
        template_id = "legacy_module_only"

        class _ModuleLegacyHandler:
            def __init__(
                self,
                template_manager: Any,
                template_id: str,
                config: Optional[Dict[str, Any]] = None,
            ):
                _ = (template_manager, config)
                self.template_id = template_id

            def run(self, data: Dict[str, Any], output_dir: str) -> Dict[str, Any]:
                return {
                    "success": True,
                    "report_path": f"{output_dir}/module_legacy_{self.template_id}.docx",
                    "message": f"module legacy rows={len(data)}",
                    "errors": [],
                }

        self._install_template_module(template_id, legacy_handler_class=_ModuleLegacyHandler)

        result = PluginRuntime.execute(
            template_id=template_id,
            data={"a": 1},
            output_dir="/tmp",
            template_manager=object(),
            config={"plugin_runtime": {"mode": "legacy", "force_legacy_templates": []}},
        )

        self.assertTrue(result["success"])
        self.assertEqual(result["message"], "module legacy rows=1")
        self.assertIn("module_legacy_legacy_module_only.docx", result["report_path"])

    def test_hybrid_fallback_uses_module_legacy_handler_without_registry(self):
        template_id = "hybrid_module_legacy"

        class _ModuleLegacyHandler:
            def __init__(
                self,
                template_manager: Any,
                template_id: str,
                config: Optional[Dict[str, Any]] = None,
            ):
                _ = (template_manager, config)
                self.template_id = template_id

            def run(self, data: Dict[str, Any], output_dir: str) -> Dict[str, Any]:
                return {
                    "success": True,
                    "report_path": f"{output_dir}/module_hybrid_{self.template_id}.docx",
                    "message": "module hybrid fallback",
                    "errors": [],
                }

        self._install_template_module(template_id, legacy_handler_class=_ModuleLegacyHandler)

        result = PluginRuntime.execute(
            template_id=template_id,
            data={},
            output_dir="/tmp",
            template_manager=object(),
            config={"plugin_runtime": {"mode": "hybrid", "force_legacy_templates": []}},
        )

        self.assertTrue(result["success"])
        self.assertEqual(result["message"], "module hybrid fallback")
        self.assertIn("module_hybrid_hybrid_module_legacy.docx", result["report_path"])

    def test_descriptor_mode_returns_error_when_descriptor_missing(self):
        template_id = "descriptor_missing"
        HandlerRegistry.register(template_id, _LegacyHandler)

        result = PluginRuntime.execute(
            template_id=template_id,
            data={},
            output_dir="/tmp",
            template_manager=object(),
            config={"plugin_runtime": {"mode": "descriptor", "force_legacy_templates": []}},
        )

        self.assertFalse(result["success"])
        self.assertIn("Descriptor plugin is unavailable", result["message"])

    def test_isolated_mode_dispatches_to_isolated_executor(self):
        template_id = "isolated_dispatch"
        expected = {
            "success": True,
            "report_path": "/tmp/isolated.docx",
            "message": "isolated path",
            "errors": [],
        }

        with mock.patch.object(PluginRuntime, "_execute_isolated", return_value=expected) as isolated_mock:
            result = PluginRuntime.execute(
                template_id=template_id,
                data={"k": "v"},
                output_dir="/tmp",
                template_manager=object(),
                config={
                    "plugin_runtime": {
                        "mode": "isolated",
                        "subprocess_strategy": "legacy",
                        "subprocess_timeout_seconds": 30,
                        "force_legacy_templates": [],
                    }
                },
            )

        self.assertTrue(result["success"])
        self.assertEqual(result["message"], "isolated path")
        self.assertIn("execution_meta", result)
        self.assertEqual(result["execution_meta"].get("mode"), "isolated")
        self.assertEqual(result["execution_meta"].get("subprocess_strategy"), "legacy")
        isolated_mock.assert_called_once()

    def test_isolated_mode_returns_error_when_templates_dir_missing(self):
        result = PluginRuntime.execute(
            template_id="isolated_missing_templates_dir",
            data={},
            output_dir="/tmp",
            template_manager=object(),
            config={"plugin_runtime": {"mode": "isolated", "force_legacy_templates": []}},
        )

        self.assertFalse(result["success"])
        self.assertIn("requires template_manager.templates_dir", result["message"])

    def test_safe_timeout_seconds_clamps_invalid_values(self):
        self.assertEqual(PluginRuntime._safe_timeout_seconds("bad"), 120.0)
        self.assertEqual(PluginRuntime._safe_timeout_seconds(-1), 120.0)
        self.assertEqual(PluginRuntime._safe_timeout_seconds(9999), 600.0)
        self.assertEqual(PluginRuntime._safe_timeout_seconds(10), 10.0)

    def test_isolated_rollout_skip_uses_fallback_mode(self):
        template_id = "isolated_rollout_skip"
        fallback_result = {
            "success": True,
            "report_path": "/tmp/fallback.docx",
            "message": "fallback path",
            "errors": [],
        }

        class _Tm:
            templates_dir = "/tmp/templates"

        with mock.patch.object(PluginRuntime, "_execute_by_mode", return_value=fallback_result) as fallback_mock:
            with mock.patch.object(PluginRuntime, "_execute_isolated", autospec=True) as isolated_mock:
                result = PluginRuntime.execute(
                    template_id=template_id,
                    data={},
                    output_dir="/tmp",
                    template_manager=_Tm(),
                    config={
                        "plugin_runtime": {
                            "mode": "isolated",
                            "isolated_rollout_percent": 0,
                            "isolated_fallback_mode": "legacy",
                            "force_legacy_templates": [],
                        }
                    },
                )

        isolated_mock.assert_not_called()
        fallback_mock.assert_called_once()
        self.assertTrue(result["success"])
        self.assertTrue(result["execution_meta"].get("isolated_skipped"))
        self.assertEqual(result["execution_meta"].get("isolated_fallback_mode"), "legacy")
        self.assertEqual(result["execution_meta"].get("mode"), "legacy(isolated-skip)")

    def test_isolated_template_rollout_override_enables_execution(self):
        template_id = "isolated_template_override"
        isolated_result = {
            "success": True,
            "report_path": "/tmp/isolated-override.docx",
            "message": "isolated override",
            "errors": [],
        }

        class _Tm:
            templates_dir = "/tmp/templates"

        with mock.patch.object(PluginRuntime, "_execute_isolated", return_value=isolated_result) as isolated_mock:
            result = PluginRuntime.execute(
                template_id=template_id,
                data={},
                output_dir="/tmp",
                template_manager=_Tm(),
                config={
                    "plugin_runtime": {
                        "mode": "isolated",
                        "isolated_rollout_percent": 0,
                        "isolated_template_rollout": {template_id: 100},
                        "subprocess_strategy": "hybrid",
                        "force_legacy_templates": [],
                    }
                },
            )

        isolated_mock.assert_called_once()
        self.assertTrue(result["success"])
        self.assertEqual(result["execution_meta"].get("mode"), "isolated")

    def test_force_legacy_templates_overrides_descriptor_path(self):
        template_id = "force_legacy"
        HandlerRegistry.register(template_id, _LegacyHandler)

        def descriptor_execute(**kwargs: Any) -> Dict[str, Any]:
            return {
                "success": True,
                "report_path": f"{kwargs['output_dir']}/descriptor.docx",
                "message": "descriptor path",
                "errors": [],
            }

        self._install_template_module(template_id, {"execute": descriptor_execute})

        result = PluginRuntime.execute(
            template_id=template_id,
            data={},
            output_dir="/tmp",
            template_manager=object(),
            config={
                "plugin_runtime": {
                    "mode": "hybrid",
                    "force_legacy_templates": [template_id],
                }
            },
        )

        self.assertTrue(result["success"])
        self.assertEqual(result["message"], "legacy path")

    def test_descriptor_callable_supports_object_execute(self):
        template_id = "descriptor_object"

        class _DescriptorPlugin:
            def execute(
                self,
                data: Dict[str, Any],
                output_dir: str,
                **kwargs: Any,
            ) -> Tuple[bool, str, str, List[Any]]:
                _ = kwargs
                return True, f"{output_dir}/descriptor_object.docx", f"rows={len(data)}", []

        self._install_template_module(template_id, _DescriptorPlugin())

        result = PluginRuntime.execute(
            template_id=template_id,
            data={"a": 1, "b": 2},
            output_dir="/tmp",
            template_manager=object(),
            config={"plugin_runtime": {"mode": "descriptor", "force_legacy_templates": []}},
        )

        self.assertTrue(result["success"])
        self.assertEqual(result["message"], "rows=2")
        self.assertIn("descriptor_object.docx", result["report_path"])
        self.assertEqual(result["errors"], [])

    def test_intrusion_report_descriptor_executes_via_runtime(self):
        real_module = importlib.import_module("backend.templates.intrusion_report.handler")

        templates_pkg = types.ModuleType("templates")
        templates_pkg.__path__ = []
        sys.modules["templates"] = templates_pkg

        intrusion_pkg = types.ModuleType("templates.intrusion_report")
        intrusion_pkg.__path__ = []
        sys.modules["templates.intrusion_report"] = intrusion_pkg
        sys.modules["templates.intrusion_report.handler"] = real_module

        class _FakeIntrusionHandler:
            def __init__(
                self,
                template_manager: Any,
                template_id: str,
                config: Optional[Dict[str, Any]] = None,
            ):
                _ = (template_manager, config)
                self.template_id = template_id

            def run(self, data: Dict[str, Any], output_dir: str) -> Dict[str, Any]:
                return {
                    "success": True,
                    "report_path": f"{output_dir}/descriptor_intrusion.docx",
                    "message": f"descriptor {self.template_id} rows={len(data)}",
                    "errors": [],
                }

        with mock.patch.object(real_module, "IntrusionReportHandler", _FakeIntrusionHandler):
            result = PluginRuntime.execute(
                template_id="intrusion_report",
                data={"k": "v"},
                output_dir="/tmp",
                template_manager=object(),
                config={"plugin_runtime": {"mode": "descriptor", "force_legacy_templates": []}},
            )

        self.assertTrue(result["success"])
        self.assertEqual(result["message"], "descriptor intrusion_report rows=1")
        self.assertIn("descriptor_intrusion.docx", result["report_path"])

    def test_intrusion_report_descriptor_real_handler_construction_smoke(self):
        real_module = importlib.import_module("backend.templates.intrusion_report.handler")

        templates_pkg = types.ModuleType("templates")
        templates_pkg.__path__ = []
        sys.modules["templates"] = templates_pkg

        intrusion_pkg = types.ModuleType("templates.intrusion_report")
        intrusion_pkg.__path__ = []
        sys.modules["templates.intrusion_report"] = intrusion_pkg
        sys.modules["templates.intrusion_report.handler"] = real_module

        class _FakeTemplateManager:
            def get_template(self, template_id: str) -> object:
                _ = template_id
                return object()

            def validate_report_data(self, template_id: str, data: Dict[str, Any]) -> Tuple[bool, List[str]]:
                _ = (template_id, data)
                return True, []

        def _stub_run(self: Any, data: Dict[str, Any], output_dir: str) -> Dict[str, Any]:
            _ = self
            return {
                "success": True,
                "report_path": f"{output_dir}/descriptor_intrusion_real.docx",
                "message": f"real-constructor rows={len(data)}",
                "errors": [],
            }

        with mock.patch.object(real_module.IntrusionReportHandler, "run", _stub_run):
            result = PluginRuntime.execute(
                template_id="intrusion_report",
                data={"k": "v"},
                output_dir="/tmp",
                template_manager=_FakeTemplateManager(),
                config={"plugin_runtime": {"mode": "descriptor", "force_legacy_templates": []}},
            )

        self.assertTrue(result["success"])
        self.assertEqual(result["message"], "real-constructor rows=1")
        self.assertIn("descriptor_intrusion_real.docx", result["report_path"])

    def test_intrusion_report_legacy_handler_runs_without_registry_entry(self):
        real_module = importlib.import_module("backend.templates.intrusion_report.handler")

        templates_pkg = types.ModuleType("templates")
        templates_pkg.__path__ = []
        sys.modules["templates"] = templates_pkg

        intrusion_pkg = types.ModuleType("templates.intrusion_report")
        intrusion_pkg.__path__ = []
        sys.modules["templates.intrusion_report"] = intrusion_pkg
        sys.modules["templates.intrusion_report.handler"] = real_module

        HandlerRegistry._handlers.pop("intrusion_report", None)

        class _FakeTemplateManager:
            def get_template(self, template_id: str) -> object:
                _ = template_id
                return object()

            def validate_report_data(self, template_id: str, data: Dict[str, Any]) -> Tuple[bool, List[str]]:
                _ = (template_id, data)
                return True, []

        def _stub_run(self: Any, data: Dict[str, Any], output_dir: str) -> Dict[str, Any]:
            _ = self
            return {
                "success": True,
                "report_path": f"{output_dir}/legacy_intrusion_direct.docx",
                "message": f"legacy-module rows={len(data)}",
                "errors": [],
            }

        with mock.patch.object(real_module.IntrusionReportHandler, "run", _stub_run):
            result = PluginRuntime.execute(
                template_id="intrusion_report",
                data={"k": "v"},
                output_dir="/tmp",
                template_manager=_FakeTemplateManager(),
                config={"plugin_runtime": {"mode": "legacy", "force_legacy_templates": []}},
            )

        self.assertTrue(result["success"])
        self.assertEqual(result["message"], "legacy-module rows=1")
        self.assertIn("legacy_intrusion_direct.docx", result["report_path"])

    def test_vuln_report_descriptor_executes_via_runtime(self):
        real_module = importlib.import_module("backend.templates.vuln_report.handler")

        templates_pkg = types.ModuleType("templates")
        templates_pkg.__path__ = []
        sys.modules["templates"] = templates_pkg

        vuln_pkg = types.ModuleType("templates.vuln_report")
        vuln_pkg.__path__ = []
        sys.modules["templates.vuln_report"] = vuln_pkg
        sys.modules["templates.vuln_report.handler"] = real_module

        class _FakeVulnHandler:
            def __init__(
                self,
                template_manager: Any,
                template_id: str,
                config: Optional[Dict[str, Any]] = None,
            ):
                _ = (template_manager, config)
                self.template_id = template_id

            def run(self, data: Dict[str, Any], output_dir: str) -> Dict[str, Any]:
                return {
                    "success": True,
                    "report_path": f"{output_dir}/descriptor_vuln.docx",
                    "message": f"descriptor {self.template_id} rows={len(data)}",
                    "errors": [],
                }

        with mock.patch.object(real_module, "VulnReportHandler", _FakeVulnHandler):
            result = PluginRuntime.execute(
                template_id="vuln_report",
                data={"k": "v"},
                output_dir="/tmp",
                template_manager=object(),
                config={"plugin_runtime": {"mode": "descriptor", "force_legacy_templates": []}},
            )

        self.assertTrue(result["success"])
        self.assertEqual(result["message"], "descriptor vuln_report rows=1")
        self.assertIn("descriptor_vuln.docx", result["report_path"])

    def test_vuln_report_force_legacy_overrides_descriptor(self):
        real_module = importlib.import_module("backend.templates.vuln_report.handler")

        templates_pkg = types.ModuleType("templates")
        templates_pkg.__path__ = []
        sys.modules["templates"] = templates_pkg

        vuln_pkg = types.ModuleType("templates.vuln_report")
        vuln_pkg.__path__ = []
        sys.modules["templates.vuln_report"] = vuln_pkg
        sys.modules["templates.vuln_report.handler"] = real_module

        class _LegacyVulnHandler:
            def __init__(
                self,
                template_manager: Any,
                template_id: str,
                config: Optional[Dict[str, Any]] = None,
            ):
                _ = (template_manager, config)
                self.template_id = template_id

            def run(self, data: Dict[str, Any], output_dir: str) -> Dict[str, Any]:
                return {
                    "success": True,
                    "report_path": f"{output_dir}/legacy_vuln.docx",
                    "message": "legacy vuln path",
                    "errors": [],
                }

        HandlerRegistry.register("vuln_report", _LegacyVulnHandler)

        class _FailIfDescriptorUsed:
            def __init__(
                self,
                template_manager: Any,
                template_id: str,
                config: Optional[Dict[str, Any]] = None,
            ):
                _ = (template_manager, template_id, config)

            def run(self, data: Dict[str, Any], output_dir: str) -> Dict[str, Any]:
                _ = (data, output_dir)
                raise RuntimeError("descriptor path should be bypassed by force_legacy")

        with mock.patch.object(real_module, "VulnReportHandler", _FailIfDescriptorUsed):
            result = PluginRuntime.execute(
                template_id="vuln_report",
                data={"k": "v"},
                output_dir="/tmp",
                template_manager=object(),
                config={
                    "plugin_runtime": {
                        "mode": "hybrid",
                        "force_legacy_templates": ["vuln_report"],
                    }
                },
            )

        self.assertTrue(result["success"])
        self.assertEqual(result["message"], "legacy vuln path")
        self.assertIn("legacy_vuln.docx", result["report_path"])

    def test_vuln_report_descriptor_real_handler_construction_smoke(self):
        real_module = importlib.import_module("backend.templates.vuln_report.handler")

        templates_pkg = types.ModuleType("templates")
        templates_pkg.__path__ = []
        sys.modules["templates"] = templates_pkg

        vuln_pkg = types.ModuleType("templates.vuln_report")
        vuln_pkg.__path__ = []
        sys.modules["templates.vuln_report"] = vuln_pkg
        sys.modules["templates.vuln_report.handler"] = real_module

        class _FakeTemplateManager:
            def get_template(self, template_id: str) -> object:
                _ = template_id
                return object()

            def validate_report_data(self, template_id: str, data: Dict[str, Any]) -> Tuple[bool, List[str]]:
                _ = (template_id, data)
                return True, []

        def _stub_run(self: Any, data: Dict[str, Any], output_dir: str) -> Dict[str, Any]:
            _ = self
            return {
                "success": True,
                "report_path": f"{output_dir}/descriptor_vuln_real.docx",
                "message": f"real-constructor rows={len(data)}",
                "errors": [],
            }

        with mock.patch.object(real_module.VulnReportHandler, "run", _stub_run):
            result = PluginRuntime.execute(
                template_id="vuln_report",
                data={"k": "v"},
                output_dir="/tmp",
                template_manager=_FakeTemplateManager(),
                config={"plugin_runtime": {"mode": "descriptor", "force_legacy_templates": []}},
            )

        self.assertTrue(result["success"])
        self.assertEqual(result["message"], "real-constructor rows=1")
        self.assertIn("descriptor_vuln_real.docx", result["report_path"])

    def test_penetration_test_descriptor_executes_via_runtime(self):
        real_module = importlib.import_module("backend.templates.penetration_test.handler")

        templates_pkg = types.ModuleType("templates")
        templates_pkg.__path__ = []
        sys.modules["templates"] = templates_pkg

        penetration_pkg = types.ModuleType("templates.penetration_test")
        penetration_pkg.__path__ = []
        sys.modules["templates.penetration_test"] = penetration_pkg
        sys.modules["templates.penetration_test.handler"] = real_module

        class _FakePenetrationHandler:
            def __init__(
                self,
                template_manager: Any,
                template_id: str,
                config: Optional[Dict[str, Any]] = None,
            ):
                _ = (template_manager, config)
                self.template_id = template_id

            def run(self, data: Dict[str, Any], output_dir: str) -> Dict[str, Any]:
                return {
                    "success": True,
                    "report_path": f"{output_dir}/descriptor_penetration.docx",
                    "message": f"descriptor {self.template_id} rows={len(data)}",
                    "errors": [],
                }

        with mock.patch.object(real_module, "PenetrationTestHandler", _FakePenetrationHandler):
            result = PluginRuntime.execute(
                template_id="penetration_test",
                data={"k": "v"},
                output_dir="/tmp",
                template_manager=object(),
                config={"plugin_runtime": {"mode": "descriptor", "force_legacy_templates": []}},
            )

        self.assertTrue(result["success"])
        self.assertEqual(result["message"], "descriptor penetration_test rows=1")
        self.assertIn("descriptor_penetration.docx", result["report_path"])

    def test_penetration_test_force_legacy_overrides_descriptor(self):
        real_module = importlib.import_module("backend.templates.penetration_test.handler")

        templates_pkg = types.ModuleType("templates")
        templates_pkg.__path__ = []
        sys.modules["templates"] = templates_pkg

        penetration_pkg = types.ModuleType("templates.penetration_test")
        penetration_pkg.__path__ = []
        sys.modules["templates.penetration_test"] = penetration_pkg
        sys.modules["templates.penetration_test.handler"] = real_module

        class _LegacyPenetrationHandler:
            def __init__(
                self,
                template_manager: Any,
                template_id: str,
                config: Optional[Dict[str, Any]] = None,
            ):
                _ = (template_manager, config)
                self.template_id = template_id

            def run(self, data: Dict[str, Any], output_dir: str) -> Dict[str, Any]:
                return {
                    "success": True,
                    "report_path": f"{output_dir}/legacy_penetration.docx",
                    "message": "legacy penetration path",
                    "errors": [],
                }

        HandlerRegistry.register("penetration_test", _LegacyPenetrationHandler)

        class _FailIfDescriptorUsed:
            def __init__(
                self,
                template_manager: Any,
                template_id: str,
                config: Optional[Dict[str, Any]] = None,
            ):
                _ = (template_manager, template_id, config)

            def run(self, data: Dict[str, Any], output_dir: str) -> Dict[str, Any]:
                _ = (data, output_dir)
                raise RuntimeError("descriptor path should be bypassed by force_legacy")

        with mock.patch.object(real_module, "PenetrationTestHandler", _FailIfDescriptorUsed):
            result = PluginRuntime.execute(
                template_id="penetration_test",
                data={"k": "v"},
                output_dir="/tmp",
                template_manager=object(),
                config={
                    "plugin_runtime": {
                        "mode": "hybrid",
                        "force_legacy_templates": ["penetration_test"],
                    }
                },
            )

        self.assertTrue(result["success"])
        self.assertEqual(result["message"], "legacy penetration path")
        self.assertIn("legacy_penetration.docx", result["report_path"])

    def test_penetration_test_descriptor_real_handler_construction_smoke(self):
        real_module = importlib.import_module("backend.templates.penetration_test.handler")

        templates_pkg = types.ModuleType("templates")
        templates_pkg.__path__ = []
        sys.modules["templates"] = templates_pkg

        penetration_pkg = types.ModuleType("templates.penetration_test")
        penetration_pkg.__path__ = []
        sys.modules["templates.penetration_test"] = penetration_pkg
        sys.modules["templates.penetration_test.handler"] = real_module

        class _FakeTemplateManager:
            def get_template(self, template_id: str) -> object:
                _ = template_id
                return object()

            def validate_report_data(self, template_id: str, data: Dict[str, Any]) -> Tuple[bool, List[str]]:
                _ = (template_id, data)
                return True, []

        def _stub_run(self: Any, data: Dict[str, Any], output_dir: str) -> Dict[str, Any]:
            _ = self
            return {
                "success": True,
                "report_path": f"{output_dir}/descriptor_penetration_real.docx",
                "message": f"real-constructor rows={len(data)}",
                "errors": [],
            }

        with mock.patch.object(real_module.PenetrationTestHandler, "run", _stub_run):
            result = PluginRuntime.execute(
                template_id="penetration_test",
                data={"k": "v"},
                output_dir="/tmp",
                template_manager=_FakeTemplateManager(),
                config={"plugin_runtime": {"mode": "descriptor", "force_legacy_templates": []}},
            )

        self.assertTrue(result["success"])
        self.assertEqual(result["message"], "real-constructor rows=1")
        self.assertIn("descriptor_penetration_real.docx", result["report_path"])

    def test_attack_defense_descriptor_executes_via_runtime(self):
        real_module = importlib.import_module("backend.templates.Attack_Defense.handler")

        templates_pkg = types.ModuleType("templates")
        templates_pkg.__path__ = []
        sys.modules["templates"] = templates_pkg

        attack_pkg = types.ModuleType("templates.Attack_Defense")
        attack_pkg.__path__ = []
        sys.modules["templates.Attack_Defense"] = attack_pkg
        sys.modules["templates.Attack_Defense.handler"] = real_module

        class _FakeAttackDefenseHandler:
            def __init__(
                self,
                template_manager: Any,
                template_id: str,
                config: Optional[Dict[str, Any]] = None,
            ):
                _ = (template_manager, config)
                self.template_id = template_id

            def run(self, data: Dict[str, Any], output_dir: str) -> Dict[str, Any]:
                return {
                    "success": True,
                    "report_path": f"{output_dir}/descriptor_attack_defense.docx",
                    "message": f"descriptor {self.template_id} rows={len(data)}",
                    "errors": [],
                }

        with mock.patch.object(real_module, "AttackDefenseHandler", _FakeAttackDefenseHandler):
            result = PluginRuntime.execute(
                template_id="Attack_Defense",
                data={"k": "v"},
                output_dir="/tmp",
                template_manager=object(),
                config={"plugin_runtime": {"mode": "descriptor", "force_legacy_templates": []}},
            )

        self.assertTrue(result["success"])
        self.assertEqual(result["message"], "descriptor Attack_Defense rows=1")
        self.assertIn("descriptor_attack_defense.docx", result["report_path"])

    def test_attack_defense_force_legacy_overrides_descriptor(self):
        real_module = importlib.import_module("backend.templates.Attack_Defense.handler")

        templates_pkg = types.ModuleType("templates")
        templates_pkg.__path__ = []
        sys.modules["templates"] = templates_pkg

        attack_pkg = types.ModuleType("templates.Attack_Defense")
        attack_pkg.__path__ = []
        sys.modules["templates.Attack_Defense"] = attack_pkg
        sys.modules["templates.Attack_Defense.handler"] = real_module

        class _LegacyAttackDefenseHandler:
            def __init__(
                self,
                template_manager: Any,
                template_id: str,
                config: Optional[Dict[str, Any]] = None,
            ):
                _ = (template_manager, config)
                self.template_id = template_id

            def run(self, data: Dict[str, Any], output_dir: str) -> Dict[str, Any]:
                return {
                    "success": True,
                    "report_path": f"{output_dir}/legacy_attack_defense.docx",
                    "message": "legacy attack_defense path",
                    "errors": [],
                }

        HandlerRegistry.register("Attack_Defense", _LegacyAttackDefenseHandler)

        class _FailIfDescriptorUsed:
            def __init__(
                self,
                template_manager: Any,
                template_id: str,
                config: Optional[Dict[str, Any]] = None,
            ):
                _ = (template_manager, template_id, config)

            def run(self, data: Dict[str, Any], output_dir: str) -> Dict[str, Any]:
                _ = (data, output_dir)
                raise RuntimeError("descriptor path should be bypassed by force_legacy")

        with mock.patch.object(real_module, "AttackDefenseHandler", _FailIfDescriptorUsed):
            result = PluginRuntime.execute(
                template_id="Attack_Defense",
                data={"k": "v"},
                output_dir="/tmp",
                template_manager=object(),
                config={
                    "plugin_runtime": {
                        "mode": "hybrid",
                        "force_legacy_templates": ["Attack_Defense"],
                    }
                },
            )

        self.assertTrue(result["success"])
        self.assertEqual(result["message"], "legacy attack_defense path")
        self.assertIn("legacy_attack_defense.docx", result["report_path"])

    def test_attack_defense_descriptor_real_handler_construction_smoke(self):
        real_module = importlib.import_module("backend.templates.Attack_Defense.handler")

        templates_pkg = types.ModuleType("templates")
        templates_pkg.__path__ = []
        sys.modules["templates"] = templates_pkg

        attack_pkg = types.ModuleType("templates.Attack_Defense")
        attack_pkg.__path__ = []
        sys.modules["templates.Attack_Defense"] = attack_pkg
        sys.modules["templates.Attack_Defense.handler"] = real_module

        class _FakeTemplateManager:
            def get_template(self, template_id: str) -> object:
                _ = template_id
                return object()

            def validate_report_data(self, template_id: str, data: Dict[str, Any]) -> Tuple[bool, List[str]]:
                _ = (template_id, data)
                return True, []

        def _stub_run(self: Any, data: Dict[str, Any], output_dir: str) -> Dict[str, Any]:
            _ = self
            return {
                "success": True,
                "report_path": f"{output_dir}/descriptor_attack_defense_real.docx",
                "message": f"real-constructor rows={len(data)}",
                "errors": [],
            }

        with mock.patch.object(real_module.AttackDefenseHandler, "run", _stub_run):
            result = PluginRuntime.execute(
                template_id="Attack_Defense",
                data={"k": "v"},
                output_dir="/tmp",
                template_manager=_FakeTemplateManager(),
                config={"plugin_runtime": {"mode": "descriptor", "force_legacy_templates": []}},
            )

        self.assertTrue(result["success"])
        self.assertEqual(result["message"], "real-constructor rows=1")
        self.assertIn("descriptor_attack_defense_real.docx", result["report_path"])

    def test_attack_defense_hybrid_prefers_descriptor_over_legacy(self):
        real_module = importlib.import_module("backend.templates.Attack_Defense.handler")

        templates_pkg = types.ModuleType("templates")
        templates_pkg.__path__ = []
        sys.modules["templates"] = templates_pkg

        attack_pkg = types.ModuleType("templates.Attack_Defense")
        attack_pkg.__path__ = []
        sys.modules["templates.Attack_Defense"] = attack_pkg
        sys.modules["templates.Attack_Defense.handler"] = real_module

        class _LegacyShouldNotRun:
            def __init__(
                self,
                template_manager: Any,
                template_id: str,
                config: Optional[Dict[str, Any]] = None,
            ):
                _ = (template_manager, template_id, config)

            def run(self, data: Dict[str, Any], output_dir: str) -> Dict[str, Any]:
                _ = (data, output_dir)
                raise RuntimeError("legacy path should not run in hybrid when descriptor works")

        HandlerRegistry.register("Attack_Defense", _LegacyShouldNotRun)

        class _DescriptorAttackDefenseHandler:
            def __init__(
                self,
                template_manager: Any,
                template_id: str,
                config: Optional[Dict[str, Any]] = None,
            ):
                _ = (template_manager, config)
                self.template_id = template_id

            def run(self, data: Dict[str, Any], output_dir: str) -> Dict[str, Any]:
                return {
                    "success": True,
                    "report_path": f"{output_dir}/descriptor_attack_defense_hybrid.docx",
                    "message": f"descriptor {self.template_id} rows={len(data)}",
                    "errors": [],
                }

        with mock.patch.object(real_module, "AttackDefenseHandler", _DescriptorAttackDefenseHandler):
            result = PluginRuntime.execute(
                template_id="Attack_Defense",
                data={"k": "v"},
                output_dir="/tmp",
                template_manager=object(),
                config={"plugin_runtime": {"mode": "hybrid", "force_legacy_templates": []}},
            )

        self.assertTrue(result["success"])
        self.assertEqual(result["message"], "descriptor Attack_Defense rows=1")
        self.assertIn("descriptor_attack_defense_hybrid.docx", result["report_path"])


if __name__ == "__main__":
    _ = unittest.main()

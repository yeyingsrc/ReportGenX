import importlib
import importlib.util
import unittest


CORE_SDK_MODULES = [
    "core.base_handler",
    "core.data_reader_db",
    "core.handler_utils",
    "core.document_editor",
    "core.document_image_processor",
    "core.logger",
    "core.summary_generator",
    "core.template_manager",
]


class CoreSdkImportCompatTests(unittest.TestCase):
    def test_core_sdk_modules_can_be_imported(self):
        for module_name in CORE_SDK_MODULES:
            with self.subTest(module=module_name):
                spec = importlib.util.find_spec(module_name)
                self.assertIsNotNone(spec, f"Expected import spec for {module_name}")

                module = importlib.import_module(module_name)
                self.assertIsNotNone(module)

    def test_core_sdk_modules_resolve_to_wrapper_package(self):
        for module_name in CORE_SDK_MODULES:
            with self.subTest(module=module_name):
                spec = importlib.util.find_spec(module_name)
                self.assertIsNotNone(spec, f"Expected import spec for {module_name}")
                if spec is None:
                    continue
                self.assertIsNotNone(spec.origin, f"Expected import origin for {module_name}")
                if spec.origin is None:
                    continue

                normalized_origin = str(spec.origin).replace("\\", "/")
                self.assertIn(
                    "/core/",
                    normalized_origin,
                    f"{module_name} should resolve from top-level core wrapper package",
                )
                self.assertNotIn(
                    "/backend/core/",
                    normalized_origin,
                    f"{module_name} should not resolve directly from backend.core",
                )

    def test_core_sdk_symbol_smoke(self):
        module_symbol_pairs = [
            ("core.base_handler", "BaseTemplateHandler"),
            ("core.base_handler", "register_handler"),
            ("core.data_reader_db", "DbDataReader"),
            ("core.handler_utils", "BaseTemplateHandlerEnhanced"),
            ("core.handler_utils", "TableProcessor"),
            ("core.handler_utils", "ErrorHandler"),
            ("core.document_editor", "DocumentEditor"),
            ("core.document_image_processor", "DocumentImageProcessor"),
            ("core.logger", "setup_logger"),
            ("core.summary_generator", "SummaryGenerator"),
            ("core.summary_generator", "SummaryTemplates"),
            ("core.template_manager", "TemplateManager"),
        ]

        for module_name, symbol_name in module_symbol_pairs:
            with self.subTest(module=module_name, symbol=symbol_name):
                module = importlib.import_module(module_name)
                self.assertTrue(
                    hasattr(module, symbol_name),
                    f"Expected symbol {symbol_name} in {module_name}",
                )


if __name__ == "__main__":
    _ = unittest.main()

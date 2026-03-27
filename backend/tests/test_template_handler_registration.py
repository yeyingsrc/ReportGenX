import importlib.util
import os
import unittest

from fastapi.testclient import TestClient

import backend.api as package_api_module


BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API_PATH = os.path.join(BACKEND_DIR, "api.py")


def _load_api_module_via_file_path():
    spec = importlib.util.spec_from_file_location("report_backend_api_runtime_ctx", API_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load backend api module from file path")

    api_module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(api_module)
    return api_module


class TemplateHandlerRegistrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.package_api_module = package_api_module
        cls.file_path_api_module = _load_api_module_via_file_path()
        cls.package_client = TestClient(cls.package_api_module.app)
        cls.file_path_client = TestClient(cls.file_path_api_module.app)

    def _assert_registry_alignment(self, api_module, template_ids) -> None:
        registered_ids = set(api_module.HandlerRegistry.list_registered())
        missing = sorted(set(template_ids) - registered_ids)
        self.assertEqual(
            missing,
            [],
            f"Missing handlers for template IDs: {missing}",
        )

    def _assert_no_missing_handler(self, api_module, client: TestClient) -> None:
        templates_response = client.get("/api/templates")
        self.assertEqual(templates_response.status_code, 200)

        template_items = templates_response.json().get("templates", [])
        template_ids = [item.get("id") for item in template_items if item.get("id")]
        self.assertGreater(len(template_ids), 0)
        self._assert_registry_alignment(api_module, template_ids)

        for template_id in template_ids:
            response = client.post(
                f"/api/templates/{template_id}/generate",
                json={"data": {}, "output_dir": ""},
            )
            self.assertEqual(response.status_code, 200)

            payload = response.json()
            message = str(payload.get("message", ""))
            self.assertNotIn("No handler registered for template", message)

    def test_generate_endpoint_never_reports_missing_handler_in_package_import_context(self):
        self._assert_no_missing_handler(self.package_api_module, self.package_client)

    def test_generate_endpoint_never_reports_missing_handler_in_file_path_import_context(self):
        self._assert_no_missing_handler(self.file_path_api_module, self.file_path_client)


if __name__ == "__main__":
    unittest.main()

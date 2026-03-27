import importlib.util
import os
import sys
import unittest

from fastapi.testclient import TestClient


BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API_PATH = os.path.join(BACKEND_DIR, "api.py")
spec = importlib.util.spec_from_file_location("report_backend_api", API_PATH)
if spec is None or spec.loader is None:
    raise RuntimeError("Unable to load backend api module for tests")
api_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(api_module)
app = api_module.app


class ApiSecurityAndContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)

    def test_open_folder_rejects_outside_allowlist(self):
        response = self.client.post("/api/open-folder", json={"path": BACKEND_DIR})
        self.assertEqual(response.status_code, 403)

    def test_delete_report_rejects_outside_output(self):
        outside_file = os.path.join(BACKEND_DIR, "api.py")
        response = self.client.post("/api/delete-report", json={"path": outside_file})
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertFalse(payload.get("success", True))

    def test_route_contracts_present(self):
        route_table = {}
        for route in app.routes:
            path = getattr(route, "path", None)
            methods = getattr(route, "methods", None)
            if not methods or not path:
                continue
            clean_methods = set(methods) - {"HEAD", "OPTIONS"}
            if path not in route_table:
                route_table[path] = set()
            route_table[path].update(clean_methods)

        expected = {
            "/api/config": {"GET"},
            "/api/version": {"GET"},
            "/api/plugin-runtime-config": {"GET", "POST"},
            "/api/vulnerabilities": {"GET", "POST"},
            "/api/vulnerabilities/{Vuln_id}": {"PUT", "DELETE"},
            "/api/icp-list": {"GET"},
            "/api/icp-entry/{vuln_id}": {"PUT", "DELETE"},
            "/api/update-config": {"POST"},
        }

        for path, methods in expected.items():
            self.assertIn(path, route_table)
            self.assertTrue(methods.issubset(route_table[path]))

    def test_plugin_runtime_config_available_without_admin_session(self):
        response = self.client.get("/api/plugin-runtime-config")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload.get("success"))
        self.assertIn("plugin_runtime", payload)


if __name__ == "__main__":
    unittest.main()

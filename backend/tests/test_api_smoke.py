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


class ApiSmokeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)

    def test_root_endpoint(self):
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertIn("message", payload)
        self.assertIn("version", payload)

    def test_config_endpoint(self):
        response = self.client.get("/api/config")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertIn("version", payload)
        self.assertIn("supplierName", payload)
        self.assertIn("vulnerabilities_list", payload)

    def test_frontend_config_endpoint(self):
        response = self.client.get("/api/frontend-config")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertIn("risk_levels", payload)
        self.assertIn("operating_systems", payload)

    def test_version_endpoint(self):
        response = self.client.get("/api/version")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertIn("backend_version", payload)
        self.assertIn("shared_version", payload)
        self.assertIn("is_synced", payload)

    def test_process_url_with_ip(self):
        response = self.client.post("/api/process-url", json={"url": "8.8.8.8"})
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload.get("ip"), "8.8.8.8")

    def test_process_url_get_with_ip(self):
        response = self.client.get("/api/process-url", params={"url": "8.8.8.8"})
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload.get("ip"), "8.8.8.8")

    def test_process_url_get_without_url(self):
        response = self.client.get("/api/process-url")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload.get("url"), "")
        self.assertEqual(payload.get("domain"), "")
        self.assertEqual(payload.get("ip"), "")
        self.assertIsNone(payload.get("icp_info"))

    def test_vulnerabilities_endpoint_returns_list(self):
        response = self.client.get("/api/vulnerabilities")
        self.assertEqual(response.status_code, 200)
        self.assertIsInstance(response.json(), list)

    def test_icp_list_endpoint_returns_list(self):
        response = self.client.get("/api/icp-list")
        self.assertEqual(response.status_code, 200)
        self.assertIsInstance(response.json(), list)


if __name__ == "__main__":
    unittest.main()

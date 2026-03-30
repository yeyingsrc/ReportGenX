"""Post-C rollback drill for packaged backend runtime modes.

This script runs smoke checks against packaged backend binaries for
descriptor default and rollback scenarios, then restores shared config.
"""

from __future__ import annotations

import copy
import json
import socket
import subprocess
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List

import requests


ROOT_DIR = Path(__file__).resolve().parents[2]
BACKEND_DIR = ROOT_DIR / "backend"
CONFIG_PATH = BACKEND_DIR / "shared-config.json"
PACKAGED_API_CANDIDATES = (
    BACKEND_DIR / "dist" / "api" / "api.exe",
    BACKEND_DIR / "dist" / "api" / "api",
)
HEALTH_PATH = "/api/health"
TEMPLATES_PATH = "/api/templates"
GENERATE_PATH = "/api/templates/intrusion_report/generate"
FORBIDDEN_MARKERS = (
    "No handler registered for template",
    "No module named",
    "FileNotFoundError",
)


@dataclass(frozen=True)
class DrillScenario:
    name: str
    mode: str
    use_legacy_core_alias: bool
    force_legacy_templates: List[str]


SCENARIOS = [
    DrillScenario(
        name="descriptor-default",
        mode="descriptor",
        use_legacy_core_alias=False,
        force_legacy_templates=[],
    ),
    DrillScenario(
        name="legacy-global-rollback",
        mode="legacy",
        use_legacy_core_alias=False,
        force_legacy_templates=[],
    ),
    DrillScenario(
        name="hybrid-force-legacy-template",
        mode="hybrid",
        use_legacy_core_alias=False,
        force_legacy_templates=["intrusion_report"],
    ),
    DrillScenario(
        name="extreme-rollback-alias-legacy",
        mode="legacy",
        use_legacy_core_alias=True,
        force_legacy_templates=[],
    ),
]


class ApiProcess:
    def __init__(self, exe_path: Path, ready_url: str) -> None:
        self.exe_path = exe_path
        self.ready_url = ready_url
        self.proc: subprocess.Popen[str] | None = None
        self._reader_thread: threading.Thread | None = None
        self.log_lines: List[str] = []

    def poll(self) -> int | None:
        if self.proc is None:
            return None
        return self.proc.poll()

    def log_tail(self, limit: int = 30) -> str:
        if not self.log_lines:
            return ""
        return "\n".join(self.log_lines[-limit:])

    def start(self) -> None:
        self.proc = subprocess.Popen(
            [str(self.exe_path)],
            cwd=str(ROOT_DIR),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
        )
        self._reader_thread = threading.Thread(target=self._read_output, daemon=True)
        self._reader_thread.start()

    def _read_output(self) -> None:
        if self.proc is None or self.proc.stdout is None:
            return
        for line in self.proc.stdout:
            self.log_lines.append(line.rstrip("\n"))

    def wait_until_ready(self, timeout_seconds: int = 60) -> bool:
        deadline = time.time() + timeout_seconds
        while time.time() < deadline:
            if self.proc is not None and self.proc.poll() is not None:
                return False
            try:
                response = requests.get(self.ready_url, timeout=2)
                if response.status_code == 200:
                    return True
            except Exception:
                pass
            time.sleep(0.5)
        return False

    def stop(self) -> None:
        if self.proc is None:
            return

        if self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.proc.kill()
                self.proc.wait(timeout=10)

        if self._reader_thread is not None:
            self._reader_thread.join(timeout=2)


def _resolve_packaged_api_binary() -> Path | None:
    for candidate in PACKAGED_API_CANDIDATES:
        if candidate.exists() and candidate.is_file():
            return candidate
    return None


def _write_runtime_config(base_config: Dict[str, Any], scenario: DrillScenario) -> None:
    config = copy.deepcopy(base_config)
    plugin_runtime = config.get("plugin_runtime", {})
    if not isinstance(plugin_runtime, dict):
        plugin_runtime = {}

    plugin_runtime["mode"] = scenario.mode
    plugin_runtime["use_legacy_core_alias"] = scenario.use_legacy_core_alias
    plugin_runtime["force_legacy_templates"] = list(scenario.force_legacy_templates)
    config["plugin_runtime"] = plugin_runtime

    with CONFIG_PATH.open("w", encoding="utf-8") as fh:
        json.dump(config, fh, ensure_ascii=False, indent=2)
        fh.write("\n")


def _allocate_local_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _prepare_scenario_config(base_config: Dict[str, Any], scenario: DrillScenario) -> Dict[str, Any]:
    config = copy.deepcopy(base_config)

    plugin_runtime = config.get("plugin_runtime", {})
    if not isinstance(plugin_runtime, dict):
        plugin_runtime = {}
    plugin_runtime["mode"] = scenario.mode
    plugin_runtime["use_legacy_core_alias"] = scenario.use_legacy_core_alias
    plugin_runtime["force_legacy_templates"] = list(scenario.force_legacy_templates)
    config["plugin_runtime"] = plugin_runtime

    server = config.get("server", {})
    if not isinstance(server, dict):
        server = {}
    server["host"] = "127.0.0.1"
    server["port"] = _allocate_local_port()
    config["server"] = server

    return config


def _build_base_url(base_config: Dict[str, Any]) -> str:
    server = base_config.get("server", {})
    host = str(server.get("host", "127.0.0.1") or "127.0.0.1")
    if host == "0.0.0.0":
        host = "127.0.0.1"

    port_raw = server.get("port", 8000)
    try:
        port = int(port_raw)
    except (TypeError, ValueError):
        port = 8000
    if port < 1 or port > 65535:
        port = 8000

    return f"http://{host}:{port}"


def _contains_forbidden(text: str) -> bool:
    return any(marker in text for marker in FORBIDDEN_MARKERS)


def _run_scenario(
    base_config: Dict[str, Any],
    scenario: DrillScenario,
    packaged_api_binary: Path,
) -> Dict[str, Any]:
    scenario_config = _prepare_scenario_config(base_config, scenario)
    _write_runtime_config(scenario_config, scenario)
    base_url = _build_base_url(scenario_config)
    health_url = f"{base_url}{HEALTH_PATH}"
    templates_url = f"{base_url}{TEMPLATES_PATH}"
    generate_url = f"{base_url}{GENERATE_PATH}"

    session = ApiProcess(packaged_api_binary, health_url)
    result: Dict[str, Any] = {
        "scenario": scenario.name,
        "ready": False,
        "templates_status": None,
        "generate_status": None,
        "generate_success": None,
        "forbidden_in_response": False,
        "forbidden_in_logs": False,
        "passed": False,
        "failure_reason": "",
    }

    try:
        session.start()
        if not session.wait_until_ready():
            exit_code = session.poll()
            log_tail = session.log_tail()
            result["failure_reason"] = f"packaged API failed to start ({health_url})"
            if exit_code is not None:
                result["failure_reason"] += f" exit={exit_code}"
            if log_tail:
                compact_tail = " | ".join(line.strip() for line in log_tail.splitlines() if line.strip())
                if compact_tail:
                    result["failure_reason"] += f" logs={compact_tail[:1200]}"
            return result

        result["ready"] = True
        templates_resp = requests.get(templates_url, timeout=10)
        result["templates_status"] = templates_resp.status_code

        payload = {
            "unit_name": "Smoke_unit_name",
            "target_name": "SmokeTarget",
        }
        generate_resp = requests.post(generate_url, json=payload, timeout=20)
        result["generate_status"] = generate_resp.status_code

        generate_payload: Dict[str, Any]
        try:
            generate_payload = generate_resp.json()
        except Exception:
            generate_payload = {}
        result["generate_success"] = bool(generate_payload.get("success", False))

        response_blob = (
            templates_resp.text
            + "\n"
            + generate_resp.text
            + "\n"
            + str(generate_payload.get("message", ""))
        )
        result["forbidden_in_response"] = _contains_forbidden(response_blob)
    except Exception as exc:
        result["failure_reason"] = f"request error: {exc}"
    finally:
        session.stop()

    log_blob = "\n".join(session.log_lines)
    result["forbidden_in_logs"] = _contains_forbidden(log_blob)

    if result["templates_status"] != 200:
        result["failure_reason"] = f"templates status={result['templates_status']}"
    elif result["generate_status"] != 200:
        result["failure_reason"] = f"generate status={result['generate_status']}"
    elif result["forbidden_in_response"]:
        result["failure_reason"] = "forbidden marker found in response"
    elif result["forbidden_in_logs"]:
        result["failure_reason"] = "forbidden marker found in logs"
    else:
        result["passed"] = True

    return result


def main() -> int:
    packaged_api_binary = _resolve_packaged_api_binary()
    if packaged_api_binary is None:
        candidates = ", ".join(str(item) for item in PACKAGED_API_CANDIDATES)
        print(f"[rollback-drill] packaged API not found. candidates: {candidates}")
        print("[rollback-drill] run: pyinstaller --noconfirm api.spec (in backend/) first")
        return 2

    original_text = CONFIG_PATH.read_text(encoding="utf-8")
    try:
        base_config = json.loads(original_text)
    except json.JSONDecodeError as exc:
        print(f"[rollback-drill] invalid shared-config.json: {exc}")
        return 2

    scenario_results: List[Dict[str, Any]] = []

    try:
        for scenario in SCENARIOS:
            result = _run_scenario(base_config, scenario, packaged_api_binary)
            scenario_results.append(result)
            status = "PASS" if result["passed"] else "FAIL"
            print(
                "[rollback-drill]"
                f" {status} {scenario.name}"
                f" templates={result['templates_status']}"
                f" generate={result['generate_status']}"
                f" forbidden(response/logs)={result['forbidden_in_response']}/{result['forbidden_in_logs']}"
                f" reason={result['failure_reason'] or '-'}"
            )
    finally:
        CONFIG_PATH.write_text(original_text, encoding="utf-8")

    failed = [item for item in scenario_results if not item["passed"]]
    if failed:
        print(f"[rollback-drill] failed scenarios: {len(failed)}/{len(scenario_results)}")
        return 1

    print(f"[rollback-drill] all scenarios passed: {len(scenario_results)}/{len(scenario_results)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

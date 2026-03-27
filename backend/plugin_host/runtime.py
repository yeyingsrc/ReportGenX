"""Hybrid plugin runtime orchestration for descriptor and legacy handlers.

This runtime keeps API response compatibility while enabling descriptor-first
execution with legacy fallback.
"""

from __future__ import annotations

import importlib
import inspect
import multiprocessing
import queue
import sys
import threading
import time
import zlib
from types import ModuleType
from typing import Any, Callable, Dict, Iterable, Optional

from backend.core.logger import setup_logger

logger = setup_logger("PluginRuntime")


class PluginRuntime:
    """Coordinate descriptor and legacy template execution paths."""

    _metrics_lock = threading.Lock()
    _template_metrics: Dict[str, Dict[str, int]] = {}

    @classmethod
    def execute(
        cls,
        template_id: str,
        data: Dict[str, Any],
        output_dir: str,
        template_manager: Any,
        config: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Execute template with descriptor-first policy and legacy fallback."""
        started_at = time.perf_counter()
        runtime_cfg = cls._runtime_config(config)
        mode = str(runtime_cfg.get("mode", "descriptor")).lower()
        force_legacy_templates = {
            str(item) for item in runtime_cfg.get("force_legacy_templates", []) if item
        }

        selected_mode = mode
        result: Dict[str, Any]

        if template_id in force_legacy_templates:
            logger.info("Template %s forced to legacy mode", template_id)
            selected_mode = "legacy(forced)"
            result = cls._execute_legacy(template_id, data, output_dir, template_manager, config)
            return cls._finalize_execution_result(
                template_id,
                selected_mode,
                started_at,
                result,
                runtime_cfg=runtime_cfg,
            )

        if mode == "legacy":
            result = cls._execute_legacy(template_id, data, output_dir, template_manager, config)
            return cls._finalize_execution_result(
                template_id,
                selected_mode,
                started_at,
                result,
                runtime_cfg=runtime_cfg,
            )

        if mode == "descriptor":
            descriptor_result = cls._execute_descriptor(
                template_id,
                data,
                output_dir,
                template_manager,
                config,
            )
            if descriptor_result is not None:
                result = descriptor_result
            else:
                result = cls._error_result(
                    f"Descriptor plugin is unavailable or invalid for template: {template_id}"
                )
            return cls._finalize_execution_result(
                template_id,
                selected_mode,
                started_at,
                result,
                runtime_cfg=runtime_cfg,
            )

        if mode == "hybrid":
            descriptor_result = cls._execute_descriptor(
                template_id,
                data,
                output_dir,
                template_manager,
                config,
            )
            if descriptor_result is not None:
                result = descriptor_result
            else:
                result = cls._execute_legacy(template_id, data, output_dir, template_manager, config)
            return cls._finalize_execution_result(
                template_id,
                selected_mode,
                started_at,
                result,
                runtime_cfg=runtime_cfg,
            )

        if mode == "isolated":
            strategy = str(runtime_cfg.get("subprocess_strategy", "hybrid")).lower()
            timeout_seconds = cls._safe_timeout_seconds(runtime_cfg.get("subprocess_timeout_seconds", 120))
            use_isolated, skip_reason = cls._should_use_isolated_mode(template_id, runtime_cfg)

            if use_isolated:
                result = cls._execute_isolated(
                    template_id,
                    data,
                    output_dir,
                    template_manager,
                    config,
                    strategy,
                    timeout_seconds,
                )
                extra = {
                    "subprocess_strategy": strategy,
                    "subprocess_timeout_seconds": timeout_seconds,
                }
            else:
                fallback_mode = cls._safe_fallback_mode(runtime_cfg.get("isolated_fallback_mode", "hybrid"))
                selected_mode = f"{fallback_mode}(isolated-skip)"
                result = cls._execute_by_mode(
                    fallback_mode,
                    template_id,
                    data,
                    output_dir,
                    template_manager,
                    config,
                )
                extra = {
                    "isolated_skipped": True,
                    "isolated_skip_reason": skip_reason,
                    "isolated_fallback_mode": fallback_mode,
                }

            return cls._finalize_execution_result(
                template_id,
                selected_mode,
                started_at,
                result,
                runtime_cfg=runtime_cfg,
                **extra,
            )

        result = cls._error_result(
            f"Invalid plugin runtime mode: {mode}. Expected one of legacy|hybrid|descriptor|isolated"
        )
        return cls._finalize_execution_result(
            template_id,
            selected_mode,
            started_at,
            result,
            runtime_cfg=runtime_cfg,
        )

    @classmethod
    def _finalize_execution_result(
        cls,
        template_id: str,
        mode: str,
        started_at: float,
        result: Dict[str, Any],
        runtime_cfg: Optional[Dict[str, Any]] = None,
        **extra_meta: Any,
    ) -> Dict[str, Any]:
        duration_ms = max(0, int((time.perf_counter() - started_at) * 1000))
        execution_count = cls._record_template_metrics(
            template_id,
            bool(result.get("success", False)),
            duration_ms,
            runtime_cfg or {},
        )
        finalized = cls._attach_execution_meta(
            result,
            mode=mode,
            duration_ms=duration_ms,
            template_execution_count=execution_count,
            **extra_meta,
        )

        if finalized.get("success"):
            logger.info(
                "Plugin execution succeeded: template=%s mode=%s duration_ms=%d",
                template_id,
                mode,
                duration_ms,
            )
        else:
            logger.warning(
                "Plugin execution failed: template=%s mode=%s duration_ms=%d message=%s",
                template_id,
                mode,
                duration_ms,
                finalized.get("message", ""),
            )

        return finalized

    @classmethod
    def _record_template_metrics(
        cls,
        template_id: str,
        success: bool,
        duration_ms: int,
        runtime_cfg: Dict[str, Any],
    ) -> int:
        emit_every = cls._safe_emit_every(runtime_cfg.get("metrics_emit_every_n", 50))

        with cls._metrics_lock:
            metrics = cls._template_metrics.setdefault(
                template_id,
                {"total": 0, "success": 0, "failure": 0},
            )
            metrics["total"] += 1
            if success:
                metrics["success"] += 1
            else:
                metrics["failure"] += 1

            total = metrics["total"]
            success_count = metrics["success"]
            failure_count = metrics["failure"]

        if total % emit_every == 0:
            logger.info(
                "Plugin metrics sample: template=%s total=%d success=%d failure=%d last_duration_ms=%d",
                template_id,
                total,
                success_count,
                failure_count,
                duration_ms,
            )

        return total

    @staticmethod
    def _safe_emit_every(raw_emit_every: Any) -> int:
        try:
            emit_every = int(raw_emit_every)
        except (TypeError, ValueError):
            emit_every = 50

        if emit_every <= 0:
            return 50

        return min(emit_every, 10000)

    @classmethod
    def _execute_by_mode(
        cls,
        mode: str,
        template_id: str,
        data: Dict[str, Any],
        output_dir: str,
        template_manager: Any,
        config: Optional[Dict[str, Any]],
    ) -> Dict[str, Any]:
        if mode == "legacy":
            return cls._execute_legacy(template_id, data, output_dir, template_manager, config)

        if mode == "descriptor":
            descriptor_result = cls._execute_descriptor(
                template_id,
                data,
                output_dir,
                template_manager,
                config,
            )
            return descriptor_result or cls._error_result(
                f"Descriptor plugin is unavailable or invalid for template: {template_id}"
            )

        if mode == "hybrid":
            descriptor_result = cls._execute_descriptor(
                template_id,
                data,
                output_dir,
                template_manager,
                config,
            )
            return descriptor_result or cls._execute_legacy(template_id, data, output_dir, template_manager, config)

        return cls._error_result(
            f"Invalid fallback mode: {mode}. Expected one of legacy|hybrid|descriptor"
        )

    @staticmethod
    def _safe_fallback_mode(raw_mode: Any) -> str:
        mode = str(raw_mode or "hybrid").lower()
        if mode in {"legacy", "hybrid", "descriptor"}:
            return mode
        return "hybrid"

    @classmethod
    def _should_use_isolated_mode(cls, template_id: str, runtime_cfg: Dict[str, Any]) -> tuple[bool, str]:
        disabled = {
            str(item) for item in runtime_cfg.get("isolated_disabled_templates", []) if item
        }
        if template_id in disabled:
            return False, "disabled-template"

        enabled = {
            str(item) for item in runtime_cfg.get("isolated_enabled_templates", []) if item
        }
        if enabled and template_id not in enabled:
            return False, "not-in-enabled-templates"

        template_rollout = runtime_cfg.get("isolated_template_rollout", {})
        rollout_percent = cls._safe_percent(runtime_cfg.get("isolated_rollout_percent", 100.0))
        if isinstance(template_rollout, dict) and template_id in template_rollout:
            rollout_percent = cls._safe_percent(template_rollout.get(template_id))

        if rollout_percent <= 0:
            return False, "rollout-0"
        if rollout_percent >= 100:
            return True, "rollout-100"

        bucket = cls._template_rollout_bucket(template_id)
        if bucket < rollout_percent:
            return True, f"rollout-hit-{rollout_percent}"
        return False, f"rollout-miss-{rollout_percent}"

    @staticmethod
    def _safe_percent(raw_percent: Any) -> float:
        try:
            percent = float(raw_percent)
        except (TypeError, ValueError):
            percent = 0.0

        if percent < 0:
            return 0.0
        if percent > 100:
            return 100.0
        return percent

    @staticmethod
    def _template_rollout_bucket(template_id: str) -> float:
        if not template_id:
            return 100.0
        checksum = zlib.crc32(template_id.encode("utf-8"))
        return (checksum % 10000) / 100.0

    @classmethod
    def _execute_isolated(
        cls,
        template_id: str,
        data: Dict[str, Any],
        output_dir: str,
        template_manager: Any,
        config: Optional[Dict[str, Any]],
        strategy: str,
        timeout_seconds: float,
    ) -> Dict[str, Any]:
        isolated_started_at = time.perf_counter()
        templates_dir = getattr(template_manager, "templates_dir", None)
        if not isinstance(templates_dir, str) or not templates_dir:
            return cls._error_result(
                f"Isolated mode requires template_manager.templates_dir for template: {template_id}"
            )

        worker_payload = {
            "template_id": template_id,
            "data": data,
            "output_dir": output_dir,
            "templates_dir": templates_dir,
            "config": config or {},
            "strategy": strategy,
        }

        context = multiprocessing.get_context("spawn")
        result_queue: Any = context.Queue()
        process = context.Process(
            target=_subprocess_execute_worker,
            args=(worker_payload, result_queue),
            daemon=True,
        )

        process.start()
        worker_pid = process.pid
        process.join(timeout_seconds)

        if process.is_alive():
            process.terminate()
            process.join(2)
            logger.error(
                "Isolated worker timeout: template=%s strategy=%s pid=%s timeout_s=%s",
                template_id,
                strategy,
                worker_pid,
                timeout_seconds,
            )
            return cls._error_result(
                f"Isolated execution timeout for template: {template_id} ({timeout_seconds}s)"
            )

        worker_exit_code = process.exitcode

        try:
            worker_result = result_queue.get_nowait()
        except queue.Empty:
            logger.error(
                "Isolated worker returned no payload: template=%s strategy=%s pid=%s exit_code=%s",
                template_id,
                strategy,
                worker_pid,
                worker_exit_code,
            )
            return cls._error_result(
                f"Isolated execution failed for template: {template_id} (no worker result)"
            )

        if not isinstance(worker_result, dict):
            return cls._error_result(
                f"Isolated execution failed for template: {template_id} (invalid worker payload)"
            )

        if worker_result.get("ok"):
            normalized = cls._normalize_result(worker_result.get("result"))
            duration_ms = max(0, int((time.perf_counter() - isolated_started_at) * 1000))
            logger.info(
                "Isolated worker succeeded: template=%s strategy=%s pid=%s exit_code=%s duration_ms=%d",
                template_id,
                strategy,
                worker_pid,
                worker_exit_code,
                duration_ms,
            )
            return cls._attach_execution_meta(
                normalized,
                isolated_worker_pid=worker_pid,
                isolated_worker_exit_code=worker_exit_code,
                isolated_duration_ms=duration_ms,
            )

        logger.error(
            "Isolated worker failed: template=%s strategy=%s pid=%s exit_code=%s error=%s",
            template_id,
            strategy,
            worker_pid,
            worker_exit_code,
            worker_result.get("error", "unknown error"),
        )

        return cls._error_result(
            f"Isolated execution failed for template: {template_id}: {worker_result.get('error', 'unknown error')}"
        )

    @classmethod
    def _execute_descriptor(
        cls,
        template_id: str,
        data: Dict[str, Any],
        output_dir: str,
        template_manager: Any,
        config: Optional[Dict[str, Any]],
    ) -> Optional[Dict[str, Any]]:
        module = cls._resolve_handler_module(template_id)
        if module is None:
            return None

        plugin_descriptor = getattr(module, "PLUGIN", None)
        if plugin_descriptor is None:
            return None

        execute_callable = cls._resolve_descriptor_callable(plugin_descriptor)
        if execute_callable is None:
            logger.warning("PLUGIN descriptor exists but is not executable for %s", template_id)
            return None

        payload = {
            "template_id": template_id,
            "data": data,
            "output_dir": output_dir,
            "template_manager": template_manager,
            "config": config or {},
        }

        try:
            raw_result = cls._invoke_callable(execute_callable, payload)
            return cls._normalize_result(raw_result)
        except Exception as exc:
            logger.error("Descriptor execution failed for %s: %s", template_id, exc)
            return None

    @classmethod
    def _execute_legacy(
        cls,
        template_id: str,
        data: Dict[str, Any],
        output_dir: str,
        template_manager: Any,
        config: Optional[Dict[str, Any]],
    ) -> Dict[str, Any]:
        handler = cls._resolve_registry_handler(template_id, template_manager, config)

        if handler is None:
            module = cls._resolve_handler_module(template_id)
            handler = cls._resolve_module_legacy_handler(
                module,
                template_id,
                template_manager,
                config,
            )

        if handler is None:
            return cls._error_result(f"No handler registered for template: {template_id}")

        try:
            raw_result = handler.run(data, output_dir)
            return cls._normalize_result(raw_result)
        except Exception as exc:
            logger.error("Legacy execution failed for %s: %s", template_id, exc)
            return cls._error_result(f"Legacy execution failed for template: {template_id}: {exc}")

    @staticmethod
    def _resolve_module_legacy_handler(
        module: Optional[ModuleType],
        template_id: str,
        template_manager: Any,
        config: Optional[Dict[str, Any]],
    ) -> Optional[Any]:
        if module is None:
            return None

        legacy_handler_class = getattr(module, "LEGACY_HANDLER", None)
        if not inspect.isclass(legacy_handler_class):
            return None

        try:
            return legacy_handler_class(template_manager, template_id, config)
        except Exception as exc:
            logger.warning(
                "Failed to construct LEGACY_HANDLER for %s: %s",
                template_id,
                exc,
            )
            return None

    @staticmethod
    def _resolve_registry_handler(
        template_id: str,
        template_manager: Any,
        config: Optional[Dict[str, Any]],
    ) -> Optional[Any]:
        try:
            from backend.core.handler_registry import HandlerRegistry
        except Exception as exc:
            logger.warning("HandlerRegistry import failed for %s: %s", template_id, exc)
            return None

        return HandlerRegistry.get_handler(template_id, template_manager, config)

    @staticmethod
    def _resolve_handler_module(template_id: str) -> Optional[ModuleType]:
        module_name = f"templates.{template_id}.handler"

        cached_module = sys.modules.get(module_name)
        if isinstance(cached_module, ModuleType):
            return cached_module

        try:
            module = importlib.import_module(module_name)
        except Exception:
            return None
        return module if isinstance(module, ModuleType) else None

    @staticmethod
    def _resolve_descriptor_callable(plugin_descriptor: Any) -> Optional[Callable[..., Any]]:
        if callable(plugin_descriptor):
            return plugin_descriptor

        if isinstance(plugin_descriptor, dict):
            execute_fn = plugin_descriptor.get("execute")
            return execute_fn if callable(execute_fn) else None

        execute_fn = getattr(plugin_descriptor, "execute", None)
        return execute_fn if callable(execute_fn) else None

    @staticmethod
    def _invoke_callable(execute_callable: Callable[..., Any], payload: Dict[str, Any]) -> Any:
        """Invoke callable with compatible kwargs by signature."""
        signature = inspect.signature(execute_callable)

        has_var_kwargs = any(
            param.kind == inspect.Parameter.VAR_KEYWORD
            for param in signature.parameters.values()
        )

        accepted_keys: Iterable[str]
        if has_var_kwargs:
            accepted_keys = payload.keys()
        else:
            accepted_keys = signature.parameters.keys()

        kwargs = {key: payload[key] for key in accepted_keys if key in payload}
        return execute_callable(**kwargs)

    @staticmethod
    def _runtime_config(config: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        if not isinstance(config, dict):
            return {}

        plugin_runtime = config.get("plugin_runtime")
        if isinstance(plugin_runtime, dict):
            return plugin_runtime

        # Backward-compatible fallback if caller passes runtime config directly.
        return config

    @staticmethod
    def _safe_timeout_seconds(raw_timeout: Any) -> float:
        try:
            timeout = float(raw_timeout)
        except (TypeError, ValueError):
            timeout = 120.0

        if timeout <= 0:
            return 120.0

        return min(timeout, 600.0)

    @staticmethod
    def _normalize_result(raw_result: Any) -> Dict[str, Any]:
        if isinstance(raw_result, dict):
            return {
                "success": bool(raw_result.get("success", False)),
                "report_path": str(raw_result.get("report_path", "") or ""),
                "message": str(raw_result.get("message", "") or ""),
                "errors": list(raw_result.get("errors", []) or []),
            }

        if isinstance(raw_result, tuple) and len(raw_result) >= 3:
            success, report_path, message = raw_result[:3]
            errors = raw_result[3] if len(raw_result) > 3 else []
            return {
                "success": bool(success),
                "report_path": str(report_path or ""),
                "message": str(message or ""),
                "errors": list(errors or []),
            }

        return {
            "success": bool(raw_result),
            "report_path": "",
            "message": "",
            "errors": [],
        }

    @staticmethod
    def _error_result(message: str) -> Dict[str, Any]:
        return {
            "success": False,
            "report_path": "",
            "message": message,
            "errors": [],
        }

    @staticmethod
    def _attach_execution_meta(result: Dict[str, Any], **meta: Any) -> Dict[str, Any]:
        merged = dict(result)
        existing_meta = merged.get("execution_meta")
        combined_meta = dict(existing_meta) if isinstance(existing_meta, dict) else {}

        for key, value in meta.items():
            if value is not None:
                combined_meta[key] = value

        if combined_meta:
            merged["execution_meta"] = combined_meta

        return merged


def _subprocess_execute_worker(worker_payload: Dict[str, Any], result_queue: Any) -> None:
    """Worker entrypoint for isolated plugin execution."""
    try:
        from backend.core.template_manager import TemplateManager

        template_id = str(worker_payload.get("template_id", ""))
        data = worker_payload.get("data")
        output_dir = worker_payload.get("output_dir")
        templates_dir = worker_payload.get("templates_dir")
        config = worker_payload.get("config") or {}
        strategy = str(worker_payload.get("strategy", "hybrid")).lower()

        if not isinstance(template_id, str) or not template_id:
            result_queue.put({"ok": False, "error": "template_id is required"})
            return
        if not isinstance(data, dict):
            result_queue.put({"ok": False, "error": "data must be a dict"})
            return
        if not isinstance(output_dir, str) or not output_dir:
            result_queue.put({"ok": False, "error": "output_dir is required"})
            return
        if not isinstance(templates_dir, str) or not templates_dir:
            result_queue.put({"ok": False, "error": "templates_dir is required"})
            return
        if not isinstance(config, dict):
            result_queue.put({"ok": False, "error": "config must be a dict"})
            return

        template_manager = TemplateManager(templates_dir, config)

        if strategy == "descriptor":
            descriptor_result = PluginRuntime._execute_descriptor(
                template_id,
                data,
                output_dir,
                template_manager,
                config,
            )
            result = descriptor_result or PluginRuntime._error_result(
                f"Descriptor plugin is unavailable or invalid for template: {template_id}"
            )
        elif strategy == "legacy":
            result = PluginRuntime._execute_legacy(
                template_id,
                data,
                output_dir,
                template_manager,
                config,
            )
        else:
            descriptor_result = PluginRuntime._execute_descriptor(
                template_id,
                data,
                output_dir,
                template_manager,
                config,
            )
            result = descriptor_result or PluginRuntime._execute_legacy(
                template_id,
                data,
                output_dir,
                template_manager,
                config,
            )

        result_queue.put({"ok": True, "result": result})
    except Exception as exc:
        result_queue.put({"ok": False, "error": str(exc)})

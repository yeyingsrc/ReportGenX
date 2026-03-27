"""Deprecated compatibility exports for template manager APIs.

This plugin SDK module re-exports ``backend.core.template_manager`` to
preserve existing ``from core.template_manager import ...`` imports.
Prefer runtime-managed plugin APIs for new integrations.
"""

from backend.core.template_manager import *  # noqa: F401,F403

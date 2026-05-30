"""Public plugin SDK namespace for ReportGenX templates.

This package exposes stable imports for template/plugin authors.
Modules here re-export supported APIs from ``backend.core.*``.

Design rule (per AGENTS.md): core/ is a pure re-export facade — no
independent implementations belong here.
"""

# Module-level utility functions usable by template preprocess()
from backend.core.generation_context import (
    gen_report_id,
    set_default_dates,
    set_supplier_defaults,
    GenerationContext,
)

# Summary generation — used by Attack_Defense preprocess helpers
from backend.core.summary_generator import SummaryGenerator, SummaryTemplates

# -*- coding: utf-8 -*-
"""
Runtime hook for python-docx
Patches the template path resolution to work with PyInstaller
"""
import os
import sys
from typing import Optional


def _get_docx_templates_path() -> Optional[str]:
    """Get the correct templates path for PyInstaller bundled app"""
    if getattr(sys, 'frozen', False):
        # Running in PyInstaller bundle
        base = getattr(sys, '_MEIPASS', None)
        if isinstance(base, str):
            return os.path.join(base, 'docx', 'templates')
    return None

# Patch docx.parts.hdrftr module to use correct path
_docx_templates_path = _get_docx_templates_path()

if isinstance(_docx_templates_path, str):
    import docx.parts.hdrftr as hdrftr
    templates_path = _docx_templates_path

    def _patched_default_header_xml() -> bytes:
        path = os.path.join(templates_path, 'default-header.xml')
        with open(path, 'rb') as handle:
            return handle.read()

    def _patched_default_footer_xml() -> bytes:
        path = os.path.join(templates_path, 'default-footer.xml')
        with open(path, 'rb') as handle:
            return handle.read()

    hdrftr.HeaderPart._default_header_xml = _patched_default_header_xml
    hdrftr.FooterPart._default_footer_xml = _patched_default_footer_xml

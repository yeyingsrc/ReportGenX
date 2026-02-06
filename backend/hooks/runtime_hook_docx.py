# -*- coding: utf-8 -*-
"""
Runtime hook for python-docx
Patches the template path resolution to work with PyInstaller
"""
import os
import sys

def _get_docx_templates_path():
    """Get the correct templates path for PyInstaller bundled app"""
    if getattr(sys, 'frozen', False):
        # Running in PyInstaller bundle
        base = sys._MEIPASS
        return os.path.join(base, 'docx', 'templates')
    return None

# Patch docx.parts.hdrftr module to use correct path
_docx_templates_path = _get_docx_templates_path()

if _docx_templates_path:
    import docx.parts.hdrftr as hdrftr
    
    _original_default_header_xml = hdrftr.HeaderPart._default_header_xml
    _original_default_footer_xml = hdrftr.FooterPart._default_footer_xml
    
    @classmethod
    def _patched_default_header_xml(cls):
        path = os.path.join(_docx_templates_path, 'default-header.xml')
        with open(path, 'rb') as f:
            return f.read()
    
    @classmethod  
    def _patched_default_footer_xml(cls):
        path = os.path.join(_docx_templates_path, 'default-footer.xml')
        with open(path, 'rb') as f:
            return f.read()
    
    hdrftr.HeaderPart._default_header_xml = _patched_default_header_xml
    hdrftr.FooterPart._default_footer_xml = _patched_default_footer_xml

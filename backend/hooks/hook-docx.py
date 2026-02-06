# -*- coding: utf-8 -*-
"""
PyInstaller hook for python-docx
Collects template files needed for header/footer creation
"""
from PyInstaller.utils.hooks import collect_data_files

# Collect all data files from docx package (templates directory)
datas = collect_data_files('docx')

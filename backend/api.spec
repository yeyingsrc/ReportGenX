# -*- mode: python ; coding: utf-8 -*-

block_cipher = None

# 导入必要的模块
import os
from PyInstaller.building.api import COLLECT, EXE, PYZ
from PyInstaller.building.build_main import Analysis
from PyInstaller.utils.hooks import collect_data_files

# SPECPATH is injected by PyInstaller when executing this spec file.
# Fallback keeps static analyzers/editor diagnostics working.
SPEC_DIR = globals().get('SPECPATH') or os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SPEC_DIR)
HOOKS_DIR = os.path.join(SPEC_DIR, 'hooks')
RUNTIME_HOOK = os.path.join(HOOKS_DIR, 'runtime_hook_docx.py')

# 收集第三方库的数据文件
docxcompose_data = collect_data_files('docxcompose')
docx_data = collect_data_files('docx')

app_datas = [
    *docxcompose_data,
    *docx_data,
]

a = Analysis([os.path.join(SPEC_DIR, 'api.py')],
             pathex=[SPEC_DIR, PROJECT_ROOT],
             binaries=[],
             datas=app_datas,  # 包含所有必需的数据文件
               hiddenimports=[
                   'core',
                   # Core modules used by dynamic templates
                   'core.document_editor',
                  'core.document_image_processor',
                  'core.exceptions',
                  'core.report_merger',
                  'core.base_handler',
                  'core.data_reader_db',
                  'core.handler_config',
                  'core.handler_registry',
                  'core.handler_utils',
                  'core.logger',
                  'core.summary_generator',
                  'core.template_manager',

                  # Canonical backend.core namespace (used by api alias bridge)
                  'backend.core',
                  'backend.core.base_handler',
                  'backend.core.data_reader_db',
                  'backend.core.document_editor',
                  'backend.core.document_image_processor',
                  'backend.core.exceptions',
                  'backend.core.handler_config',
                  'backend.core.handler_registry',
                  'backend.core.handler_utils',
                  'backend.core.logger',
                  'backend.core.report_merger',
                  'backend.core.summary_generator',
                  'backend.core.template_manager',
                  'backend.plugin_host',
                  'backend.plugin_host.runtime',

                  # PIL/Pillow modules (used by Penetration_Test handler)
                  'PIL',
                 'PIL.Image',
                 'PIL.ImageDraw',
                 'PIL.ImageFont',

                 # 确保 uvicorn 相关模块被包含
                 'uvicorn.logging',
                 'uvicorn.loops',
                 'uvicorn.loops.auto',
                 'uvicorn.protocols',
                 'uvicorn.protocols.http',
                 'uvicorn.protocols.http.auto',
                 'uvicorn.protocols.websockets',
                 'uvicorn.protocols.websockets.auto',
                 'uvicorn.lifespan',
                 'uvicorn.lifespan.on',
             ],
             hookspath=[HOOKS_DIR],
             runtime_hooks=[RUNTIME_HOOK],
             excludes=[
                 # 排除模板模块（templates/ 目录应在外部）
                 'templates',
             ],
             win_no_prefer_redirects=False,
             win_private_assemblies=False,
             cipher=block_cipher,
             noarchive=False)
pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

# 目录模式：避免每次启动解压，显著提升 macOS 启动速度
exe = EXE(pyz,
          a.scripts,
          [],  # 不打包 binaries 到 exe
          exclude_binaries=True,  # 关键：排除二进制文件
          name='api',
          debug=False,
          bootloader_ignore_signals=False,
          strip=False,
          upx=False,
          console=True)

# 收集所有文件到目录
coll = COLLECT(exe,
               a.binaries,
               a.zipfiles,
               a.datas,
               strip=False,
               upx=False,
               name='api')

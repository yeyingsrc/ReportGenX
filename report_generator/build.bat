@echo off
pip3 install Pillow pyinstaller -i https://mirrors.tuna.tsinghua.edu.cn/pypi/web/simple some-package
pyinstaller.exe -F -i resources\icon\favicon.ico -w ReportGenX.py
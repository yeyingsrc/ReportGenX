# ReportGenX (Electron)

一个基于 Electron + FastAPI 的风险隐患报告生成器。

本仓库包含：
- `root/`：Electron 前端与 Python 后端（FastAPI）整合的应用 workspace。
  - `backend/`：Python 后端（FastAPI），包含接口与报告生成逻辑。
  - `src/`：Electron 前端静态文件（HTML/CSS）。
    - `src/js/`：前端模块化脚本 (Utils, API, Logic)。
  - `main.js`：Electron 主进程，负责启动前端窗口并在打包时启动后端可执行文件。

## 目录结构
```
root/
  ├─ backend/                  # Python 后端源码与配置
  │  ├─ api.py                 # FastAPI 后端入口
  │  ├─ api.spec               # PyInstaller 打包配置
  │  ├─ config.yaml            # 全局配置文件
  │  ├─ requirements.txt       # Python 依赖
  │  ├─ core/                  # 核心业务逻辑模块
  │  │  ├─ logger.py           # 日志配置
  │  │  ├─ data_reader_db.py   # 数据库读取器
  │  │  ├─ document_editor.py  # Word 文档编辑器
  │  │  ├─ document_image_processor.py # 图片处理器
  │  │  ├─ report_merger.py    # 报告合并器
  │  │  ├─ template_manager.py # 模板管理器
  │  │  └─ base_handler.py     # 模板处理器基类
  │  ├─ templates/             # 报告模板系统
  │  │  ├─ vuln_report/        # 风险隐患报告模板
  │  │  │  ├─ schema.yaml      # 表单字段定义
  │  │  │  ├─ template.docx    # Word 模板文件
  │  │  │  └─ handler.py       # 报告生成处理器
  │  │  └─ intrusion_report/   # 入侵痕迹报告模板
  │  │     ├─ schema.yaml
  │  │     ├─ template.docx
  │  │     └─ handler.py
  │  ├─ data/                  # 数据库文件
  │  │  ├─ combined.db         # 漏洞库和 ICP 备案数据库
  │  │  └─ Excel_SQLite/       # Excel 转 SQLite 工具
  │  └─ output/                # 输出目录
  │     ├─ report/             # 生成的报告文件
  │     ├─ temp/               # 临时文件（上传的图片等）
  │     └─ logs/               # 日志文件
  ├─ src/                      # 前端源码
  │  ├─ index.html             # 主页面
  │  ├─ styles.css             # 全局样式表
  │  └─ js/                    # 前端模块化脚本
  │     ├─ api.js              # API 交互模块
  │     ├─ utils.js            # 通用工具函数
  │     ├─ main.js             # 主逻辑入口
  ├─ docs/                     # 项目文档
  │  ├─ DEPLOYMENT_GUIDE.md    # 部署指南
  │  ├─ TEMPLATE_DEV_GUIDE.md  # 模板开发指南
  │  └─ TEMPLATE_QUICK_START.md# 快速入门
  ├─ main.js                   # Electron 主进程入口
  ├─ preload.js                # Electron 预加载脚本
  ├─ package.json              # Node.js 项目配置
  ├─ TEMPLATE_DEV_GUIDE.md     # 模板开发指南 (详细)
  ├─ TEMPLATE_QUICK_START.md   # 模板快速入门 (新手)
  ├─ DEPLOYMENT_GUIDE.md       # 部署与运维指南
  └─ dist/                     # 打包输出目录
```

## 功能特性

### 1. 动态模板系统 (安全加固版)
- **插件化架构**：每个模板完全独立（Schema + Handler），支持热插拔
- **动态加载**：放入新模板文件夹即可自动识别，无需重启
- **安全沙箱机制**：
  - **依赖白名单**：严格控制模板可调用的 Python 库，防止供应链攻击
  - **路由隔离**：模板 API 强制挂载于独立命名空间 `/api/plugin/{id}/`
  - **路径防御**：增强的路径遍历检查，防止文件越权访问
  - **代码加载防护**：基于安全规范的 Handler 动态加载机制
- **热加载支持**：修改模板逻辑后调用接口即可即时生效
- **依赖管理**：模板可声明 Python 包依赖，系统自动检查并拦截未授权依赖
- **自定义路由**：模板可定义专属 API 接口（Router）
- **动态表单**：根据 schema.yaml 自动生成前端表单

### 2. 风险隐患报告生成
- **智能信息获取**：自动解析 URL 获取 ICP 备案、域名及 IP 信息
- **截图管理升级**：
  - 支持多张漏洞截图上传
  - 支持粘贴截图（Ctrl+V）
  - 大图 Lightbox 预览
  - 自定义图片说明文字
- **快捷操作**：
  - `Ctrl+Enter` 快速生成报告
  - `Esc` 关闭弹窗
- **自动编号**：报告编号支持自动生成（日期+序号）

### 3. 漏洞库管理
- **全功能管理**：内置漏洞知识库，支持新增、编辑、删除常见漏洞模板
- **字段扩展**：包含漏洞名称、分类、默认端口、风险等级、定级依据、描述、危害及修复建议
- **交互优化**：
  - 左侧列表支持实时搜索
  - 展示丰富信息（名称/分类/等级）
  - 可搜索下拉框，快速定位漏洞
- **自动填充**：选择漏洞后自动填充相关字段

### 4. ICP 备案信息库管理
- **数据库级操作**：支持对 ICP 备案信息的增、删、改、查
- **批量处理**：支持多选批量删除过期的备案记录
- **字段映射修复**：修正了性质与单位名称的显示映射
- **自动查询**：输入 URL 后自动查询并填充 ICP 信息

### 5. 高级工具箱
- **报告合并**：
  - 支持勾选多个已生成的 Word 报告进行合并
  - 自动生成带时间戳的合并文件名（防止重名覆盖）
  - 优化文件列表显示（增加修改时间和目录列）
- **数据备份**：支持一键导出全量数据库备份（.db 文件），保障数据安全
- **配置管理**：支持在前端界面直接修改并保存"技术支持单位"等常用配置，即时生效
- **批量清理**：支持对历史生成报告的批量删除
- **模板管理**：支持模板的导入、导出、删除和热加载

## 技术架构

### 前端技术栈
- **Electron**：跨平台桌面应用框架
- **原生 JavaScript**：模块化设计，无框架依赖
- **动态表单渲染**：基于 JSON Schema 的表单生成器

### 后端技术栈
- **FastAPI**：高性能 Python Web 框架
- **SQLite**：轻量级数据库（漏洞库、ICP 备案）
- **python-docx**：Word 文档生成与编辑
- **Pillow**：图片处理
- **PyInstaller**：Python 打包为独立可执行文件

### 核心特性
- **模板驱动**：基于 YAML 配置的可扩展模板系统
- **插件化架构**：每个模板可独立开发和部署
- **RESTful API**：前后端完全分离
- **日志系统**：完整的日志记录和错误追踪

## 要求
- Node.js >= 16
- Python 3.9+

## 开发（在本机运行）
推荐在 PowerShell（Windows）或 bash（macOS/Linux）下运行。

1. 安装前端依赖

```powershell
cd report_electron_app
npm install electron --save-dev
```

2. 安装后端依赖（建议使用虚拟环境）

```powershell
cd report_electron_app\backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1   # Windows PowerShell
pip install --upgrade pip
pip install -r requirements.txt
```

3. 在开发模式下启动后端（可选，`main.js` 启动时也会尝试启动后端）：

```powershell
cd report_electron_app\backend
uvicorn api:app --host 127.0.0.1 --port 8000 --reload
```

4. 在另一个终端启动 Electron

```powershell
cd report_electron_app
npm run start
```

> 注意：开发时 `main.js` 会尝试以 `python -m uvicorn api:app` 在 `backend` 目录启动后端。如果你更倾向于手工启动后端，上面第 3 步即可。

## 运行已打包的 App（Windows）
打包程序会将后端编译为一个独立可执行文件并放到 `resources/backend/dist`（相对资源路径），Electron 安装后会从资源中启动后端。

安装后直接运行安装生成的程序即可：`ReportGenX.exe`。

## 打包（本地）
项目已经集成 `electron-builder` 与 PyInstaller 的打包配置。下面给出本地构建（示例为 Windows）：

1. 编译 Python 后端为独立可执行（使用 PyInstaller）

```powershell
cd report_electron_app
pip install pyinstaller
pyinstaller -F backend/api.py --distpath backend/dist --workpath backend/build --specpath backend --name api --clean
```

生成后端可执行会位于 `report_electron_app/backend/dist/api.exe`（Windows）或 `.../api`（Linux/macOS）。

2. 运行 Electron 打包（electron-builder）

```powershell
cd report_electron_app
npm ci
npm run dist
```

构建产物放在 `report_electron_app/dist`，包含 `win-unpacked`（免安装版）与安装程序 `ReportGenX Setup x.y.z.exe`。

> 说明：
> - Windows 安装包使用 NSIS；macOS 使用 DMG；Linux 使用 AppImage（在对应平台上构建）。
> - 为了生成 Linux 的 AppImage，打包环境需要支持 `libfuse2` 等依赖（CI runner 通常可安装）。

## CI / GitHub Actions
仓库包含一个示例 Workflow（`.github/workflows/build.yml`），功能：

- 在 `v*` tag 推送时触发（也可手动触发）
- 在 Windows/macOS/Linux 三个平台上：
  - 安装 Python 依赖并用 PyInstaller 编译后端
  - 安装 Node 依赖并使用 electron-builder 构建应用
  - 将构建产物发布到 GitHub Releases（需要仓库的 `GITHUB_TOKEN` 权限）

如果在 CI 中遇到“操作被取消（The operation was canceled）”的问题，请参考：
- 将 `strategy.fail-fast` 设为 `false`，以便所有平台都能完成后再报告错误（已在模板中建议）。
- Linux 打包常见的问题是缺少 `libfuse2`，可以在 CI 中通过 `apt-get install -y libfuse2` 解决。

## 常见问题（FAQ）

### 1. 后端无法启动 / 找不到 Python
- 开发时确保 `python` 在 PATH 中并且系统默认指向可用的 Python 3 版本
- 打包后 `main.js` 会启动 `backend/dist/api.exe`（或 `api`），请确保文件存在并且可执行

### 2. 如何添加新的报告模板？
请参考以下文档：
- **[快速入门](TEMPLATE_QUICK_START.md)**：5分钟创建一个新模板
- **[开发指南](TEMPLATE_DEV_GUIDE.md)**：详细的 Schema 规范和 Handler 开发文档
- **[部署指南](DEPLOYMENT_GUIDE.md)**：如何在生产环境中管理模板

### 3. 数据库文件在哪里？
- 开发环境：`backend/data/combined.db`
- 打包后：`resources/backend/data/combined.db`

### 4. 如何备份数据？
在工具箱中点击"数据备份"按钮，会自动下载带时间戳的数据库备份文件。

### 5. 生成的报告保存在哪里？
- 开发环境：`backend/output/report/`
- 打包后：`resources/backend/output/report/`
- 可在工具箱中点击"打开报告目录"快速访问

### 6. 关闭应用后后端进程残留？
此问题已修复。修复方案：
- **Python 端**：`api.py` 使用 `workers=1` 确保单进程运行，避免 uvicorn 产生多个工作进程
- **Electron 端**：`main.js` 使用 `taskkill /T`（Windows）或 `SIGKILL`（Unix）杀死进程树，确保所有子进程被清理

如果仍遇到进程残留，可手动在任务管理器中结束 `api.exe` 进程。

### 7. macOS 首次运行提示"无法打开"？
由于应用未经 Apple 公证，macOS Gatekeeper 会阻止首次运行。解决方法：

1. **右键打开**：在 Finder 中右键点击应用 → 选择"打开" → 在弹窗中点击"打开"
2. **系统偏好设置**：打开"系统偏好设置" → "安全性与隐私" → 点击"仍要打开"
3. **命令行方式**（高级用户）：
   ```bash
   xattr -cr /Applications/ReportGenX.app
   ```

> 注意：这是未签名应用的正常行为，只需首次运行时操作一次。

## 贡献
欢迎提交 issue 或 pull request。请在 PR 描述中说明变更目的和测试步骤。

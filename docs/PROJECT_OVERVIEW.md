# PROJECT_OVERVIEW

> 面向接手开发者的快速上下文文档  
> 更新时间：2026-03-30  
> 仓库状态：已归档（只读）  
> 当前版本：0.18.3

## 1. 项目定位

`ReportGenX` 是一个 Electron + FastAPI 的桌面应用，用于生成安全报告与维护配套知识库。

核心能力：

- 模板驱动报告生成（`schema.yaml + handler.py`）
- 漏洞库管理（增删改查）
- ICP 信息管理（增删改查 + 批量删除）
- 报告列表、删除、合并
- 模板导入/导出/热加载

---

## 2. 技术栈与运行形态

### 前端

- 原生 HTML/CSS/JS（无 React/Vue）
- 入口：`src/index.html`
- 模块：`src/js/*.js`

### 桌面容器

- Electron 主进程：`main.js`
- Preload 桥接：`preload.js`

### 后端

- FastAPI：`backend/api.py`
- 核心逻辑：`backend/core/*`
- 插件运行时：`backend/plugin_host/runtime.py`
- 模板目录：`backend/templates/*`
- 数据库：`backend/data/combined.db`

---

## 3. 目录快速地图（常改文件）

- `main.js`：后端进程生命周期、启动握手、外链安全策略
- `preload.js`：将 `apiBaseUrl`/`appApiToken` 注入渲染层
- `src/js/api.js`：统一 API 调用与 token header 注入
- `src/js/form-renderer.js`：报告生成主流程
- `src/js/toolbox.js`：工具箱业务（系统设置/模板管理/报告合并等）
- `src/js/template-manager.js`：模板管理 UI 逻辑
- `src/js/vuln-manager.js`：漏洞库管理
- `src/js/crud-manager.js`：通用 CRUD 抽象
- `backend/api.py`：API 入口、中间件、路由
- `backend/core/template_manager.py`：模板扫描与依赖检查
- `backend/core/base_handler.py`：模板处理器生命周期
- `backend/shared-config.json`：server/security/paths/plugin_runtime 共享配置

---

## 4. 启动与通信链路（执行顺序）

1. Electron 启动 `main.js`
2. `main.js` 启动后端进程并注入 `APP_API_TOKEN`
3. 主进程调用 `GET /api/health-auth`（带 `X-App-Token`）验证令牌绑定
4. 验证通过后创建窗口并加载前端
5. `preload.js` 注入 `window.electronConfig` 与 `window.electronAPI`
6. 渲染层通过 `window.AppAPI` 与 FastAPI 通信
7. 生成报告请求进入 `PluginRuntime.execute()`，最终落盘并返回下载路径

---

## 5. 当前安全/运行时边界

`backend/api.py` 中的 `app_token_middleware` 规则：

- `/api/*` 的 `POST/PUT/PATCH/DELETE` 默认需要 `X-App-Token`
- 受保护 GET：
  - `/api/backup-db`
  - `/api/health-auth`
  - `/api/templates/{template_id}/export`
- `GET /api/health` 不鉴权（基础存活探针）

重要说明：

- 当前 `plugin_runtime` 配置接口为：
  - `GET /api/plugin-runtime-config`（读取）
  - `POST /api/plugin-runtime-config`（更新，受 token 保护）
- 当前没有管理员会话口令门禁（无 `admin-session` / `X-Admin-Session`）

---

## 6. 配置体系

### `backend/config.yaml`

- 业务配置（版本、风险等级、下拉选项等）
- 数据库路径（`vul_or_icp`）

### `backend/shared-config.json`

关键字段：

- `server.host/server.port`
- `security.external_protocols` / `security.external_hosts`
- `paths.open_folder_allowlist`
- `plugin_runtime.*`（mode、isolated 灰度、fallback、metrics 等）

---

## 7. 模板系统

每个模板目录：

- `backend/templates/<template_id>/schema.yaml`
- `backend/templates/<template_id>/handler.py`
- `backend/templates/<template_id>/template.docx`（可选）

运行机制：

- `TemplateManager` 负责扫描模板并加载 schema
- `PluginRuntime` 决定执行策略（descriptor/hybrid/legacy/isolated）
- `POST /api/templates/{id}/generate` 执行模板并生成报告

---

## 8. 验证与 CI

- 后端测试：`npm run test`
- Electron 冒烟：`npm run test:e2e:smoke`
- CI 冒烟工作流：`.github/workflows/ci-smoke.yml`

---

## 9. 接手建议（最短路径）

建议阅读顺序：

1. `README.md`
2. `main.js`、`preload.js`
3. `src/js/api.js`
4. `src/js/form-renderer.js`
5. `backend/api.py`
6. `backend/core/template_manager.py`
7. 任一模板目录（例如 `backend/templates/vuln_report/`）

高频改动入口：

- 新增字段/表单：改对应模板 `schema.yaml`
- 调整报告生成逻辑：改模板 `handler.py`
- 调整接口行为：改 `backend/api.py`
- 调整工具箱交互：改 `src/js/toolbox.js`

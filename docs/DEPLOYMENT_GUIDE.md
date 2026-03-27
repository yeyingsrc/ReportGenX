# 部署与运维指南

> 更新日期：2026-03-27

## 1. 部署模式

ReportGenX 当前推荐 **Electron 单机模式**（桌面应用 + 本地 FastAPI）。

- 目标场景：单机离线/内网终端使用
- 运行链路：Electron 主进程拉起本地后端，渲染层通过 `http://127.0.0.1:<port>` 调用 API

> 说明：文档中的“Web 服务化”只作为扩展方案参考。当前默认安全链路依赖 Electron 注入 `X-App-Token`，不适合作为通用开放 Web 服务直接暴露。

---

## 2. 环境要求

### 2.1 运行要求（桌面端）

- CPU：2 核及以上
- 内存：4GB 及以上
- 磁盘：至少 500MB 可用空间（报告与日志）

### 2.2 开发要求

- Node.js >= 16
- Python >= 3.9

---

## 3. 本地开发运行

1. 安装前端依赖

```bash
npm install
```

2. 安装后端依赖

```bash
cd backend
pip install -r requirements.txt
```

3. 启动后端（可选，Electron 启动时也会尝试拉起）

```bash
cd backend
uvicorn api:app --host 127.0.0.1 --port 8000 --reload
```

4. 启动 Electron

```bash
npm run start
```

---

## 4. 打包发布

### 4.1 构建 Python 后端可执行

```bash
pyinstaller --noconfirm backend/api.spec
```

### 4.2 构建 Electron 安装包

```bash
npm run dist
```

常用目标：

- Windows x64：`npm run dist -- --win --x64`
- macOS ARM：`npm run dist -- --mac --arm64`

---

## 5. 运行时安全边界（必须知晓）

## 5.1 Token 策略

后端 `app_token_middleware` 当前规则：

- `/api/*` 的 `POST/PUT/PATCH/DELETE` 默认要求 `X-App-Token`
- 受保护 GET：
  - `/api/backup-db`
  - `/api/health-auth`
  - `/api/templates/{template_id}/export`
- `GET /api/health` 不鉴权（基础存活探针）

## 5.2 启动握手

Electron 主进程会在开窗前调用 `GET /api/health-auth`（带 `X-App-Token`）：

- 返回 200：继续启动
- 返回 403：视为“端口已有旧后端实例且 token 不匹配”，直接退出并提示

这用于防止“前端连到旧后端”引发随机 `Invalid application token`。

## 5.3 runtime 配置接口

- `GET /api/plugin-runtime-config`：读取
- `POST /api/plugin-runtime-config`：更新（token 保护）

说明：当前不使用管理员会话认证（无 `admin-session`/`X-Admin-Session`）。

---

## 6. CI 与发布前检查

## 6.1 本地发布前检查

```bash
npm run test
npm run test:e2e:smoke
```

## 6.2 CI 冒烟

仓库提供 `.github/workflows/ci-smoke.yml`，在 Ubuntu 上执行：

1. 安装 Python/Node 依赖
2. 运行后端单元测试
3. 通过 `xvfb-run` 执行 Electron 冒烟

---

## 7. 运维操作建议

## 7.1 模板更新

1. 将模板目录放入 `backend/templates/`
2. 调用 `POST /api/templates/reload` 热加载
3. 若新增模板自定义路由，重启应用后生效

## 7.2 备份建议

建议定期备份：

- `backend/data/combined.db`
- `backend/config.yaml`
- `backend/shared-config.json`
- `backend/templates/`

## 7.3 常见故障

- `Invalid application token`：通常是旧后端残留；完全退出应用后重启
- 启动即失败且提示 token mismatch：结束占用端口的旧后端进程后重启
- runtime 配置保存 403：检查渲染层是否注入 `window.electronConfig.appApiToken`

---

## 8. 参考文档

- `docs/RUNTIME_OPERATIONS_RUNBOOK.md`
- `docs/ARCHITECTURE_LAYER_FLOW_ANALYSIS.md`
- `docs/TEMPLATE_DEV_GUIDE.md`
- `docs/TEMPLATE_QUICK_START.md`

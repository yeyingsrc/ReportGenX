# ReportGenX 运行手册（Token/Health/Runtime）

## 1. 目的

本手册用于统一说明当前运行时安全边界、健康检查方式、`plugin_runtime` 配置操作与常见故障排查步骤。

---

## 2. Token 保护规则（当前实现）

后端在 `backend/api.py` 的 `app_token_middleware` 中执行 `X-App-Token` 校验：

- **默认规则**：`/api/*` 的 `POST/PUT/PATCH/DELETE` 全部需要 token。
- **受保护 GET**：
  - `/api/backup-db`
  - `/api/health-auth`
  - `/api/templates/{template_id}/export`
- **非受保护健康检查**：`GET /api/health`（用于基础存活检查，不含 token 校验）

说明：`plugin_runtime` 配置接口中，`GET /api/plugin-runtime-config` 当前为可读，`POST /api/plugin-runtime-config` 受 token 保护；当前不使用管理员会话认证（无 `admin-session` / `X-Admin-Session`）。

---

## 3. 启动握手与令牌一致性

Electron 主进程在启动后端后会调用 `GET /api/health-auth`（带 `X-App-Token`）确认令牌绑定一致：

- 一致：继续启动窗口。
- 不一致（403）：提示“端口上已有其他后端实例（令牌不匹配）”，并退出应用。

这可以避免“前端连接到旧后端进程”导致的随机 `Invalid application token` 错误。

---

## 4. runtime 设置操作规范

UI 路径：`工具箱 -> 系统设置 -> 运行时高级设置`

建议流程：

1. 先执行数据库备份。
2. `isolated_rollout_percent` 从 `5%` 小流量开始。
3. 观察日志后逐步提升到 `25%/50%/100%`。
4. 每次调整后保存并进行一次最小功能回归（模板生成/报告合并）。

关键字段：

- `mode`：`descriptor | hybrid | legacy | isolated`
- `subprocess_strategy`：isolated 子进程策略
- `subprocess_timeout_seconds`：isolated 子进程超时
- `isolated_*`：白名单/黑名单/灰度
- `metrics_emit_every_n`：指标采样频率

---

## 5. 常见故障排查

## 5.1 错误：`Invalid application token`

排查顺序：

1. 完全退出应用（包含后台进程）。
2. 确认无残留 Python/Uvicorn 进程占用 `127.0.0.1:8000`。
3. 重新启动应用。
4. 若仍异常，检查启动日志是否有 `GET /api/health-auth ... 200`。

## 5.2 错误：`检测到后端令牌不一致...`

这通常是端口上已有旧后端实例导致。

处理：

1. 关闭所有 ReportGenX 窗口。
2. 结束旧 Python 后端进程。
3. 再次启动应用。

## 5.3 runtime 配置保存失败（403）

说明请求未携带有效 token，需检查：

- 渲染层 `window.electronConfig.appApiToken` 是否注入成功。
- `AppAPI._buildAuthHeaders()` 是否包含 `X-App-Token`。

---

## 6. 回归检查清单（发布前）

1. 应用启动后 `health-auth` 返回 200。
2. `工具箱 -> 报告合并` 可正常列出报告并执行合并。
3. `工具箱 -> 系统设置` 可读取并保存 runtime 配置。
4. 执行：
   - `npm run test`
   - `npm run test:e2e:smoke`

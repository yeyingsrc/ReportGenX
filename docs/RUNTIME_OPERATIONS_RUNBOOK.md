# ReportGenX 运行手册（Token / Health / Runtime）

## 1. 目的

本手册统一说明运行时安全边界、健康检查方式、`plugin_runtime` 完整配置参考、以及常见故障排查。

---

## 2. Token 保护规则（当前实现）

后端 `backend/api.py` 的 `app_token_middleware` 中执行 `X-App-Token` 校验：

- **默认规则**：`/api/*` 的 `POST/PUT/PATCH/DELETE` 全部需要 token。
- **受保护 GET**：
  - `/api/backup-db`
  - `/api/health-auth`
  - `/api/templates/{template_id}/export`
- **非受保护健康检查**：`GET /api/health`（基础存活检查，不含 token 校验）

说明：`plugin_runtime` 配置接口中，`GET /api/plugin-runtime-config` 可读，`POST /api/plugin-runtime-config` 受 token 保护；当前不使用管理员会话认证（无 `admin-session` / `X-Admin-Session`）。

---

## 3. 启动握手与令牌一致性

Electron 主进程在启动后端后会调用 `GET /api/health-auth`（带 `X-App-Token`）确认令牌绑定一致：

- 一致：继续启动窗口。
- 不一致（403）：提示"端口上已有其他后端实例（令牌不匹配）"，并退出应用。

这可以避免"前端连接到旧后端进程"导致的随机 `Invalid application token` 错误。

---

## 4. plugin_runtime 配置完整参考

配置文件：`backend/shared-config.json` → `plugin_runtime` 块。

UI 路径：`工具箱 → 系统设置 → 运行时高级设置`

### 4.1 全部 11 个配置键

| 键 | 默认值 | 允许值 | 说明 |
|---|---|---|---|
| `mode` | `"hybrid"` | `"descriptor"`, `"hybrid"`, `"legacy"`, `"isolated"` | 全局模板执行模式 |
| `use_legacy_core_alias` | `false` | `true` / `false` | 启用 `core.xxx → backend.core.xxx` 别名回退（兼容旧模板） |
| `force_legacy_templates` | `[]` | 模板 ID 数组 | **优先于 `mode`**：名单中的模板强制使用 legacy 执行 |
| `subprocess_strategy` | `"hybrid"` | string | isolated 子进程执行策略 |
| `subprocess_timeout_seconds` | `120` | 1–600 | isolated 模式子进程超时（秒），超时后终止 |
| `isolated_enabled_templates` | `[]` | 模板 ID 数组 | **白名单**：仅允许这些模板使用 isolated 模式（空 = 全部允许） |
| `isolated_disabled_templates` | `[]` | 模板 ID 数组 | **黑名单**：这些模板永不使用 isolated 模式（优先级高于白名单） |
| `isolated_rollout_percent` | `0` | 0–100 | 全局灰度百分比，≥ 100 时全部 isolated，≤ 0 时全部不进 isolated |
| `isolated_template_rollout` | `{}` | `{"template_id": percent}` | 按模板覆盖灰度百分比 |
| `isolated_fallback_mode` | `"descriptor"` | `"descriptor"`, `"hybrid"`, `"legacy"` | isolated 被跳过时的回退执行模式 |
| `metrics_emit_every_n` | `50` | ≥ 1 整数 | 每执行 N 次输出一次汇聚指标到日志 |

### 4.2 执行模式详解

#### `force_legacy_templates` 与 `mode` 的交互（重要）

```
请求 → [检查 force_legacy_templates]
          ├── 命中 → 直接 legacy 执行（忽略 mode 和 rollout）
          └── 未命中 → 按 mode 执行:
                         ├── legacy    → HandlerRegistry
                         ├── descriptor → PLUGIN descriptor
                         ├── hybrid     → PLUGIN 优先, 失败回退 legacy
                         └── isolated   → 检查 _should_use_isolated_mode()
                                          ├── 是 → 子进程执行
                                          └── 否 → isolated_fallback_mode
```

#### Isolated 灰度算法 (`_should_use_isolated_mode()`)

1. 检查 `isolated_disabled_templates` → 命中则跳过
2. 检查 `isolated_enabled_templates` → 非空且未命中则跳过
3. 确定灰度百分比：`isolated_template_rollout[template_id]` → `isolated_rollout_percent` → 0
4. 比较：`zlib.crc32(template_id.encode()) % 10000 / 100.0 < rollout_percent`
5. 结果决定是否进入 isolated 子进程执行

---

## 5. runtime 设置操作建议

建议流程：

1. 先执行数据库备份（`工具箱 → 系统设置 → 备份数据库`）。
2. `isolated_rollout_percent` 从 `5%` 小流量开始。
3. 观察日志后逐步提升到 `25%/50%/100%`。
4. 白名单控制：先用 `isolated_enabled_templates` 限定 1 个模板测试，确认无误后删除白名单开放。
5. 黑名单兜底：将已知不兼容的模板加入 `isolated_disabled_templates`。
6. 每次调整后保存并进行一次最小功能回归（模板生成/报告合并）。

---

## 6. 常见故障排查

### 6.1 错误：`Invalid application token`

排查顺序：

1. 完全退出应用（包含后台进程）。
2. 确认无残留 Python/Uvicorn 进程占用 `127.0.0.1:8000`。
3. 重新启动应用。
4. 若仍异常，检查启动日志是否有 `GET /api/health-auth ... 200`。

### 6.2 错误：`检测到后端令牌不一致...`

这通常是端口上已有旧后端实例导致。

处理：

1. 关闭所有 ReportGenX 窗口。
2. 结束旧 Python 后端进程。
3. 再次启动应用。

### 6.3 runtime 配置保存失败（403）

说明请求未携带有效 token，需检查：

- 渲染层 `window.electronConfig.appApiToken` 是否注入成功。
- `AppAPI._buildAuthHeaders()` 是否包含 `X-App-Token`。

### 6.4 模板执行模式不生效

1. 确认目标模板 ID 不在 `force_legacy_templates` 中
2. 确认 `mode` 设置正确（`hybrid` 会优先 descriptor，找不到 PLUGIN 才 fallback）
3. `isolated` 模式：确认灰度百分比 > 0 且模板不在 `isolated_disabled_templates` 中
4. 调用 `POST /api/templates/reload` 热加载后再试

---

## 7. 回归检查清单（发布前）

1. 应用启动后 `health-auth` 返回 200。
2. `工具箱 → 报告合并` 可正常列出报告并执行合并。
3. `工具箱 → 系统设置` 可读取并保存 runtime 配置。
4. 执行 `npm run test:e2e:smoke`。

> **注**：`npm run test` 对应的后端单元测试已移除，当前为空操作。

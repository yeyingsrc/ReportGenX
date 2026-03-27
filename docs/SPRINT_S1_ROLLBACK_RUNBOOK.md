# Sprint S1 回滚 Runbook

本 Runbook 用于安全边界、发布门禁和后端路由首批拆分后的快速回滚。

> 说明：该文档是 S1 阶段回滚预案。当前运行时 token 与 `plugin_runtime` 策略请优先参考 `docs/RUNTIME_OPERATIONS_RUNBOOK.md`。

## 1. 触发条件

- 发布后出现核心 API 不可用（`/api/config`、`/api/vulnerabilities`、`/api/icp-list`）
- 发现外链策略误拦截导致业务不可用
- 版本门禁误判导致发布阻断

## 2. 目标

- **30 分钟内**恢复到上一个可用版本
- 保留故障现场日志用于复盘

## 3. 回滚步骤

### Step A：冻结变更

1. 暂停当前发布流水线。
2. 通知团队进入回滚窗口，停止继续合并到发布分支。

### Step B：恢复应用产物

1. 使用上一稳定 tag 的安装包/产物覆盖当前部署。
2. 确认 Electron 主进程和后端进程版本一致。

### Step C：恢复配置

1. 还原 `backend/shared-config.json` 与 `backend/config.yaml` 到上一稳定版本。
2. 运行：

```bash
npm run check-version
```

确认版本一致性恢复。

### Step D：功能核验

最小核验清单：

1. `/api/config` 返回 200
2. `/api/version` 返回 `is_synced=true`
3. `/api/vulnerabilities` 返回列表
4. `/api/open-folder` 对默认路径可用
5. 前端页面可完成模板加载和报告生成入口初始化

### Step E：恢复发布通道

1. 回滚版本通过冒烟后，恢复发布通道。
2. 将故障版本标记为 blocked，禁止再次发布。

## 4. 应急开关（Feature Flags）

- `STRICT_PATH_GUARD=false`：回退 open-folder 严格路径保护（仅限应急）
- `STRICT_EXTERNAL=false`：回退 open-external 白名单拦截（仅限应急）
- `LEGACY_ERROR_MODE=true`：回退到旧异常响应策略

> 注意：应急开关仅用于短时恢复，恢复后必须在 24h 内完成根因修复。

## 5. 复盘输出要求

- 事故时间线（发现、止血、恢复）
- 触发根因（代码、配置、流程）
- 缺失的预防用例与门禁补充项
- 下个 Sprint 的修复项和负责人

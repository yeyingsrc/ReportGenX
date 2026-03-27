# 插件独立化分阶段实施方案（内部执行版）

> 状态：执行基线文档（Single Source of Truth）  
> 适用范围：本仓库后续“插件完全独立化”改造  
> 使用方式：后续会话优先读取本文件推进，不依赖长上下文
> ⚠️ 说明：本文是“插件独立化改造”的阶段执行与回滚基线，不等同当前默认发布配置。当前运行时规则请以 `docs/RUNTIME_OPERATIONS_RUNBOOK.md` 为准。

---

## 0. 文档目的（为什么先做这份文档）

为避免会话上下文过长导致后续实现丢失信息，本文件作为**唯一执行基线**，约束后续改造按阶段推进、可验证、可回滚。

后续 Agent 进入任务时，默认流程：

1. 先读取本文件；
2. 仅执行当前阶段 `Next` 段落；
3. 每完成一项，更新本文件第 11 节“进度看板”；
4. 每阶段结束按第 7 节“验收命令”验证。

### 0.1 当前活动状态（每次交接先看这里）

- 当前阶段：Phase C（已完成）
- 当前任务：收口验收与观察
- 运行模式目标：`plugin_runtime.mode=descriptor`（legacy 保留应急回滚）
- 最近一次验证：Post-C 回滚演练通过（`python backend/scripts/plugin_runtime_rollback_drill.py`：descriptor/legacy/hybrid+force/extreme-rollback 全通过）
- Next Action：进入 Phase C 完成后观察（按需执行回滚演练）

---

## 1. 当前基线（已确认事实）

### 1.1 当前耦合事实

1. 模板 `handler.py` 强依赖 `core.*`（`base_handler / handler_utils / document_editor / logger` 等）。
2. `backend/api.py` 存在 `_ensure_legacy_core_import_aliases()`，通过 `sys.modules` 将 `core.*` 映射到 `backend.core.*`，用于维持运行。
3. `backend/core/template_manager.py` 通过 `importlib.util.spec_from_file_location(...).exec_module(...)` 进程内动态加载模板 handler，并依赖 `@register_handler` 副作用注册到全局 `HandlerRegistry`。
4. 模板安全审计白名单明确放行 `core` 顶级模块，不放行 `backend` 顶级模块。
5. 前端是 schema 驱动（`src/js/form-renderer.js` + `src/js/api.js`），不要求与插件执行模型强绑定。

### 1.2 已有文档

- 大设计文档：`docs/PLUGIN_ISOLATION_ARCHITECTURE.md`
- 本文件定位：**可执行落地计划**（按步骤改代码+验收）

---

## 2. 目标定义（本轮重构目标）

### 2.1 目标（必须达到）

1. 插件开发面向稳定 SDK 命名空间（`core/`），不再依赖宿主内部命名空间。
2. 运行时支持 Hybrid（新旧并存）：
   - 新模板可走 descriptor（`PLUGIN` 导出）
   - 旧模板继续走 decorator + `HandlerRegistry`
3. 保持现有 API 与前端行为不变（无大爆炸重写）。
4. 每步具备回滚开关。

### 2.2 非目标（当前阶段不做）

1. 不在本阶段做“插件进程隔离（子进程 RPC）”。
2. 不在本阶段重写前端表单系统。
3. 不在本阶段强制迁移全部模板。

---

## 3. 迁移策略（Strangler + 双轨运行）

采用“宿主兼容层 + 插件 SDK + 渐进替换”策略：

1. 先建立稳定公开层（`core/` SDK 包装层）；
2. 新建运行编排层（`backend/plugin_host/runtime.py`）；
3. 让 API 通过 Runtime 统一调用，但默认保持 Legacy 可回退；
4. 按模板逐个迁移，最终再删除 alias 与全局注册依赖。

---

## 4. 阶段拆分（可直接执行）

## Phase A（当前先做）：兼容基础设施

> 目标：在不破坏现有模板的前提下，建立新执行骨架与回滚能力。

### A1. 建立 `core/` 公共 SDK 命名空间（包装层）

**文件范围（新增）**

- `core/__init__.py`
- `core/base_handler.py`
- `core/handler_utils.py`
- `core/document_editor.py`
- `core/document_image_processor.py`
- `core/logger.py`
- `core/summary_generator.py`
- `core/template_manager.py`（仅兼容导出，标注 deprecated）
- `backend/tests/test_core_sdk_import_compat.py`（新增）

**做法**

1. 每个模块只做安全 re-export（来自 `backend.core.*`）。
2. 在 docstring 明确“这是插件 SDK 公开 API，非宿主私有逻辑”。
3. 不改变既有业务逻辑。
4. 增加最小 import smoke test，覆盖 `core.*` 可导入。

**完成标准**

- 模板 `from core.xxx import ...` 在 dev 运行可直接解析（不依赖 alias）。
- `backend/tests/test_core_sdk_import_compat.py` 通过。

---

### A2. 引入 `backend/plugin_host/runtime.py`

**文件范围（新增）**

- `backend/plugin_host/__init__.py`
- `backend/plugin_host/runtime.py`

**做法**

1. 定义 `PluginRuntime.execute(template_id, data, output_dir, template_manager, config)`。
2. 执行顺序：
   - 优先 descriptor 模式（若模板模块导出 `PLUGIN` 且可执行）
   - 否则回退 legacy 模式（`HandlerRegistry.get_handler(...).run(...)`）
3. 返回格式与现有 API 兼容（`success/report_path/message/errors`）。

**完成标准**

- 不改前端、不改 API 合约，仅替换 API 内部调用路径即可跑通旧模板。

---

### A3. API 接入 Runtime + 保留 alias 回退

**文件范围（修改）**

- `backend/api.py`

**做法**

1. 在生成报告路径中调用 `PluginRuntime.execute(...)`。
2. `_ensure_legacy_core_import_aliases()` 改为“fallback-only”：
   - 优先使用真实 `core/` 包；
   - 若不可用，再启用 `sys.modules` alias。
3. 在配置层接入回滚开关（`backend/shared-config.json` + `backend/api.py` 读取）：
   - `plugin_runtime.mode`
   - `plugin_runtime.use_legacy_core_alias`
   - `plugin_runtime.force_legacy_templates`
4. 保留现有行为与日志格式，避免 API 行为漂移。

**完成标准**

- `/api/templates/{id}/generate` 对现有模板行为不变。
- 回滚演练通过：
  - `mode=legacy` 能强制走 legacy 路径
  - `mode=hybrid` 能优先 descriptor 再 fallback
  - `force_legacy_templates` 对指定模板生效

---

### A4. 回归测试（最小但关键）

**文件范围（新增/修改）**

- `backend/tests/test_plugin_runtime_hybrid.py`（新增）
- `backend/tests/test_template_handler_registration.py`（按需扩展）

**必须覆盖**

1. 旧模板（decorator 注册）仍可生成。
2. descriptor 模式模板（可用测试桩）可执行。
3. legacy fallback 开关可生效。

---

## Phase B：模板逐个迁移（不在本次立即全做）

迁移顺序建议：

1. `intrusion_report`（优先，耦合点更集中）
2. `vuln_report`
3. `penetration_test`
4. `Attack_Defense`

每个模板迁移都要满足：

- 不直接依赖宿主内部对象（不新增 `backend.*` 依赖）
- 能在 Runtime descriptor 路径执行
- 单模板可独立回滚

---

## Phase C：去遗留（收口）

1. [x] C1：移除 alias 主路径（默认关闭 `use_legacy_core_alias`，仅保留显式应急回滚）；
2. [x] C2：弱化/替代全局 `HandlerRegistry`；
3. [x] C3：将 legacy 模式改为默认关闭（保留短期应急开关）。

---

## 5. 回滚开关设计（必须实现）

建议新增 shared config 字段（可放 `backend/shared-config.json`，由 API 读取）：

```json
{
  "plugin_runtime": {
    "mode": "descriptor",
    "use_legacy_core_alias": false,
    "force_legacy_templates": []
  }
}
```

字段说明：

- `mode`: `legacy | hybrid | descriptor`
- `use_legacy_core_alias`: 是否启用 `sys.modules` 别名兜底
- `force_legacy_templates`: 模板级强制走 legacy 执行

回滚策略：

1. 全局回滚：`mode=legacy`
2. 部分回滚：把异常模板加入 `force_legacy_templates`
3. 极端回滚：`use_legacy_core_alias=true` + `mode=legacy`

### 5.1 落地归属（避免后续扯皮）

- 配置定义文件：`backend/shared-config.json`
- 配置读取入口：`backend/api.py` 的 shared config 读取流程
- 执行决策入口：`backend/plugin_host/runtime.py`
- 模板强制回退决策点：`PluginRuntime.execute(...)`

### 5.2 回滚演练（每次 A3/A4 改动后必须跑）

1. 将 `mode` 设为 `legacy`，验证现有模板全部可生成。
2. 将 `mode` 设为 `hybrid`，验证 legacy 模板依旧可生成。
3. 将某模板加入 `force_legacy_templates`，验证该模板确实走 legacy。
4. 恢复默认配置，复测一次生成接口。

推荐自动化命令（Post-C）：

```bash
python backend/scripts/plugin_runtime_rollback_drill.py
```

通过信号：4 个场景全部 `PASS`，且脚本执行后 `backend/shared-config.json` 恢复到原始配置。

---

## 6. 风险与防线

### 风险 R1：SDK 包新增后 PyInstaller 漏打包

- 防线：更新 `backend/api.spec` hiddenimports；打包后跑 generate 烟测。

### 风险 R2：descriptor 与 legacy 共存时行为差异

- 防线：同一模板 AB 对比测试（输出成功标记+错误信息一致性）。

### 风险 R3：回滚路径不可用

- 防线：每次改动都执行“强制 legacy 模式”回归测试。

### 风险 R4：迁移中前端联调被误伤

- 防线：不改 API contract，前端只做黑盒回归。

---

## 7. 每阶段验收命令（执行必跑）

### A1 验收（SDK 包装层）

```bash
python -m unittest backend.tests.test_core_sdk_import_compat
python -m compileall backend
```

通过信号：`core.*` import 相关测试通过，编译无错误。

### A2 验收（Runtime 引入）

```bash
python -m unittest backend.tests.test_plugin_runtime_hybrid
python -m compileall backend
```

通过信号：descriptor/legacy 选择逻辑测试通过。

### A3 验收（API 接入 + 回滚开关）

```bash
npm test
python -m compileall backend
```

通过信号：API 相关测试通过，且第 5.2 节回滚演练三步通过。

### A4 验收（阶段收口）

```bash
npm run check-version
npm test
pyinstaller --noconfirm api.spec   # 在 backend/ 目录执行
```

通过信号：版本校验、回归测试、打包均通过。

打包后追加烟测：

1. 启动打包后端 `api.exe`
2. 调用 `/api/templates`
3. 调用 `/api/templates/{id}/generate`
4. 日志中不得出现：
   - `No handler registered for template`
   - `No module named ...`
   - `default-header/default-footer` 相关 `FileNotFoundError`

---

## 8. 执行边界（防止跑偏）

1. 不做大范围目录重排。
2. 不在 Phase A 删除 legacy 逻辑。
3. 不在 Phase A 修改前端协议。
4. 不在未提供回滚开关前切换默认执行模式。

---

## 9. 会话接力模板（后续直接复制使用）

### 9.1 下一位 Agent 启动提示词模板

```text
请读取 docs/PLUGIN_ISOLATION_PHASE_EXECUTION_PLAN.md，严格按当前 Next Action 执行。
当前阶段：<填写 Phase-Ax>
当前任务：<填写任务编号>
已完成：<填写清单>
未完成：<填写清单>
请只做当前任务最小改动，并在完成后更新第11节进度看板。
```

### 9.2 每次结束时必须更新的信息

1. 改动文件列表
2. 验证命令与结果
3. 是否触发回滚开关
4. 下一个 `Next Action`

---

## 10. 下一步（当前默认执行点）

> **Next Action = Post-C**：周期性执行观察期回归与回滚演练（`python backend/scripts/plugin_runtime_rollback_drill.py`），确认生产环境无回归后再规划下一阶段。

Phase C 已完成，当前无新的结构性改造任务。

---

## 11. 进度看板（必须维护）

### 11.1 阶段状态

- [x] A1 `core/` SDK 包装层
- [x] A2 `plugin_host/runtime.py` 引入
- [x] A3 API 接入 Runtime + alias fallback-only
- [x] A4 Hybrid 回归测试
- [x] B 模板逐个迁移
- [x] C 遗留收口

### 11.1.1 Phase C 子项状态

- [x] C1 alias 主路径收口（默认关闭 + 显式应急开关）
- [x] C2 `HandlerRegistry` 依赖弱化/替代
- [x] C3 legacy 默认关闭评估与灰度

### 11.2 当前状态快照（每次必须更新）

- 当前阶段：Phase C（已完成）
- 当前任务：收口验收与观察
- 当前模式：`descriptor`（legacy 回滚开关保留）
- 最后验证：Post-C 回滚演练通过（`python backend/scripts/plugin_runtime_rollback_drill.py` 4/4 PASS）
- Next：进入 Post-C 观察期（按需回滚演练）

### 11.3 执行日志（追加，不覆盖）

| 日期 | 执行者 | 完成项 | 验证结果 | 是否触发回滚 | Next |
|---|---|---|---|---|---|
| 2026-03-23 | Hephaestus | 创建执行基线文档 | 文档结构完整 | 否 | A1 |
| 2026-03-23 | Hephaestus | 根据 Oracle 反馈完善文档可执行性 | 修复章节引用、补阶段验收、补回滚演练、改为追加日志 | 否 | A1 |
| 2026-03-23 | Hephaestus | 完成 A1 `core/` SDK 包装层与 import smoke test | `backend.tests.test_core_sdk_import_compat` 通过；`compileall backend` 通过 | 否 | A2 |
| 2026-03-23 | Hephaestus | 完成 A2 `plugin_host/runtime.py` 与 Hybrid 选择逻辑测试 | `backend.tests.test_plugin_runtime_hybrid` 通过；`compileall backend` 通过 | 否 | A3 |
| 2026-03-23 | Hephaestus | 完成 A3 API 接入 Runtime + alias fallback-only + 回滚开关配置落地 | `npm test` 通过（含 runtime mode/force_legacy 分支）；`compileall backend` 通过 | 否 | A4 |
| 2026-03-23 | Hephaestus | 完成 A4 阶段收口验证与打包后端烟测 | `check-version` 通过；`npm test` 22/22；`pyinstaller` 成功；`api.exe` 烟测 `/api/templates` 与 `/generate` 返回 200，未出现关键错误日志 | 否 | Phase B |
| 2026-03-23 | Hephaestus | 完成 B1 `intrusion_report` descriptor 迁移（保留 legacy 兼容） | `backend.tests.test_plugin_runtime_hybrid` 新增 intrusion_report descriptor 用例通过；`compileall backend` 通过 | 否 | B2 |
| 2026-03-24 | Hephaestus | 完成 B2 `vuln_report` descriptor 迁移（保留 legacy 兼容） | `backend.tests.test_plugin_runtime_hybrid` 新增 vuln_report descriptor + force_legacy 用例通过；`compileall backend` 与 `npm test` 通过 | 否 | B3 |
| 2026-03-24 | Hephaestus | 完成 B3 `penetration_test` descriptor 迁移（保留 legacy 兼容） | `backend.tests.test_plugin_runtime_hybrid` 新增 penetration_test descriptor + force_legacy 用例通过；`compileall backend` 与 `npm test` 通过 | 否 | B4 |
| 2026-03-24 | Hephaestus | 完成 B4 `Attack_Defense` descriptor 迁移（保留 legacy 兼容） | `backend.tests.test_plugin_runtime_hybrid` 新增 Attack_Defense descriptor + force_legacy + real-constructor 用例通过；`compileall backend` 与 `npm test` 通过 | 否 | Phase C |
| 2026-03-24 | Hephaestus | 完成 Phase B 覆盖补强（intrusion/vuln real-constructor + Attack_Defense hybrid 优先） | `backend.tests.test_plugin_runtime_hybrid` 34 用例通过；`compileall backend` 与 `npm test` 通过 | 否 | Phase C |
| 2026-03-25 | Hephaestus | 完成 C1 alias 主路径收口（默认关闭 alias，保留显式回滚开关）并补充策略测试 | `backend.tests.test_core_alias_policy` 通过；`backend.tests.test_plugin_runtime_hybrid` 通过；`compileall backend` 通过；`npm test` 38/38；`check-version` 通过 | 否 | C2 |
| 2026-03-25 | Hephaestus | 完成 C2 `HandlerRegistry` 依赖弱化（runtime 增加 `LEGACY_HANDLER` 直连路径，registry 保留兜底） | `backend.tests.test_plugin_runtime_hybrid` 20 用例通过（新增 module-legacy fallback）；`backend.tests.test_core_alias_policy` 通过；`compileall backend` 通过；`npm test` 41/41；`check-version` 通过 | 否 | C3 |
| 2026-03-25 | Hephaestus | 完成 C3 legacy 默认关闭（默认 `mode=descriptor`）并补齐打包 hiddenimports（SDK 包装层 + `backend.plugin_host.runtime`） | `backend.tests.test_plugin_runtime_hybrid` 21 用例通过；`backend.tests.test_core_alias_policy` 通过；`backend.tests.test_core_sdk_import_compat` 通过；`compileall backend` 通过；`npm test` 42/42；`check-version` 通过；`pyinstaller` 成功；`backend/dist/api/api.exe` 烟测 `/api/templates` 与 `/generate` 返回 200，未出现 `No handler registered`/`No module named`/`FileNotFoundError` | 否 | Post-C |
| 2026-03-25 | Hephaestus | 完成 Post-C 自动回滚演练脚本并执行 4 场景验收 | `python backend/scripts/plugin_runtime_rollback_drill.py` 通过：descriptor-default / legacy-global-rollback / hybrid-force-legacy-template / extreme-rollback-alias-legacy 均 200 且无关键错误；脚本结束后配置自动恢复 | 否 | Post-C 观察 |
| 2026-03-25 | Hephaestus | 将 rollback drill 接入 Release CI 前置检查（Build Python Backend 后执行） | `.github/workflows/release.yml` 新增 `Rollback drill (packaged backend)` 步骤；脚本支持 `api.exe/api` 自动识别，跨平台打包产物可复用 | 否 | Post-C 观察 |

---

## 12. 说明

本文件是“上下文压缩友好”的执行文档；后续实现以此为准。  
如与 `docs/PLUGIN_ISOLATION_ARCHITECTURE.md` 有冲突，以“**可落地、可回滚、可验证**”优先，先更新本文件再动代码。

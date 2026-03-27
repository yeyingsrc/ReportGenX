# 插件完全自包含架构方案 v3

> 创建日期: 2026-02-26
> 更新日期: 2026-02-27
> 状态: 设计中（未来方案，非当前实现）
> 目标: 服务端部署 + 插件热更新 + 多数据库支持 + 插件 SDK
> ⚠️ 说明: 本文包含 JWT/角色权限/Web 服务化等前瞻设计，不代表当前主干默认行为。当前运行规则请以 `docs/RUNTIME_OPERATIONS_RUNBOOK.md` 与 `backend/api.py` 为准。

---

## 目录

1. [设计目标](#1-设计目标)
2. [当前问题](#2-当前问题)
3. [架构总览](#3-架构总览)
4. [插件包规范](#4-插件包规范)
5. [通信协议](#5-通信协议)
6. [热更新机制](#6-热更新机制)
7. [插件 Handler 实现示例](#7-插件-handler-实现示例)
8. [主程序核心模块](#8-主程序核心模块)
9. [Web 前端架构](#9-web-前端架构)
10. [安全设计](#10-安全设计)
11. [数据库设计](#11-数据库设计)
12. [认证与权限](#12-认证与权限)
13. [插件间通信机制](#13-插件间通信机制)
14. [插件 SDK 策略](#14-插件-sdk-策略)
15. [插件依赖声明](#15-插件依赖声明)
16. [MCP 支持（v1.1 规划）](#16-mcp-支持v11-规划)
17. [与现有架构对比](#17-与现有架构对比)
18. [向后兼容与迁移方案](#18-向后兼容与迁移方案)
19. [日志体系](#19-日志体系)
20. [部署方案](#20-部署方案)
21. [测试策略](#21-测试策略)
22. [实施计划](#22-实施计划)
23. [已确认决策](#23-已确认决策)
24. [Electron 客户端设计](#24-electron-客户端设计)
25. [待讨论问题](#25-待讨论问题)

---

## 1. 设计目标

| 目标 | 说明 |
|------|------|
| 服务端部署 | Web 服务端架构，支持团队共享使用 |
| 插件完全独立 | 不依赖主程序任何 Python 模块（可选 SDK） |
| 热更新 | 上传即生效，无需重启 |
| 版本无关 | 插件与主程序版本解耦 |
| 安全隔离 | 插件运行在独立进程 |
| 多数据库支持 | 默认 SQLite，可配置 MySQL 等 |
| 向后兼容 | 现有 schema.yaml 插件平滑迁移 |

---

## 2. 当前问题

### 2.1 强依赖关系

```
插件 handler.py
    ├── from core.base_handler              ← 强依赖 (BaseTemplateHandler, register_handler)
    ├── from core.handler_utils             ← 强依赖 (BaseTemplateHandlerEnhanced, TableProcessor, ErrorHandler)
    ├── from core.handler_config            ← 间接依赖 (HandlerConfig 配置驱动)
    ├── from core.document_editor           ← 强依赖 (DocumentEditor)
    ├── from core.document_image_processor  ← 强依赖 (DocumentImageProcessor)
    ├── from core.summary_generator         ← 部分插件依赖 (SummaryGenerator)
    ├── from core.logger                    ← 强依赖 (setup_logger)
    └── from core.template_manager          ← 强依赖 (TemplateManager)
```

### 2.2 现有插件清单

| 插件 ID | 名称 | 核心依赖 | 复杂度 |
|---------|------|----------|--------|
| `vuln_report` | 风险隐患报告 | DocumentEditor, DocumentImageProcessor | 中 |
| `penetration_test` | 渗透测试报告 | DocumentEditor, TableProcessor, docx OxmlElement | 高 |
| `intrusion_report` | 入侵痕迹报告 | DocumentEditor, DocumentImageProcessor | 中 |
| `Attack_Defense` | 护网/攻防演练报告 | DocumentEditor, DocumentImageProcessor, SummaryGenerator, TableProcessor | 高 |

### 2.3 Schema 格式差异

现有插件使用 `schema.yaml`（YAML 格式），新架构规范使用 `schema.json`（JSON 格式），需要提供兼容层。

**结果**：主程序升级 → 插件可能失效；插件无法独立分发和测试。

### 2.4 架构绑定 Electron

当前架构与 Electron 桌面应用强耦合，无法独立作为 Web 服务端部署。重构后前后端完全分离，后端为独立的 FastAPI Web 服务，前端可以是浏览器、Electron、或任意 HTTP 客户端。

---

## 3. 架构总览

```
┌───────────────────────────────────────────────────────┐
│              浏览器 / 任意 HTTP 客户端                  │
└─────────────────────────┬─────────────────────────────┘
                          │ HTTP / WebSocket
┌─────────────────────────▼─────────────────────────────┐
│                  主程序 (FastAPI)                      │
│  ┌────────────┐  ┌────────────┐  ┌──────────────┐     │
│  │ Plugin     │  │ Plugin     │  │ Hot Reload   │     │
│  │ Registry   │  │ Router     │  │ Watcher      │     │
│  ├────────────┤  ├────────────┤  ├──────────────┤     │
│  │ Auth       │  │ Database   │  │ Static File  │     │
│  │ Middleware │  │ Layer(DAL) │  │ Server       │     │
│  └─────┬──────┘  └─────┬──────┘  └──────┬───────┘     │
└────────┼───────────────┼────────────────┼─────────────┘
         │               │                │
         │   ┌───────────▼───────────┐    │
         │   │   Plugin Protocol     │    │
         │   │  (JSON-RPC/stdin)     │    │
         │   └───────────┬───────────┘    │
         │               │                │
┌────────▼───────────────▼────────────────▼─────────────┐
│                    插件进程层                           │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐          │
│  │ Plugin A  │  │ Plugin B  │  │ Plugin C  │          │
│  │ (Process) │  │ (Process) │  │ (Process) │          │
│  └───────────┘  └───────────┘  └───────────┘          │
└───────────────────────────────────────────────────────┘
```

### 3.1 与现有架构的核心区别

| 维度 | 旧架构 | 新架构 |
|------|--------|--------|
| 运行形态 | Electron 桌面应用 + 内嵌后端 | 独立 Web 服务端 |
| 前端 | Electron webContents 加载本地 HTML | 浏览器访问，FastAPI 托管静态文件 |
| 进程管理 | Electron main.js 管 Python 子进程 | 服务端自主管理，systemd/Docker 部署 |
| 数据库 | 单 SQLite 文件，硬编码路径 | DAL 抽象层，默认 SQLite，可配置 MySQL 等 |
| 认证 | 无 | JWT Token + 角色控制 |

---

## 4. 插件包规范

### 4.1 目录结构

```
my_plugin/
├── manifest.json      # 元信息 (必需)
├── schema.json        # 表单定义 (必需，也支持 schema.yaml)
├── handler/           # 处理器 (必需)
│   └── handler.exe    # 独立可执行文件 (Windows)
│   └── handler        # 独立可执行文件 (macOS/Linux)
├── templates/         # 文档模板
│   └── default.docx
├── assets/            # 静态资源 (可选)
│   ├── fonts/
│   └── images/
├── frontend/          # 自定义前端 (可选)
│   └── index.html
└── README.md          # 插件说明 (建议)
```

### 4.2 manifest.json

```json
{
  "id": "vuln_report",
  "name": "风险隐患报告",
  "version": "2.0.0",
  "protocol": "1.0",
  "description": "用于生成网络安全风险隐患报告",
  "author": "ReportGenX Team",
  "license": "MIT",
  "min_app_version": "1.0.0",

  "handler": {
    "type": "executable",
    "entry": {
      "windows": "handler/handler.exe",
      "darwin": "handler/handler",
      "linux": "handler/handler"
    },
    "timeout": 60,
    "max_memory_mb": 512,
    "max_instances": 3
  },

  "frontend": {
    "type": "schema",
    "file": "schema.json"
  },

  "dependencies": {
    "python-docx": ">=0.8.11",
    "Pillow": ">=9.0.0"
  },

  "capabilities": {
    "image_processing": true,
    "table_processing": true,
    "multi_file_output": false
  }
}
```

### 4.3 manifest.json 字段规范

| 字段 | 类型 | 必须 | 说明 |
|------|------|------|------|
| `id` | string | ✅ | 唯一标识，匹配 `^[a-zA-Z_][a-zA-Z0-9_]*$` |
| `name` | string | ✅ | 显示名称 |
| `version` | string | ✅ | 语义化版本号 (SemVer) |
| `protocol` | string | ✅ | 通信协议版本 |
| `description` | string | ❌ | 插件描述 |
| `author` | string | ❌ | 作者信息 |
| `min_app_version` | string | ❌ | 最低主程序版本要求 |
| `handler.type` | string | ✅ | `executable` 或 `script` |
| `handler.entry` | string/object | ✅ | 入口文件路径（支持多平台） |
| `handler.timeout` | number | ❌ | 超时时间（秒），默认 60 |
| `handler.max_memory_mb` | number | ❌ | 内存限制（MB），默认 512 |
| `handler.max_instances` | number | ❌ | 最大并发实例数，默认 1 |
| `handler.runtime` | string | ❌ | 脚本模式运行时，如 `python3` |
| `frontend.type` | string | ✅ | `schema` 或 `custom` |
| `frontend.file` | string | ✅ | 表单定义/前端入口文件 |
| `capabilities` | object | ❌ | 插件能力声明 |

### 4.4 Handler 类型说明

#### 4.4.1 可执行文件模式 (executable)

插件打包为独立可执行文件，完全自包含：

```json
{
  "handler": {
    "type": "executable",
    "entry": {
      "windows": "handler/handler.exe",
      "darwin": "handler/handler",
      "linux": "handler/handler"
    }
  }
}
```

**优点**：完全隔离、无运行时依赖、跨平台分发
**缺点**：体积大（30-50MB+）、需要打包工具

#### 4.4.2 脚本模式 (script)

插件以 Python 脚本形式运行，由主程序提供运行时：

```json
{
  "handler": {
    "type": "script",
    "entry": "handler.py",
    "runtime": "python3"
  }
}
```

**优点**：体积小、开发便捷、适合内部团队
**缺点**：依赖主程序 Python 环境

**脚本模式依赖处理**：
- 插件目录下可包含 `requirements.txt`
- 主程序启动时检查并提示安装缺失依赖
- 或使用插件 SDK（见第 14 章）

---



### 5.1 协议选择：JSON-RPC 2.0 over stdin/stdout

**为什么选择这个协议**：

- 标准化：广泛使用的 RPC 协议
- 简单：纯文本 JSON，易于调试
- 跨语言：任何语言都能实现
- 进程隔离：天然安全边界

### 5.2 请求格式

```json
{
  "jsonrpc": "2.0",
  "id": "req-001",
  "method": "generate",
  "params": {
    "data": {"title": "报告标题"},
    "output_dir": "/path/to/output"
  }
}
```

### 5.3 响应格式

**成功**：

```json
{
  "jsonrpc": "2.0",
  "id": "req-001",
  "result": {
    "success": true,
    "file": "/path/to/report.docx"
  }
}
```

**失败**：

```json
{
  "jsonrpc": "2.0",
  "id": "req-001",
  "error": {
    "code": -32000,
    "message": "模板文件不存在"
  }
}
```

### 5.4 标准方法

| 方法 | 说明 | 必须 | 参数 |
|------|------|------|------|
| `get_info` | 返回插件信息 | ✅ | 无 |
| `get_schema` | 返回表单定义 | ✅ | 无 |
| `validate` | 验证数据 | ❌ | `{data: {...}}` |
| `preprocess` | 数据预处理 | ❌ | `{data: {...}}` |
| `generate` | 生成报告 | ✅ | `{data: {...}, output_dir: "..."}` |
| `health` | 健康检查 | ❌ | 无 |
| `shutdown` | 优雅关闭 | ❌ | 无 |

### 5.5 进度通知（Notification）

对于耗时较长的生成任务，插件可通过 stderr 发送进度通知：

```json
{"jsonrpc": "2.0", "method": "progress", "params": {"percent": 50, "message": "正在处理图片..."}}
```

> 注意：进度通知通过 **stderr** 发送，不影响 stdout 上的 JSON-RPC 响应。

### 5.6 错误码约定

| 错误码 | 含义 |
|--------|------|
| `-32700` | JSON 解析错误 |
| `-32600` | 无效的请求 |
| `-32601` | 方法不存在 |
| `-32602` | 无效的参数 |
| `-32603` | 内部错误 |
| `-32000` | 模板文件不存在 |
| `-32001` | 数据验证失败 |
| `-32002` | 图片处理失败 |
| `-32003` | 输出目录不可写 |

---

## 6. 热更新机制

### 6.1 设计原则

- 上传即生效，无需重启服务
- 正在执行的任务不受影响
- 支持版本回滚
- Windows 下文件锁定安全处理

### 6.2 热更新流程

```
上传插件包(.zip) → 校验manifest → 签名验证(可选)
    → 解压临时目录 → 测试调用(health + get_info)
    → 停止旧进程 → 原子替换 → 启动新进程 → 更新注册表
    → 失败时自动回滚到上一版本
```

### 6.3 热更新详细流程图

```
┌──────────┐    ┌──────────────┐    ┌─────────────┐
│ 上传插件  │───▶│ 校验manifest │───▶│ 解压到临时   │
└──────────┘    └──────┬───────┘    └──────┬──────┘
                       │ 失败               │
                       ▼                    ▼
                  返回错误            ┌────────────┐
                                    │ 测试调用    │
                                    │ health +   │
                                    │ get_info   │
                                    └──────┬─────┘
                                           │
                           ┌───────────────┼───────────────┐
                           │ 成功          │               │ 失败
                           ▼               ▼               ▼
                    ┌────────────┐  ┌────────────┐  ┌────────────┐
                    │ 备份当前版本│  │ 停止旧进程  │  │ 清理临时   │
                    └──────┬─────┘  └──────┬─────┘  │ 返回错误   │
                           │               │        └────────────┘
                           ▼               ▼
                    ┌────────────────────────────┐
                    │  原子替换 (rename)          │
                    └──────────────┬─────────────┘
                                  │
                           ┌──────┼──────┐
                           │ 成功        │ 失败
                           ▼             ▼
                    ┌────────────┐ ┌────────────┐
                    │ 更新注册表  │ │ 回滚旧版本  │
                    │ 启动新进程  │ └────────────┘
                    └────────────┘
```

### 6.4 版本管理

```
plugins/
├── vuln_report/           # 当前版本 (符号链接/junction)
├── vuln_report_v2.0.0/    # 版本快照
├── vuln_report_v1.9.0/    # 历史版本
└── _trash/                # 待清理
```

### 6.5 跨平台兼容

- **Linux/macOS**：使用 `os.symlink()` 创建符号链接
- **Windows**：使用 **Directory Junction**（不需要管理员权限）
- 替换前必须先终止插件进程，释放文件锁
- 使用 `shutil.move()` + 重试机制处理文件占用
- 清理 `_trash/` 目录时使用延迟删除策略

```python
# Windows Junction 创建示例
import subprocess

def create_junction(link_path: str, target_path: str):
    """创建 Windows Directory Junction"""
    if os.path.exists(link_path):
        subprocess.run(['cmd', '/c', 'rmdir', link_path], check=True)
    subprocess.run(['cmd', '/c', 'mklink', '/J', link_path, target_path], check=True)
```

---
## 7. 插件 Handler 实现示例

### 7.1 Python 实现

```python
#!/usr/bin/env python3
"""
插件 Handler 标准实现模板
通信协议: JSON-RPC 2.0 over stdin/stdout
进度通知: stderr
"""
import sys, json, os, signal
from docx import Document

# 确保 stdout 为行缓冲模式
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(line_buffering=True)

def main():
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError as e:
            send_error(None, -32700, f"JSON 解析错误: {e}")
            continue

        try:
            resp = dispatch(req)
        except Exception as e:
            resp = {"error": {"code": -32603, "message": f"内部错误: {e}"}}

        resp["jsonrpc"] = "2.0"
        resp["id"] = req.get("id")
        print(json.dumps(resp, ensure_ascii=False), flush=True)

def send_error(req_id, code, message):
    """发送错误响应"""
    resp = {
        "jsonrpc": "2.0",
        "id": req_id,
        "error": {"code": code, "message": message}
    }
    print(json.dumps(resp, ensure_ascii=False), flush=True)

def send_progress(percent, message=""):
    """通过 stderr 发送进度通知"""
    notification = {
        "jsonrpc": "2.0",
        "method": "progress",
        "params": {"percent": percent, "message": message}
    }
    print(json.dumps(notification, ensure_ascii=False), file=sys.stderr, flush=True)

def dispatch(req):
    method = req.get("method")
    params = req.get("params", {})

    handlers = {
        "get_info": lambda _: {"result": {"id": "my_plugin", "version": "1.0.0"}},
        "get_schema": lambda _: get_schema(),
        "validate": lambda p: validate(p),
        "generate": lambda p: generate(p),
        "health": lambda _: {"result": {"status": "ok"}},
        "shutdown": lambda _: shutdown(),
    }

    handler = handlers.get(method)
    if not handler:
        return {"error": {"code": -32601, "message": f"Method not found: {method}"}}
    return handler(params)

def get_schema():
    """返回表单定义"""
    schema_file = os.path.join(os.path.dirname(__file__), "schema.json")
    with open(schema_file, encoding="utf-8") as f:
        return {"result": json.load(f)}

def validate(params):
    """验证数据"""
    data = params.get("data", {})
    errors = []
    # 添加验证逻辑...
    return {"result": {"valid": len(errors) == 0, "errors": errors}}

def generate(params):
    """生成报告"""
    data = params.get("data", {})
    output_dir = params.get("output_dir", ".")

    send_progress(10, "加载模板...")
    template_path = os.path.join(os.path.dirname(__file__), "templates", "default.docx")
    doc = Document(template_path)

    send_progress(50, "替换内容...")
    # ... 处理文档 ...

    send_progress(90, "保存文件...")
    os.makedirs(output_dir, exist_ok=True)
    path = os.path.join(output_dir, "report.docx")
    doc.save(path)

    send_progress(100, "完成")
    return {"result": {"success": True, "file": path}}

def shutdown():
    """优雅关闭"""
    sys.exit(0)

if __name__ == "__main__":
    main()
```

### 7.2 Go 实现示例（跨语言能力）

```go
package main

import (
    "bufio"
    "encoding/json"
    "fmt"
    "os"
)

type Request struct {
    JSONRPC string      `json:"jsonrpc"`
    ID      interface{} `json:"id"`
    Method  string      `json:"method"`
    Params  interface{} `json:"params"`
}

type Response struct {
    JSONRPC string      `json:"jsonrpc"`
    ID      interface{} `json:"id"`
    Result  interface{} `json:"result,omitempty"`
    Error   interface{} `json:"error,omitempty"`
}

func main() {
    scanner := bufio.NewScanner(os.Stdin)
    for scanner.Scan() {
        var req Request
        json.Unmarshal(scanner.Bytes(), &req)

        resp := dispatch(req)
        resp.JSONRPC = "2.0"
        resp.ID = req.ID

        out, _ := json.Marshal(resp)
        fmt.Println(string(out))
    }
}

func dispatch(req Request) Response {
    switch req.Method {
    case "get_info":
        return Response{Result: map[string]string{"id": "go_plugin", "version": "1.0.0"}}
    case "health":
        return Response{Result: map[string]string{"status": "ok"}}
    default:
        return Response{Error: map[string]interface{}{"code": -32601, "message": "Method not found"}}
    }
}
```

**打包为可执行文件**：

```bash
# Python
pyinstaller --onefile --name handler handler.py

# Go
GOOS=windows GOARCH=amd64 go build -o handler.exe
GOOS=darwin GOARCH=arm64 go build -o handler
GOOS=linux GOARCH=amd64 go build -o handler
```

---

## 8. 主程序核心模块

### 8.1 模块结构

```
backend/
├── api.py                  # FastAPI 入口 + 静态文件托管
├── config.yaml             # 全局配置
├── core/
│   ├── database.py         # DAL 数据库抽象层（新增）
│   ├── auth.py             # 认证服务（新增）
│   ├── plugin_host.py      # 插件宿主（进程管理 + 生命周期）
│   ├── plugin_registry.py  # 插件注册表（manifest 管理）
│   ├── plugin_protocol.py  # JSON-RPC 协议实现
│   ├── plugin_hot_reload.py# 热更新 + 版本管理
│   ├── plugin_compat.py    # 兼容层（现有插件适配）
│   ├── data_reader_db.py   # 数据访问（改造为使用 DAL）
│   ├── document_editor.py  # Word 文档编辑
│   ├── document_image_processor.py
│   ├── template_manager.py # 模板管理
│   ├── logger.py           # 日志系统
│   └── ...                 # 其他现有模块
├── plugins/                # 新架构插件目录（新增）
├── templates/              # 旧架构模板目录（兼容）
├── static/                 # Web 前端静态文件（新增）
│   ├── index.html
│   ├── css/
│   └── js/
└── data/                   # 数据库文件
```

### 8.2 PluginHost 核心接口

```python
import asyncio
import subprocess
from typing import Dict, List, Optional, Any
from dataclasses import dataclass, field

@dataclass
class PluginProcess:
    """插件进程状态"""
    plugin_id: str
    process: subprocess.Popen
    pid: int
    started_at: float
    last_call: float = 0
    call_count: int = 0
    status: str = "running"  # running, stopped, error

class PluginHost:
    def __init__(self, plugins_dir: str, config: dict = None):
        self.plugins_dir = plugins_dir
        self.config = config or {}
        self._processes: Dict[str, PluginProcess] = {}
        self._lock = asyncio.Lock()

    def discover(self) -> List[dict]:
        """扫描插件目录，返回所有有效插件信息列表"""

    async def call(self, plugin_id: str, method: str, params: dict,
                   timeout: float = None) -> dict:
        """
        调用插件方法

        自动管理进程生命周期：
        - 首次调用时启动进程
        - 超时自动终止并返回错误
        - 进程异常退出自动重启
        """

    async def reload(self, plugin_id: str, package_path: str) -> bool:
        """
        热更新插件

        流程：校验 → 测试 → 停止旧进程 → 替换 → 启动
        失败时自动回滚
        """

    async def rollback(self, plugin_id: str, version: str) -> bool:
        """回滚到指定版本"""

    def stop(self, plugin_id: str, timeout: float = 5.0) -> bool:
        """停止插件进程（发送 shutdown 后等待，超时则 kill）"""

    def stop_all(self) -> None:
        """停止所有插件进程（应用关闭时调用）"""

    def get_status(self, plugin_id: str) -> dict:
        """获取插件运行状态（PID、内存、调用次数等）"""
```

### 8.3 PluginProtocol 通信实现

```python
import json
import asyncio
from typing import Optional

class PluginProtocol:
    """JSON-RPC 2.0 通信协议实现"""

    def __init__(self, process: subprocess.Popen, timeout: float = 60):
        self.process = process
        self.timeout = timeout
        self._request_id = 0

    async def send(self, method: str, params: dict = None) -> dict:
        """
        发送请求并等待响应

        Raises:
            TimeoutError: 超过超时时间
            PluginCrashError: 插件进程异常退出
            ProtocolError: 响应格式错误
        """
        self._request_id += 1
        request = {
            "jsonrpc": "2.0",
            "id": f"req-{self._request_id:06d}",
            "method": method,
            "params": params or {}
        }

        line = json.dumps(request, ensure_ascii=False) + "\n"
        self.process.stdin.write(line.encode('utf-8'))
        self.process.stdin.flush()

        response_line = await asyncio.wait_for(
            self._read_line(), timeout=self.timeout
        )

        response = json.loads(response_line)
        if "error" in response:
            raise PluginError(response["error"])
        return response.get("result", {})

    async def _read_line(self) -> str:
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None, self.process.stdout.readline
        )
```

### 8.4 进程生命周期管理

```
┌──────────┐     首次调用      ┌──────────┐
│  未启动   │ ─────────────▶  │  运行中   │
└──────────┘                  └────┬─────┘
                                   │
                    ┌──────────────┼──────────────┐
                    │              │              │
                    ▼              ▼              ▼
             ┌───────────┐  ┌──────────┐  ┌──────────┐
             │ 空闲超时   │  │ 异常退出  │  │ 主动停止  │
             │ 回收进程   │  │ 自动重启  │  │ (热更新)  │
             └───────────┘  └──────────┘  └──────────┘
```

### 8.5 进程池设计

为支持并发报告生成，每个插件可配置进程池：

```python
@dataclass
class PluginProcessPool:
    """插件进程池"""
    plugin_id: str
    max_instances: int = 3          # 最大实例数（来自 manifest）
    idle_timeout: int = 300         # 空闲超时（秒）
    processes: List[PluginProcess] = field(default_factory=list)
    pending_requests: asyncio.Queue = field(default_factory=asyncio.Queue)
    
class PluginHost:
    async def call(self, plugin_id: str, method: str, params: dict) -> dict:
        """
        调用插件方法（支持并发）
        
        流程：
        1. 从进程池获取空闲进程
        2. 若无空闲且未达上限，启动新进程
        3. 若已达上限，排队等待
        4. 调用完成后归还进程到池中
        """
        pool = self._get_or_create_pool(plugin_id)
        process = await self._acquire_process(pool)
        try:
            return await self._send_request(process, method, params)
        finally:
            self._release_process(pool, process)
```

**进程池策略**：

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `max_instances` | 1 | 单插件最大并发进程数 |
| `idle_timeout` | 300s | 空闲进程回收时间 |
| `warmup` | false | 是否预启动进程 |

**空闲回收策略**：

- 默认空闲 5 分钟后回收进程
- 高频使用的插件延长空闲时间
- 内存超限时强制回收

### 8.6 API 路由

```python
# 插件相关路由
GET  /api/plugins                    # 插件列表（含运行状态）
GET  /api/plugins/{id}/schema        # 表单定义
GET  /api/plugins/{id}/status        # 运行状态
POST /api/plugins/{id}/generate      # 生成报告
POST /api/plugins/{id}/validate      # 验证数据
POST /api/plugins/{id}/upload        # 上传/更新插件包
POST /api/plugins/{id}/rollback      # 回滚版本
POST /api/plugins/{id}/stop          # 停止进程
POST /api/plugins/{id}/restart       # 重启进程
GET  /api/plugins/{id}/versions      # 版本列表
DELETE /api/plugins/{id}             # 删除插件

# 认证路由
POST /api/auth/login                 # 登录
POST /api/auth/logout                # 登出
GET  /api/auth/me                    # 当前用户信息
POST /api/auth/change-password       # 修改密码

# 用户管理路由（管理员）
GET  /api/users                      # 用户列表
POST /api/users                      # 创建用户
PUT  /api/users/{id}                 # 更新用户
DELETE /api/users/{id}               # 删除用户

# 健康检查
GET  /api/health                     # 深度健康检查
```

### 8.7 与现有 API 路由的兼容

现有路由 `/api/plugin/{template_id}/*` 将作为兼容层保留：

```python
GET  /api/plugin/{id}/schema   →  转发到新插件系统
POST /api/plugin/{id}/generate →  转发到新插件系统
GET  /api/templates            →  同时返回新旧插件
```

---

## 9. Web 前端架构

### 9.1 前端定位

重构后前端从 Electron 应用改为纯 Web 前端，由 FastAPI 托管静态文件：

```python
# api.py - 静态文件托管
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
async def serve_index():
    return FileResponse("static/index.html")
```

### 9.2 前端目录结构

```
backend/static/
├── index.html              # 主页面（含登录表单）
├── css/
│   └── styles.css
└── js/
    ├── api.js              # API 客户端（改造自现有 src/js/api.js）
    ├── auth.js             # 登录/认证模块（新增）
    ├── config.js           # 配置
    ├── form-renderer.js    # 动态表单渲染（复用现有）
    ├── main.js             # 主入口
    ├── template-manager.js # 模板管理（改造）
    ├── toolbox.js          # 工具箱
    └── utils.js            # 工具函数
```

### 9.3 Schema 驱动表单（简单表单）

```json
{
  "frontend": {
    "type": "schema",
    "file": "schema.json"
  }
}
```

主程序使用现有 `form-renderer.js` 渲染。Schema 格式兼容 `schema.json` 和 `schema.yaml`。

### 9.4 自定义前端（复杂交互）

```json
{
  "frontend": {
    "type": "custom",
    "entry": "frontend/index.html"
  }
}
```

主程序通过 iframe 加载，使用 postMessage 通信：

```javascript
// 插件前端 → 主程序
window.parent.postMessage({
    type: 'plugin:submit',
    pluginId: 'my_plugin',
    data: { /* 表单数据 */ }
}, '*');

// 主程序 → 插件前端
window.addEventListener('message', (event) => {
    if (event.data.type === 'host:init') {
        // 接收初始化数据
    }
});
```

**安全限制**：

- iframe 设置 `sandbox="allow-scripts allow-forms"`
- 校验 `event.origin`
- 插件前端不可访问主程序 DOM

### 9.5 现有前端模块迁移

| 原文件 (src/js/) | 迁移目标 (static/js/) | 改造内容 |
|-------------------|----------------------|----------|
| `api.js` | `api.js` | 移除 Electron 依赖，新增 `Plugins` 命名空间，注入 Auth Token |
| `form-renderer.js` | `form-renderer.js` | Schema 加载源增加 `/api/plugins` 路由 |
| `template-manager.js` | `template-manager.js` | 合并展示新旧插件 |
| `main.js` | `main.js` | 移除 Electron preload 依赖，增加登录检查 |
| `config.js` | `config.js` | API 地址改为相对路径（同源部署） |
| `toolbox.js` | `toolbox.js` | 基本不变 |
| `utils.js` | `utils.js` | 基本不变 |

#### 9.5.1 API 客户端改造

```javascript
// static/js/api.js
window.AppAPI = {
    _authToken: null,

    async _request(endpoint, method = 'GET', body = null) {
        const headers = {};
        if (this._authToken) {
            headers['Authorization'] = `Bearer ${this._authToken}`;
        }
        if (body && !(body instanceof FormData)) {
            headers['Content-Type'] = 'application/json';
        }

        const options = { method, headers };
        if (body) {
            options.body = body instanceof FormData ? body : JSON.stringify(body);
        }

        const res = await fetch(endpoint, options);
        if (res.status === 401) {
            AppAuth.logout();
            throw new Error('登录已过期');
        }
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.detail || `API Error: ${res.status}`);
        }
        return res.json();
    },

    // 新增 Plugins 命名空间
    Plugins: {
        list: () => AppAPI._request('/api/plugins'),
        getSchema: (id) => AppAPI._request(`/api/plugins/${id}/schema`),
        generate: (id, data) => AppAPI._request(`/api/plugins/${id}/generate`, 'POST', data),
        getStatus: (id) => AppAPI._request(`/api/plugins/${id}/status`),
        upload: (file) => {
            const fd = new FormData();
            fd.append('file', file);
            return AppAPI._request('/api/plugins/upload', 'POST', fd);
        },
        rollback: (id, version) => AppAPI._request(`/api/plugins/${id}/rollback`, 'POST', { version }),
        versions: (id) => AppAPI._request(`/api/plugins/${id}/versions`),
    },

    // 保留现有命名空间（兼容期）
    Templates: { /* ... 现有代码 ... */ },
    Vulnerabilities: { /* ... 现有代码 ... */ },
    Icp: { /* ... 现有代码 ... */ },
    Reports: { /* ... 现有代码 ... */ },
};
```

#### 9.5.2 模板选择器统一展示

```javascript
async loadTemplateList() {
    const [templates, plugins] = await Promise.all([
        AppAPI.Templates.list(),
        AppAPI.Plugins.list().catch(() => ({ plugins: [] }))
    ]);

    templates.templates.forEach(t => {
        this.addOption(t.id, t.name, t.version, 'template');
    });

    plugins.plugins?.forEach(p => {
        this.addOption(p.id, `${p.name} [插件]`, p.version, 'plugin');
    });
}
```

---

## 10. 安全设计

| 风险 | 缓解措施 | 实现细节 |
|------|----------|----------|
| 恶意插件 | 进程隔离 + 资源限制 | 独立进程，限制 CPU/内存 |
| 路径穿越 | 限制 output_dir 范围 | `validate_path_safety()` 检查 |
| 资源耗尽 | 超时机制 + 内存限制 | 进程级超时 + `max_memory_mb` |
| 代码注入 | 不执行动态代码 | 仅通过 stdin/stdout 通信 |
| 文件覆盖 | 输出文件名校验 | 禁止 `..` 和绝对路径 |
| 插件伪造 | 完整性校验（可选） | SHA256 哈希校验 |
| 进程泄露 | 进程生命周期管理 | 孤儿进程检测 + 自动回收 |
| 大文件上传 | 文件大小限制 | 插件包 ≤ 100MB |
| 未认证访问 | JWT Token 认证 | 除公开接口外均需 Token |
| CORS 滥用 | 限制来源 | 仅允许同源或配置白名单 |

### 10.1 进程隔离策略

```python
def start_plugin_process(entry_path: str, timeout: int, max_memory_mb: int):
    """启动隔离的插件进程"""
    env = os.environ.copy()
    for key in ['DATABASE_URL', 'SECRET_KEY', 'API_KEY']:
        env.pop(key, None)

    env['PLUGIN_DIR'] = os.path.dirname(entry_path)

    process = subprocess.Popen(
        [entry_path],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
        cwd=os.path.dirname(entry_path),
        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == 'nt' else 0
    )
    return process
```

### 10.2 插件完整性校验（可选）

在 manifest.json 中可声明文件哈希用于校验：

```json
{
  "integrity": {
    "algorithm": "sha256",
    "checksums": {
      "handler/handler.exe": "a1b2c3d4...",
      "schema.json": "e5f6g7h8...",
      "templates/default.docx": "i9j0k1l2..."
    }
  }
}
```

### 10.3 CORS 配置

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.get("cors_origins", ["*"]),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Content-Type", "Authorization"],
)
```

---
## 11. 数据库设计

### 11.1 设计原则

- **默认 SQLite**：零配置，开箱即用
- **可配置切换**：通过 `config.yaml` 切换为 MySQL 等数据库
- **DAL 抽象层**：业务代码不直接依赖具体数据库驱动

### 11.2 候选方案对比

| 维度 | SQLite | MySQL | PostgreSQL |
|------|--------|-------|------------|
| **部署复杂度** | ⭐ 零配置 | ⭐⭐⭐ 需安装服务 | ⭐⭐⭐ 需安装服务 |
| **并发能力** | 单写多读 (WAL) | 高并发读写 | 高并发读写 |
| **运维成本** | 无（嵌入式） | 中 | 中 |
| **授权成本** | 免费 | 免费 (Community) | 免费 |
| **备份恢复** | 文件复制即备份 | mysqldump / binlog | pg_dump |
| **Python 生态** | `sqlite3` 标准库 | `pymysql` / `aiomysql` | `asyncpg` / `psycopg2` |
| **适用场景** | 单机/小团队 | 中大型团队 | 中大型团队 |

### 11.3 默认选择 SQLite 的理由

1. **零部署成本**：`sqlite3` 是 Python 标准库，无需额外依赖
2. **开箱即用**：首次启动自动创建数据库文件
3. **备份便捷**：文件复制即备份
4. **性能足够**：WAL 模式支撑每秒数百次读写
5. **向后兼容**：现有数据 `combined.db` 可直接复用

### 11.4 DAL 数据库抽象层

```python
# backend/core/database.py
from abc import ABC, abstractmethod
from contextlib import contextmanager
from typing import Any, Dict, List, Optional
import threading

class DatabaseBackend(ABC):
    """数据库后端抽象接口"""

    @abstractmethod
    def connect(self) -> None: ...

    @abstractmethod
    def close(self) -> None: ...

    @contextmanager
    def get_connection(self):
        conn = self._create_connection()
        try:
            yield conn
        finally:
            conn.close()

    @abstractmethod
    def _create_connection(self): ...

    @abstractmethod
    def execute(self, sql: str, params: tuple = ()) -> Any: ...

    @abstractmethod
    def fetchall(self, sql: str, params: tuple = ()) -> List[Dict]: ...

    @abstractmethod
    def fetchone(self, sql: str, params: tuple = ()) -> Optional[Dict]: ...


class SQLiteBackend(DatabaseBackend):
    """SQLite 后端（默认）"""

    _write_lock = threading.Lock()

    def __init__(self, db_path: str):
        self.db_path = db_path

    def connect(self):
        pass  # SQLite 按需连接

    def close(self):
        pass

    def _create_connection(self):
        import sqlite3
        conn = sqlite3.connect(self.db_path, timeout=10)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    def execute(self, sql: str, params: tuple = ()) -> Any:
        with self._write_lock:
            with self.get_connection() as conn:
                cursor = conn.execute(sql, params)
                conn.commit()
                return cursor

    def fetchall(self, sql: str, params: tuple = ()) -> List[Dict]:
        with self.get_connection() as conn:
            cursor = conn.execute(sql, params)
            return [dict(row) for row in cursor.fetchall()]

    def fetchone(self, sql: str, params: tuple = ()) -> Optional[Dict]:
        with self.get_connection() as conn:
            cursor = conn.execute(sql, params)
            row = cursor.fetchone()
            return dict(row) if row else None


class MySQLBackend(DatabaseBackend):
    """MySQL 后端（可选扩展）"""

    def __init__(self, host: str, port: int, database: str, user: str, password: str):
        self.config = {
            "host": host, "port": port, "database": database,
            "user": user, "password": password, "charset": "utf8mb4"
        }

    def _create_connection(self):
        import pymysql
        return pymysql.connect(**self.config, cursorclass=pymysql.cursors.DictCursor)

    def connect(self):
        conn = self._create_connection()
        conn.close()

    def close(self):
        pass

    def execute(self, sql: str, params: tuple = ()) -> Any:
        sql = sql.replace('?', '%s')
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(sql, params)
            conn.commit()
            return cursor

    def fetchall(self, sql: str, params: tuple = ()) -> List[Dict]:
        sql = sql.replace('?', '%s')
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(sql, params)
            return cursor.fetchall()

    def fetchone(self, sql: str, params: tuple = ()) -> Optional[Dict]:
        sql = sql.replace('?', '%s')
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(sql, params)
            return cursor.fetchone()


def create_backend(config: dict) -> DatabaseBackend:
    """工厂函数：根据配置创建数据库后端"""
    backend_type = config.get("backend", "sqlite")
    if backend_type == "sqlite":
        return SQLiteBackend(config["sqlite"]["path"])
    elif backend_type == "mysql":
        mc = config["mysql"]
        return MySQLBackend(mc["host"], mc["port"], mc["database"], mc["user"], mc["password"])
    else:
        raise ValueError(f"不支持的数据库类型: {backend_type}")
```

### 11.5 数据库配置

```yaml
# config.yaml
database:
  backend: sqlite              # sqlite | mysql
  sqlite:
    path: data/combined.db     # 数据库文件路径

  mysql:                       # 仅 backend=mysql 时使用
    host: 127.0.0.1
    port: 3306
    database: reportgenx
    user: root
    password: ""
```

### 11.6 现有 data_reader_db.py 改造

```python
# 改造前（直接依赖 SQLite）
class DbDataReader:
    def __init__(self, db_path):
        self.db_path = db_path
    def read_vulnerabilities(self):
        conn = sqlite3.connect(self.db_path)
        # ... 无异常保护
        conn.close()

# 改造后（使用 DAL）
class DbDataReader:
    def __init__(self, db_backend: DatabaseBackend):
        self.db = db_backend

    def read_vulnerabilities(self):
        return self.db.fetchall("SELECT * FROM vulnerabilities_Sheet1")

    def add_vulnerability(self, data: dict):
        self.db.execute(
            "INSERT INTO vulnerabilities_Sheet1 (...) VALUES (...)", (...)
        )
```

### 11.7 数据库初始化

```python
# backend/core/db_init.py
def init_database(db: DatabaseBackend):
    """初始化数据库表（首次启动时自动执行）"""

    # 用户表
    db.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id          TEXT PRIMARY KEY,
            username    TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            role        TEXT NOT NULL DEFAULT 'operator',
            status      INTEGER DEFAULT 1,
            created_at  TEXT DEFAULT (datetime('now','localtime')),
            updated_at  TEXT DEFAULT (datetime('now','localtime'))
        )
    """)

    # 创建默认管理员
    admin = db.fetchone("SELECT id FROM users WHERE username = 'admin'")
    if not admin:
        import bcrypt, uuid
        pwd_hash = bcrypt.hashpw(b"admin123", bcrypt.gensalt()).decode()
        db.execute(
            "INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)",
            (str(uuid.uuid4()), "admin", pwd_hash, "admin")
        )
```

---

## 12. 认证与权限

### 12.1 设计原则

初版采用**简单实用**的认证方案：

- 默认开启认证（生产环境安全）
- 两种角色：`admin`（管理员）、`operator`（操作员）
- JWT Token 无状态认证
- 密码 bcrypt 哈希存储
- 支持 IP 白名单（白名单内可跳过认证）

### 12.2 认证配置

```yaml
# config.yaml
auth:
  enabled: true              # 默认开启认证
  secret_key: "your-secret"  # JWT 签名密钥（生产环境必须修改）
  token_expire_hours: 24     # Token 过期时间
  whitelist:                 # IP 白名单（可选）
    enabled: false
    ips:
      - "127.0.0.1"
      - "192.168.1.0/24"
  default_admin:
    username: admin
    password: admin123       # 首次启动创建的默认密码（请立即修改）
```

### 12.3 角色权限矩阵

| 操作 | admin | operator | 未登录(auth关闭) |
|------|-------|----------|-------------------|
| 查看模板列表 | ✅ | ✅ | ❌ |
| 生成报告 | ✅ | ✅ | ❌ |
| 查看漏洞库 | ✅ | ✅ | ❌ |
| 上传插件 | ✅ | ❌ | ❌ |
| 管理用户 | ✅ | ❌ | ❌ |
| 修改系统配置 | ✅ | ❌ | ❌ |
| 修改个人密码 | ✅ | ✅ | - |

> 当 `auth.whitelist.enabled = true` 且请求 IP 在白名单内时，可跳过认证。

### 12.4 JWT 认证实现

```python
# backend/core/auth.py
import jwt
import bcrypt
from datetime import datetime, timedelta
from typing import Optional, Dict

class AuthService:
    def __init__(self, config: dict, db):
        self.enabled = config.get("enabled", False)
        self.secret_key = config.get("secret_key", "default-secret")
        self.expire_hours = config.get("token_expire_hours", 24)
        self.db = db

    def login(self, username: str, password: str) -> Optional[str]:
        """登录，返回 JWT Token"""
        user = self.db.fetchone(
            "SELECT * FROM users WHERE username = ? AND status = 1", (username,)
        )
        if not user:
            return None
        if not bcrypt.checkpw(password.encode(), user["password_hash"].encode()):
            return None

        payload = {
            "sub": user["id"],
            "username": user["username"],
            "role": user["role"],
            "exp": datetime.utcnow() + timedelta(hours=self.expire_hours)
        }
        return jwt.encode(payload, self.secret_key, algorithm="HS256")

    def verify_token(self, token: str) -> Optional[Dict]:
        """验证 Token，返回 payload"""
        try:
            return jwt.decode(token, self.secret_key, algorithms=["HS256"])
        except jwt.ExpiredSignatureError:
            return None
        except jwt.InvalidTokenError:
            return None
```

### 12.5 认证中间件

```python
from fastapi import Request, HTTPException
from starlette.middleware.base import BaseHTTPMiddleware
import ipaddress

class AuthMiddleware(BaseHTTPMiddleware):
    # 不需要认证的路径
    PUBLIC_PATHS = {"/api/auth/login", "/api/health", "/"}

    def _is_ip_whitelisted(self, client_ip: str) -> bool:
        """检查 IP 是否在白名单内"""
        if not auth_config.get("whitelist", {}).get("enabled", False):
            return False
        
        whitelist = auth_config.get("whitelist", {}).get("ips", [])
        try:
            client = ipaddress.ip_address(client_ip)
            for item in whitelist:
                if "/" in item:
                    if client in ipaddress.ip_network(item, strict=False):
                        return True
                elif client == ipaddress.ip_address(item):
                    return True
        except ValueError:
            pass
        return False

    async def dispatch(self, request: Request, call_next):
        # 公开路径不需要认证
        if request.url.path in self.PUBLIC_PATHS:
            return await call_next(request)

        # 静态文件不需要认证
        if request.url.path.startswith("/static"):
            return await call_next(request)

        # 检查 IP 白名单
        client_ip = request.client.host
        if self._is_ip_whitelisted(client_ip):
            request.state.user = {"role": "admin", "username": f"whitelist:{client_ip}"}
            return await call_next(request)

        # 认证关闭时（仅开发环境）
        if not auth_service.enabled:
            request.state.user = {"role": "admin", "username": "anonymous"}
            return await call_next(request)

        # 验证 Token
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="未提供认证信息")

        token = auth_header[7:]
        payload = auth_service.verify_token(token)
        if not payload:
            raise HTTPException(status_code=401, detail="Token 无效或已过期")

        request.state.user = payload
        return await call_next(request)
```

### 12.6 权限检查装饰器

```python
from functools import wraps

def require_role(*roles):
    """权限检查装饰器"""
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, request: Request, **kwargs):
            user = getattr(request.state, 'user', None)
            if not user or user.get("role") not in roles:
                raise HTTPException(status_code=403, detail="权限不足")
            return await func(*args, request=request, **kwargs)
        return wrapper
    return decorator

# 使用示例
@app.post("/api/plugins/{id}/upload")
@require_role("admin")
async def upload_plugin(id: str, request: Request):
    ...
```

---

## 13. 插件间通信机制

### 13.1 设计约束

- 插件之间不直接通信
- 所有交互通过主程序路由
- 简单的事件发布/订阅模式

### 13.2 事件总线

```python
# backend/core/event_bus.py
from collections import defaultdict
from typing import Callable, Any
import asyncio

class EventBus:
    def __init__(self):
        self._listeners = defaultdict(list)

    def on(self, event: str, callback: Callable):
        self._listeners[event].append(callback)

    def off(self, event: str, callback: Callable):
        self._listeners[event].remove(callback)

    async def emit(self, event: str, data: Any = None):
        for callback in self._listeners[event]:
            if asyncio.iscoroutinefunction(callback):
                await callback(data)
            else:
                callback(data)
```

### 13.3 数据传递模式

插件 A 的输出通过主程序传递给插件 B：

```python
# 主程序串联调用
result_a = await plugin_host.call("plugin_a", "generate", params)
if result_a["success"]:
    params_b = {**params, "input_file": result_a["file"]}
    result_b = await plugin_host.call("plugin_b", "generate", params_b)
```

---

## 14. 插件 SDK 策略

### 14.1 问题背景

现有 4 个插件深度依赖 `core/` 模块：

| 插件 | 依赖模块 | 迁移难度 |
|------|----------|----------|
| `vuln_report` | DocumentEditor, ImageProcessor | 中 |
| `penetration_test` | TableProcessor, OxmlElement | 高 |
| `intrusion_report` | DocumentEditor, ImageProcessor | 中 |
| `Attack_Defense` | 全部核心模块 | 高 |

直接迁移需要将 `core/` 代码复制到每个插件，导致代码重复和维护困难。

### 14.2 SDK 设计

发布 `reportgenx-plugin-sdk` 包，封装常用功能：

```
reportgenx-plugin-sdk/
├── reportgenx_sdk/
│   ├── __init__.py
│   ├── document.py      # DocumentEditor 封装
│   ├── image.py         # ImageProcessor 封装
│   ├── table.py         # TableProcessor 封装
│   ├── protocol.py      # JSON-RPC 协议助手
│   ├── logger.py        # 日志工具
│   └── utils.py         # 通用工具
├── setup.py
└── README.md
```

### 14.3 SDK 核心接口

```python
# reportgenx_sdk/document.py
from docx import Document
from typing import Dict, Any, Optional

class DocumentEditor:
    """Word 文档编辑器（从 core/document_editor.py 提取）"""
    
    def __init__(self, template_path: str):
        self.doc = Document(template_path)
    
    def replace_text(self, replacements: Dict[str, str]) -> None:
        """替换文档中的占位符"""
        for paragraph in self.doc.paragraphs:
            for key, value in replacements.items():
                if key in paragraph.text:
                    paragraph.text = paragraph.text.replace(key, value)
    
    def replace_in_tables(self, replacements: Dict[str, str]) -> None:
        """替换表格中的占位符"""
        for table in self.doc.tables:
            for row in table.rows:
                for cell in row.cells:
                    for key, value in replacements.items():
                        if key in cell.text:
                            cell.text = cell.text.replace(key, value)
    
    def save(self, output_path: str) -> str:
        """保存文档"""
        self.doc.save(output_path)
        return output_path


class ImageProcessor:
    """图片处理器（从 core/document_image_processor.py 提取）"""
    
    @staticmethod
    def insert_image(doc: Document, placeholder: str, 
                     image_path: str, width_cm: float = 15) -> bool:
        """在占位符位置插入图片"""
        from docx.shared import Cm
        # ... 实现细节
        pass
    
    @staticmethod
    def validate_image(image_path: str) -> bool:
        """验证图片格式"""
        from PIL import Image
        try:
            with Image.open(image_path) as img:
                img.verify()
            return True
        except:
            return False
```

### 14.4 SDK 协议助手

```python
# reportgenx_sdk/protocol.py
import sys
import json
from typing import Callable, Dict, Any

class PluginHandler:
    """JSON-RPC 协议处理器基类"""
    
    def __init__(self):
        self._methods: Dict[str, Callable] = {}
        self._register_builtin_methods()
    
    def _register_builtin_methods(self):
        self.register("health", lambda _: {"status": "ok"})
        self.register("shutdown", self._shutdown)
    
    def register(self, method: str, handler: Callable):
        """注册方法处理器"""
        self._methods[method] = handler
    
    def run(self):
        """启动主循环"""
        if hasattr(sys.stdout, 'reconfigure'):
            sys.stdout.reconfigure(line_buffering=True)
        
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            
            try:
                req = json.loads(line)
                resp = self._dispatch(req)
            except json.JSONDecodeError as e:
                resp = {"error": {"code": -32700, "message": str(e)}}
            except Exception as e:
                resp = {"error": {"code": -32603, "message": str(e)}}
            
            resp["jsonrpc"] = "2.0"
            resp["id"] = req.get("id") if isinstance(req, dict) else None
            print(json.dumps(resp, ensure_ascii=False), flush=True)
    
    def _dispatch(self, req: dict) -> dict:
        method = req.get("method")
        params = req.get("params", {})
        
        handler = self._methods.get(method)
        if not handler:
            return {"error": {"code": -32601, "message": f"Method not found: {method}"}}
        
        result = handler(params)
        return {"result": result}
    
    def _shutdown(self, _):
        sys.exit(0)
    
    @staticmethod
    def send_progress(percent: int, message: str = ""):
        """发送进度通知（通过 stderr）"""
        notification = {
            "jsonrpc": "2.0",
            "method": "progress",
            "params": {"percent": percent, "message": message}
        }
        print(json.dumps(notification, ensure_ascii=False), file=sys.stderr, flush=True)
```

### 14.5 使用 SDK 的插件示例

```python
#!/usr/bin/env python3
"""使用 SDK 的插件示例"""
from reportgenx_sdk import PluginHandler, DocumentEditor, ImageProcessor
import os

class VulnReportHandler(PluginHandler):
    def __init__(self):
        super().__init__()
        self.plugin_dir = os.path.dirname(__file__)
        
        # 注册方法
        self.register("get_info", self.get_info)
        self.register("get_schema", self.get_schema)
        self.register("generate", self.generate)
    
    def get_info(self, _):
        return {"id": "vuln_report", "version": "2.0.0", "name": "风险隐患报告"}
    
    def get_schema(self, _):
        import json
        schema_path = os.path.join(self.plugin_dir, "schema.json")
        with open(schema_path, encoding="utf-8") as f:
            return json.load(f)
    
    def generate(self, params):
        data = params.get("data", {})
        output_dir = params.get("output_dir", ".")
        
        self.send_progress(10, "加载模板...")
        template_path = os.path.join(self.plugin_dir, "templates", "default.docx")
        editor = DocumentEditor(template_path)
        
        self.send_progress(30, "替换内容...")
        replacements = {
            "#title#": data.get("title", ""),
            "#date#": data.get("date", ""),
            "#content#": data.get("content", ""),
        }
        editor.replace_text(replacements)
        editor.replace_in_tables(replacements)
        
        self.send_progress(60, "处理图片...")
        if data.get("screenshot"):
            ImageProcessor.insert_image(
                editor.doc, "#screenshot#", data["screenshot"]
            )
        
        self.send_progress(90, "保存文件...")
        output_path = os.path.join(output_dir, f"{data.get('title', 'report')}.docx")
        editor.save(output_path)
        
        self.send_progress(100, "完成")
        return {"success": True, "file": output_path}

if __name__ == "__main__":
    VulnReportHandler().run()
```

### 14.6 SDK 安装与分发

```bash
# 从 PyPI 安装（正式发布后）
pip install reportgenx-plugin-sdk

# 开发模式安装（本地）
cd reportgenx-plugin-sdk
pip install -e .
```

### 14.7 SDK 版本策略

| SDK 版本 | 协议版本 | 兼容性 |
|----------|----------|--------|
| 1.0.x | 1.0 | 初版，基础功能 |
| 1.1.x | 1.0 | 新增功能，向后兼容 |
| 2.0.x | 2.0 | 破坏性变更，需升级插件 |

---

## 15. 插件依赖声明

### 14.1 manifest.json 中声明

```json
{
  "dependencies": {
    "python-docx": ">=0.8.11",
    "Pillow": ">=9.0.0",
    "openpyxl": ">=3.0.0"
  }
}
```

### 14.2 依赖打包策略

由于插件以独立可执行文件分发（PyInstaller），依赖已打包在内。`dependencies` 字段主要用于：

- 文档说明
- 源码开发模式下的依赖安装
- 未来插件市场的兼容性检查

### 14.3 开发模式支持

```bash
# 开发模式：直接运行 Python 脚本
cd plugins/my_plugin
pip install -r requirements.txt
python handler.py
```

manifest.json 中可声明开发模式入口：

```json
{
  "handler": {
    "type": "script",
    "entry": "handler.py",
    "runtime": "python3"
  }
}
```

---

## 16. MCP 支持（v1.1 规划）

> **注意**：MCP 支持作为 v1.1 版本的功能，初版 v1.0 聚焦于插件隔离 + Web 化。

### 16.1 什么是 MCP

MCP (Model Context Protocol) 是一种标准协议，允许 AI 工具调用外部服务。ReportGenX 可以将报告生成能力暴露为 MCP 服务。

### 16.2 MCP 服务器实现

```python
# backend/mcp_server.py (可选模块)
from mcp.server import Server
from mcp.types import Tool, TextContent

server = Server("reportgenx")

@server.list_tools()
async def list_tools():
    plugins = plugin_host.discover()
    return [
        Tool(
            name=f"generate_{p['id']}",
            description=f"生成{p['name']}",
            inputSchema=await plugin_host.call(p['id'], 'get_schema', {})
        )
        for p in plugins
    ]

@server.call_tool()
async def call_tool(name: str, arguments: dict):
    plugin_id = name.replace("generate_", "")
    result = await plugin_host.call(plugin_id, "generate", arguments)
    return [TextContent(type="text", text=f"报告已生成: {result['file']}")]
```

### 16.3 配置启用

```yaml
# config.yaml
mcp:
  enabled: false        # 默认关闭
  transport: stdio      # stdio | sse | streamable-http
```

### 16.4 现有 API → MCP Tool 映射决策

以下基于现有 37+ 个 API 路由，逐一标注是否暴露为 MCP Tool：

| 现有 API | MCP 暴露 | MCP Tool 名 | 理由 |
|----------|----------|-------------|------|
| **系统** | | | |
| `GET /` | ❌ | — | 健康检查，无业务价值 |
| `GET /api/config` | ✅ | `get_config` | LLM 需了解可用选项（危害类型、行业等） |
| `GET /api/frontend-config` | ❌ | — | 前端 UI 专用，LLM 不需要 |
| `POST /api/update-config` | ❌ | — | 系统配置变更，不应开放 |
| `GET /api/backup-db` | ❌ | — | 管理操作 |
| **URL / 信息处理** | | | |
| `POST /api/process-url` | ✅ | `process_url` | LLM 可借此解析域名/IP/ICP |
| **图片** | | | |
| `POST /api/upload-image` | ✅ | `upload_image` | 报告生成依赖截图上传 |
| **报告生成** | | | |
| `POST /api/templates/{id}/generate` | ✅ | `generate_report` | **主力**：通用模板化生成 |
| **报告管理** | | | |
| `POST /api/list-reports` | ✅ | `list_reports` | 查看已生成报告 |
| `POST /api/delete-report` | ✅ | `delete_report` | 清理报告 |
| `POST /api/merge-reports` | ✅ | `merge_reports` | 合并多份报告 |
| `POST /api/open-folder` | ❌ | — | 桌面专属操作，MCP 不适用 |
| **漏洞库** | | | |
| `GET /api/vulnerabilities` | ✅ | `list_vulnerabilities` | LLM 查询可用漏洞 |
| `GET /api/vulnerability/{id}` | ✅ | `get_vulnerability` | 获取漏洞详情 |
| `POST /api/vulnerabilities` | ⚠️ | `add_vulnerability` | 仅 admin 角色可用 |
| `PUT /api/vulnerabilities/{id}` | ⚠️ | `update_vulnerability` | 仅 admin 角色可用 |
| `DELETE /api/vulnerabilities/{id}` | ❌ | — | 删除操作风险高 |
| **ICP 备案库** | | | |
| `GET /api/icp-list` | ✅ | `list_icp` | LLM 查询备案信息 |
| `GET /api/icp-columns` | ❌ | — | 前端表格专用 |
| `POST/PUT/DELETE /api/icp-entry/*` | ❌ | — | 管理操作，不暴露 |
| **模板系统** | | | |
| `GET /api/templates` | ✅ | `list_templates` | 模板列表 |
| `GET /api/templates/{id}/schema` | ✅ | `get_schema` | 获取模板字段定义 |
| `GET /api/templates/{id}/versions` | ✅ | `get_template_versions` | 查看模板版本 |
| `GET /api/templates/{id}/data-sources` | ✅ | `get_data_sources` | 查看可用数据源 |
| `POST /api/templates/{id}/validate` | ✅ | `validate_data` | 生成前预校验 |
| `GET /api/templates/{id}/details` | ✅ | `get_template_details` | 模板元信息 |
| `GET /api/templates/{id}/preview` | ❌ | — | 前端预览专用 |
| `POST /api/templates/reload` | ❌ | — | 管理操作 |
| `*export*` / `*import*` / `DELETE` | ❌ | — | 管理操作，不暴露 |

> **⚠️** = 仅在 admin Token 下可调用。MCP 端安全原则：默认只开放只读工具，生成/写入类工具需单独授权。

### 16.5 MCP 运行模式

| 模式 | 传输方式 | 适用场景 |
|------|----------|----------|
| 本地 | stdio | 桌面客户端、本地 AI Agent |
| 远程 | streamable-http / SSE | 网页端、云端 AI Agent |

---
## 17. 与现有架构对比

| 维度 | 现有架构 | 新架构 | 变化 |
|------|----------|--------|------|
| **运行形态** | Electron 桌面应用 | 独立 Web 服务端 | 重大变更 |
| **前端** | Electron webContents | 浏览器访问 | 重大变更 |
| **插件格式** | `handler.py` + `schema.yaml` | `manifest.json` + 可执行文件 | 新增（兼容旧格式） |
| **插件通信** | Python `import` | JSON-RPC over stdin/stdout | 重大变更 |
| **插件隔离** | 同进程 | 独立进程 | 新增 |
| **热更新** | 需重启 | 上传即生效 | 新增 |
| **数据库** | SQLite 硬编码 | DAL 抽象 + 多库支持 | 增强 |
| **认证** | 无 | JWT + 角色控制 | 新增 |
| **部署** | 桌面安装包 | Docker / systemd | 重大变更 |
| **多用户** | 单用户桌面 | 多用户共享 | 新增 |

---

## 18. 向后兼容与迁移方案

### 17.1 兼容层设计

现有 4 个模板（`vuln_report`, `penetration_test`, `intrusion_report`, `Attack_Defense`）通过兼容层继续运行：

```python
# backend/core/plugin_compat.py
class LegacyPluginAdapter:
    """将旧式 handler.py 适配为新插件协议"""

    def __init__(self, template_id: str, template_dir: str):
        self.template_id = template_id
        self.template_dir = template_dir

    async def call(self, method: str, params: dict) -> dict:
        if method == "get_info":
            return self._get_info()
        elif method == "get_schema":
            return self._get_schema()
        elif method == "generate":
            return await self._generate(params)
        elif method == "health":
            return {"status": "ok"}

    def _get_schema(self) -> dict:
        """读取 schema.yaml 并转换为 JSON"""
        schema_path = os.path.join(self.template_dir, "schema.yaml")
        with open(schema_path, encoding="utf-8") as f:
            return yaml.safe_load(f)

    async def _generate(self, params: dict) -> dict:
        """调用旧式 handler 生成报告"""
        # 动态导入旧 handler
        handler_module = importlib.import_module(
            f"templates.{self.template_id}.handler"
        )
        handler_class = handler_module.get_handler_class()
        handler = handler_class(self.template_dir)
        success, path, msg = handler.generate(
            params.get("data", {}),
            params.get("output_dir", "output")
        )
        return {"success": success, "file": path, "message": msg}
```

### 17.2 Schema 格式转换工具

```python
def convert_schema_yaml_to_json(yaml_path: str, json_path: str):
    """将 schema.yaml 转换为 schema.json"""
    import yaml, json

    with open(yaml_path, encoding='utf-8') as f:
        schema = yaml.safe_load(f)

    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(schema, f, ensure_ascii=False, indent=2)
```

### 17.3 迁移路径

```
阶段 1 (初版)：兼容层 + 新插件并行
    旧模板：通过 LegacyPluginAdapter 运行
    新插件：通过 PluginHost 运行
    前端：统一展示新旧模板

阶段 2 (成熟期)：逐步迁移旧模板
    将 vuln_report 等迁移为独立可执行文件
    保留兼容层作为降级方案

阶段 3 (后期)：移除兼容层
    所有插件统一为新架构
    移除旧模板加载逻辑
```

### 17.4 现有插件迁移示例

以 `vuln_report` 为例：

```
迁移前:
templates/vuln_report/
├── schema.yaml          # YAML 表单定义
├── handler.py           # 依赖 core.* 模块
└── template.docx

迁移后:
plugins/vuln_report/
├── manifest.json        # 新增
├── schema.json          # 从 YAML 转换
├── handler/
│   └── handler.exe      # PyInstaller 打包
├── templates/
│   └── default.docx     # 从 template.docx 复制
└── README.md            # 新增
```

### 17.5 迁移脚本

```python
# scripts/migrate_template.py
def migrate_template(template_id: str):
    """将旧模板迁移为新插件格式"""
    src = f"templates/{template_id}"
    dst = f"plugins/{template_id}"

    os.makedirs(f"{dst}/handler", exist_ok=True)
    os.makedirs(f"{dst}/templates", exist_ok=True)

    # 1. 转换 schema
    convert_schema_yaml_to_json(f"{src}/schema.yaml", f"{dst}/schema.json")

    # 2. 复制模板
    shutil.copy(f"{src}/template.docx", f"{dst}/templates/default.docx")

    # 3. 生成 manifest.json
    manifest = {
        "id": template_id,
        "name": template_id.replace("_", " ").title(),
        "version": "2.0.0",
        "protocol": "1.0",
        "handler": {"type": "executable", "entry": {"windows": "handler/handler.exe"}},
        "frontend": {"type": "schema", "file": "schema.json"}
    }
    with open(f"{dst}/manifest.json", "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    # 4. 打包 handler
    print(f"请手动运行: pyinstaller --onefile --name handler {src}/handler.py")
```

---

## 19. 日志体系

### 18.1 日志架构

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  主程序日志   │     │  插件日志     │     │  访问日志     │
│  app.log     │     │  stderr → 聚合│     │  access.log  │
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       │                    │                    │
       └────────────────────┼────────────────────┘
                            │
                     ┌──────▼───────┐
                     │  日志聚合器   │
                     │  (按日轮转)   │
                     └──────┬───────┘
                            │
                  ┌─────────▼─────────┐
                  │ output/logs/      │
                  │ ├── app.log       │
                  │ ├── plugin.log    │
                  │ └── access.log    │
                  └───────────────────┘
```

### 18.2 日志格式

```python
# 主程序日志格式
LOG_FORMAT = "%(asctime)s [%(levelname)s] %(name)s: %(message)s"

# 插件日志格式（从 stderr 解析）
PLUGIN_LOG_FORMAT = "%(asctime)s [%(levelname)s] [plugin:%(plugin_id)s] %(message)s"
```

### 18.3 插件日志收集

插件通过 stderr 输出日志，主程序后台线程收集：

```python
import threading

def collect_plugin_logs(process, plugin_id: str, logger):
    """后台线程：收集插件 stderr 日志"""
    def _reader():
        for line in process.stderr:
            line = line.decode('utf-8', errors='replace').strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
                if msg.get("method") == "progress":
                    # 进度通知，转发给前端
                    pass
                else:
                    logger.info(f"[plugin:{plugin_id}] {line}")
            except json.JSONDecodeError:
                logger.info(f"[plugin:{plugin_id}] {line}")

    thread = threading.Thread(target=_reader, daemon=True)
    thread.start()
    return thread
```

### 18.4 日志配置

```yaml
# config.yaml
logging:
  level: INFO                  # DEBUG | INFO | WARNING | ERROR
  dir: output/logs             # 日志目录
  max_size_mb: 50              # 单文件最大 MB
  backup_count: 5              # 保留文件数
  console: true                # 是否输出到控制台
```

### 18.5 日志存储

```
output/logs/
├── app.log                # 主程序日志（按日期轮转）
├── app.log.2026-02-25
├── plugin.log             # 所有插件日志（聚合）
├── plugin.log.2026-02-25
└── access.log             # HTTP 访问日志
```

---

## 20. 部署方案

### 19.1 直接运行

```bash
# 安装依赖
cd backend
pip install -r requirements.txt

# 启动服务
uvicorn api:app --host 0.0.0.0 --port 8000
```

### 19.2 Docker 部署

```dockerfile
# Dockerfile
FROM python:3.11-slim

WORKDIR /app

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ .

EXPOSE 8000

CMD ["uvicorn", "api:app", "--host", "0.0.0.0", "--port", "8000"]
```

### 19.3 Docker Compose

```yaml
# docker-compose.yml
version: "3.8"

services:
  reportgenx:
    build: .
    ports:
      - "8000:8000"
    volumes:
      - ./data:/app/data            # 数据库持久化
      - ./plugins:/app/plugins      # 插件目录
      - ./output:/app/output        # 输出文件
    environment:
      - CONFIG_PATH=/app/config.yaml
    restart: unless-stopped
```

### 19.4 systemd 部署

```ini
# /etc/systemd/system/reportgenx.service
[Unit]
Description=ReportGenX Report Generator
After=network.target

[Service]
Type=simple
User=reportgenx
WorkingDirectory=/opt/reportgenx/backend
ExecStart=/opt/reportgenx/venv/bin/uvicorn api:app --host 0.0.0.0 --port 8000
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

### 19.5 反向代理（Nginx）

```nginx
# /etc/nginx/conf.d/reportgenx.conf
server {
    listen 80;
    server_name report.example.com;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket 支持（进度推送）
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    # 限制上传大小
    client_max_body_size 100M;
}
```

### 19.6 部署拓扑

```
┌─────────────────────────────────────────────┐
│                  Nginx                      │
│            (反向代理 + HTTPS)                │
└──────────────────┬──────────────────────────┘
                   │
        ┌──────────▼──────────┐
        │   FastAPI (8000)    │
        │   ├── 静态文件       │
        │   ├── API 路由       │
        │   └── 插件管理       │
        └──────────┬──────────┘
                   │
        ┌──────────▼──────────┐
        │   数据层             │
        │   ├── SQLite / MySQL│
        │   ├── 插件目录       │
        │   └── 输出文件       │
        └─────────────────────┘
```

---

## 21. 测试策略

### 20.1 测试层次

| 层次 | 工具 | 覆盖目标 |
|------|------|----------|
| 单元测试 | pytest | 核心模块（DAL、协议解析、认证） |
| 集成测试 | pytest + httpx | API 路由、插件调用链 |
| 插件测试 | 独立运行 | 插件 Handler 的 stdin/stdout |
| E2E 测试 | Playwright / Selenium | 前端完整流程 |
| 性能测试 | locust | 并发生成、大文件处理 |

### 20.2 单元测试示例

```python
# tests/test_database.py
import pytest
from core.database import SQLiteBackend

@pytest.fixture
def db(tmp_path):
    backend = SQLiteBackend(str(tmp_path / "test.db"))
    backend.execute("CREATE TABLE test (id INTEGER, name TEXT)")
    return backend

def test_insert_and_query(db):
    db.execute("INSERT INTO test VALUES (?, ?)", (1, "hello"))
    result = db.fetchone("SELECT * FROM test WHERE id = ?", (1,))
    assert result["name"] == "hello"

def test_fetchall(db):
    db.execute("INSERT INTO test VALUES (?, ?)", (1, "a"))
    db.execute("INSERT INTO test VALUES (?, ?)", (2, "b"))
    results = db.fetchall("SELECT * FROM test")
    assert len(results) == 2
```

### 20.3 插件协议测试

```python
# tests/test_plugin_protocol.py
import subprocess, json

def test_plugin_health():
    proc = subprocess.Popen(
        ["plugins/vuln_report/handler/handler.exe"],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE
    )

    request = json.dumps({"jsonrpc": "2.0", "id": "1", "method": "health"}) + "\n"
    proc.stdin.write(request.encode())
    proc.stdin.flush()

    response = json.loads(proc.stdout.readline())
    assert response["result"]["status"] == "ok"

    proc.terminate()
```

### 20.4 API 集成测试

```python
# tests/test_api.py
import pytest
from httpx import AsyncClient
from api import app

@pytest.mark.anyio
async def test_list_plugins():
    async with AsyncClient(app=app, base_url="http://test") as client:
        resp = await client.get("/api/plugins")
        assert resp.status_code == 200
        assert "plugins" in resp.json()
```

---

## 22. 实施计划

### 22.1 总览

- **总工期**：6 周（30 个工作日）
- **版本目标**：v2.0.0（插件隔离 + Web 化）
- **后续版本**：v2.1.0（MCP 支持）
- **里程碑**：6 个 Phase

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        v2.0.0 实施路线图                                  │
├──────────┬──────────┬──────────┬──────────┬──────────┬──────────────────┤
│  Week 1  │  Week 2  │  Week 3  │  Week 4  │  Week 5  │     Week 6       │
│ 基础设施  │ 插件核心  │  SDK+迁移 │  Web前端  │ 认证+部署 │   测试+发布      │
├──────────┼──────────┼──────────┼──────────┼──────────┼──────────────────┤
│ DAL抽象  │ Protocol │ SDK开发  │ 前端迁移  │ JWT认证  │ 集成测试         │
│ 配置管理  │ Host核心 │ 4插件迁移│ API改造  │ Docker   │ 性能测试         │
│ 数据库   │ Registry │ 兼容层   │ 表单渲染  │ Nginx    │ 安全审查+文档    │
│          │ 进程池   │          │          │ 白名单   │ v2.0.0 发布      │
└──────────┴──────────┴──────────┴──────────┴──────────┴──────────────────┘
```

### 22.2 Phase 1：基础设施（第 1-5 天）

**目标**：搭建核心基础设施，确保现有功能不退化

| 天 | 任务 | 产出物 | 验收标准 |
|----|------|--------|----------|
| D1 | 项目结构重组 + 配置模块 | `ConfigManager` | 配置可加载 |
| D2 | DAL 接口定义 + SQLiteBackend | `database.py` | 单元测试通过 |
| D3 | `data_reader_db.py` 改造 | 使用 DAL | 现有 API 正常 |
| D4 | 数据库初始化 + 用户表 | `db_init.py` | 自动建表 |
| D5 | 集成验证 | - | 回归测试通过 |

### 22.3 Phase 2：插件核心（第 6-10 天）

**目标**：实现插件系统核心，支持进程池并发

| 天 | 任务 | 产出物 | 验收标准 |
|----|------|--------|----------|
| D6 | JSON-RPC 协议层 | `plugin_protocol.py` | 协议测试通过 |
| D7 | PluginHost 核心 | 启动/调用/停止 | 示例插件可调用 |
| D8 | 进程池实现 | `PluginProcessPool` | 并发调用正常 |
| D9 | PluginRegistry | manifest 校验 | 插件发现正常 |
| D10 | 脚本模式支持 | `handler.type=script` | Python 脚本可运行 |

**关键产出**：
```
backend/core/
├── plugin_protocol.py   # JSON-RPC 通信
├── plugin_host.py       # 进程管理 + 进程池
└── plugin_registry.py   # 插件注册表
```

### 22.4 Phase 3：SDK 与迁移（第 11-15 天）

**目标**：开发插件 SDK，迁移现有 4 个插件

| 天 | 任务 | 产出物 | 验收标准 |
|----|------|--------|----------|
| D11 | SDK 核心模块 | `reportgenx-plugin-sdk` | 可 pip install |
| D12 | DocumentEditor 封装 | SDK document.py | 文档操作正常 |
| D13 | 兼容层实现 | `LegacyPluginAdapter` | 旧插件可运行 |
| D14 | vuln_report 迁移 | 新格式插件 | 生成报告正常 |
| D15 | 其余 3 插件迁移 | 4 个新插件 | 全部测试通过 |

**SDK 结构**：
```
reportgenx-plugin-sdk/
├── reportgenx_sdk/
│   ├── document.py      # 文档编辑
│   ├── image.py         # 图片处理
│   ├── table.py         # 表格处理
│   └── protocol.py      # 协议助手
└── setup.py
```

### 22.5 Phase 4：Web 前端（第 16-20 天）

**目标**：前端迁移为纯 Web，脱离 Electron 依赖

| 天 | 任务 | 产出物 | 验收标准 |
|----|------|--------|----------|
| D16 | 静态文件托管 | FastAPI mount | 浏览器可访问 |
| D17 | api.js 改造 | 移除 Electron 依赖 | API 调用正常 |
| D18 | auth.js 登录模块 | 登录/登出 UI | 认证流程完整 |
| D19 | 模板选择器统一 | 新旧插件合并展示 | 列表正常 |
| D20 | 热更新 API + UI | 插件上传界面 | 上传即生效 |

### 22.6 Phase 5：认证与部署（第 21-25 天）

**目标**：完成认证系统和生产部署方案

| 天 | 任务 | 产出物 | 验收标准 |
|----|------|--------|----------|
| D21 | JWT 认证模块 | `auth.py` | Token 生成/验证 |
| D22 | 认证中间件 + 白名单 | `AuthMiddleware` | 权限控制正常 |
| D23 | 用户管理 API | CRUD 接口 | 用户增删改查 |
| D24 | Dockerfile + compose | 容器配置 | 容器启动正常 |
| D25 | Nginx 配置 + HTTPS | 反向代理 | 生产环境可用 |

### 22.7 Phase 6：测试与发布（第 26-30 天）

**目标**：完成测试、文档和正式发布

| 天 | 任务 | 产出物 | 验收标准 |
|----|------|--------|----------|
| D26 | 日志体系完善 | 插件日志收集 | 日志可查询 |
| D27 | 集成测试 | pytest 测试套件 | 覆盖率 > 70% |
| D28 | 性能测试 | locust 报告 | 并发 10 正常 |
| D29 | 安全审查 + 文档 | 安全报告 + 用户手册 | 审查通过 |
| D30 | 发版准备 | v2.0.0 Release | 发布完成 |

### 22.8 v2.1.0 MCP 支持（后续迭代）

MCP 作为独立版本迭代，预计 2 周：

| 周 | 任务 | 产出物 |
|----|------|--------|
| W1 | MCP Server 实现 | `mcp_server.py` |
| W1 | Tool 映射 | 现有 API → MCP Tool |
| W2 | 多传输支持 | stdio / SSE |
| W2 | 文档 + 测试 | MCP 集成指南 |

### 22.9 风险矩阵

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| PyInstaller 打包体积过大 | 中 | 中 | 提供脚本模式替代 |
| Windows 文件锁定 | 高 | 中 | 重试机制 + 延迟删除 |
| 旧插件依赖 `core.*` 太深 | 高 | 高 | SDK 封装 + 兼容层 |
| 并发 SQLite 写入冲突 | 中 | 高 | WAL 模式 + 写锁 |
| 前端迁移遗漏功能 | 中 | 中 | 功能清单逐项验证 |
| 认证绕过漏洞 | 低 | 高 | 安全审查 + 渗透测试 |

### 22.10 里程碑检查点

| 里程碑 | 日期 | 检查项 |
|--------|------|--------|
| M1 基础设施 | D5 | DAL 可用，现有功能正常 |
| M2 插件核心 | D10 | 示例插件可调用，进程池正常 |
| M3 SDK 完成 | D15 | 4 个插件迁移完成 |
| M4 Web 前端 | D20 | 浏览器可完整使用 |
| M5 认证部署 | D25 | Docker 部署正常 |
| M6 正式发布 | D30 | v2.0.0 发布 |

---

## 23. 已确认决策

| # | 问题 | 决策 | 备注 |
|---|------|------|------|
| 1 | 插件打包方式 | 支持 executable + script 双模式 | 脚本模式更轻量 |
| 2 | 进程池 | 需要，支持 `max_instances` 配置 | 默认 1，可配置 |
| 3 | 认证默认状态 | 默认开启 | 支持 IP 白名单 |
| 4 | 插件依赖问题 | 发布 `reportgenx-plugin-sdk` | 封装常用功能 |
| 5 | MCP 支持 | 后置到 v2.1.0 | 聚焦核心功能 |
| 6 | 插件市场 | 暂不做，zip 包上传即可 | 管理后台提供上传入口 |
| 7 | 数据源访问 | 主程序注入 params | 插件无状态，单向通信 |
| 8 | 多数据库 | 初期 SQLite，DAL 预留 | 后续按需切换 MySQL |
| 9 | Electron 壳 | 保留，简化为浏览器壳 | 支持自定义服务器 URL |
| 10 | 插件签名 | 暂不考虑 | 项目成熟后再引入 |

---

## 24. Electron 客户端设计

### 24.1 定位

重构后 Electron 简化为「浏览器壳」，不再管理后端进程：

```
┌─────────────────────────────────────┐
│  Electron 客户端（浏览器壳）          │
│  ├── 加载配置的服务器 URL            │
│  ├── 提供原生窗口体验                │
│  └── 支持开发/生产环境切换           │
└─────────────────────────────────────┘
           │
           ▼ HTTP
┌─────────────────────────────────────┐
│  FastAPI 服务端（独立部署）           │
└─────────────────────────────────────┘
```

### 24.2 配置文件

```json
// electron-config.json
{
  "mode": "production",
  "servers": {
    "development": "http://localhost:8000",
    "production": "https://report.example.com"
  },
  "window": {
    "width": 1200,
    "height": 800,
    "title": "ReportGenX"
  }
}
```

### 24.3 主进程实现

```javascript
// main.js (简化版)
const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

// 加载配置
const configPath = path.join(__dirname, 'electron-config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

// 获取服务器 URL
function getServerUrl() {
    const mode = config.mode || 'production';
    return config.servers[mode] || config.servers.production;
}

let mainWindow;

app.whenReady().then(() => {
    mainWindow = new BrowserWindow({
        width: config.window?.width || 1200,
        height: config.window?.height || 800,
        title: config.window?.title || 'ReportGenX',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    const serverUrl = getServerUrl();
    console.log(`Loading: ${serverUrl}`);
    mainWindow.loadURL(serverUrl);

    // 开发模式打开 DevTools
    if (config.mode === 'development') {
        mainWindow.webContents.openDevTools();
    }
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
```

### 24.4 环境切换

```bash
# 开发环境（连接本地后端）
# 修改 electron-config.json: "mode": "development"
npm run start

# 生产环境（连接远程服务器）
# 修改 electron-config.json: "mode": "production"
npm run start
```

### 24.5 打包配置

```json
// package.json
{
  "build": {
    "appId": "com.reportgenx.client",
    "productName": "ReportGenX",
    "files": [
      "main.js",
      "electron-config.json"
    ],
    "extraResources": []
  }
}
```

---

## 25. 待讨论问题

暂无待讨论问题，所有关键决策已确认。

---

> **文档版本**: v3.2
> **最后更新**: 2026-02-27
> **维护者**: ReportGenX Team

# 📦 部署与运维指南

> 更新日期: 2026-02-04

## 目录结构

打包后的应用结构如下：

```
app/
├── api.exe                    # 后端服务
├── config.yaml                # 配置文件
├── data/                      # 数据库目录
│   └── combined.db
├── templates/                 # 模板目录 (外部可扩展)
│   ├── vuln_report/
│   ├── intrusion_report/
│   └── ...
└── output/                    # 报告输出目录
```

## 添加新模板

在部署环境中添加新模板无需重新编译 `api.exe`。

1.  将新模板文件夹复制到 `templates/` 目录。
2.  确保包含 `schema.yaml` 和 `handler.py`。
3.  调用热加载接口或重启应用。

## 热加载

ReportGenX 支持热加载模板配置和处理逻辑。

**触发方式**：
发送 POST 请求到 `/api/templates/reload`。

**限制**：
- ✅ 支持：修改 `schema.yaml` (字段、验证规则等)
- ✅ 支持：修改 `handler.py` 中的逻辑代码
- ❌ 不支持：新增 API 路由 (需要重启)
- ❌ 不支持：安装新的 Python 依赖 (需要环境支持)

## 依赖管理

如果新模板依赖了额外的 Python 包：

1.  **打包前**：确保在构建环境中安装了该包，PyInstaller 会将其打包进 `api.exe`。
2.  **打包后**：无法动态安装 Python 包。如果必须使用新包，需要重新打包 `api.exe`。

建议在开发模板时尽量使用标准库或已包含的第三方库（如 `requests`, `pandas`, `python-docx`, `pillow` 等）。

## 故障排查

### 模板无法加载

查看 `output/logs/` 下的日志文件。

- `InvalidTemplateIdError`: 模板目录名包含非法字符。
- `DependencyError`: 缺少必要的 Python 包。
- `SyntaxError`: `handler.py` 代码有误。

### 路由 404

如果添加了带自定义路由的模板，必须重启 `api.exe` 才能生效。热加载无法注册新路由。

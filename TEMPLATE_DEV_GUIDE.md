# 多模板系统开发指南

> ReportGenX 多模板架构开发文档  
> 版本: 1.0.2  
> 更新日期: 2026-02-04

---

## 📋 目录

1. [架构概述](#架构概述)
2. [快速开始](#快速开始)
3. [Schema 规范](#schema-规范)
4. [Handler 开发](#handler-开发)
5. [API 接口](#api-接口)
6. [前端集成](#前端集成)
7. [最佳实践](#最佳实践)

---

## 架构概述

### 系统架构图

```
┌─────────────────────────────────────────────────────────────┐
│                      前端 (Electron)                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ 模板选择器   │  │ 动态表单    │  │ 模板预览             │  │
│  │ (selector)  │  │ (renderer)  │  │ (preview)           │  │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘  │
└─────────┼────────────────┼───────────────────┼──────────────┘
          │                │                   │
          ▼                ▼                   ▼
┌─────────────────────────────────────────────────────────────┐
│                    REST API (FastAPI)                        │
│  GET /api/templates                                          │
│  GET /api/templates/{id}/schema                              │
│  POST /api/templates/{id}/generate                           │
└─────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────┐
│                    Template Manager                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ Schema解析   │  │ 数据源解析   │  │ 验证规则            │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────┐
│                    Handler Registry                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │VulnReport   │  │ Intrusion   │  │ 其他模板Handler...   │  │
│  │Handler      │  │ Handler     │  │                     │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 核心组件

| 组件 | 文件位置 | 职责 |
|------|----------|------|
| TemplateManager | `core/template_manager.py` | 加载/解析模板 Schema，管理版本 |
| BaseTemplateHandler | `core/base_handler.py` | 抽象基类，定义生成流程 |
| HandlerRegistry | `core/base_handler.py` | Handler 注册与查找 |
| AppFormRenderer | `src/js/form-renderer.js` | 动态表单渲染 |

---

## 快速开始

### 创建新模板的步骤

#### 1️⃣ 创建模板目录

```
backend/templates/
└── your_template/           # 模板ID (唯一标识)
    ├── schema.yaml          # 模板定义文件 (必需)
    ├── handler.py           # 生成处理器 (必需)
    └── template.docx        # Word模板文件 (可选)
```

#### 2️⃣ 定义 Schema

创建 `schema.yaml`:

```yaml
id: your_template
name: 你的模板名称
description: 模板描述
version: "1.0.0"
icon: "📄"
author: Your Name

template_file: template.docx

field_groups:
  - id: basic
    name: 基础信息
    order: 1

fields:
  - key: title
    label: 标题
    type: text
    required: true
    group: basic
    order: 1

output:
  filename_pattern: "{title}_{date}.docx"
```

#### 3️⃣ 实现 Handler

创建 `handler.py`:

```python
from core.base_handler import BaseTemplateHandler, register_handler

@register_handler("your_template")
class YourTemplateHandler(BaseTemplateHandler):
    
    def __init__(self, template_manager, config):
        super().__init__(template_manager, config)
        self.template_id = "your_template"
    
    def generate(self, data, output_path):
        # 实现报告生成逻辑
        from docx import Document
        
        # ... 生成文档 ...
        
        return output_path
```

#### 4️⃣ (可选) 添加自定义 API

如果模板需要专属后端接口，可以在 `handler.py` 中定义 `router`：

```python
from fastapi import APIRouter

# 定义模板专属路由
router = APIRouter(
    prefix="/api/templates/your_template",
    tags=["your_template"]
)

@router.get("/custom-data")
def get_custom_data():
    return {"data": "some data"}
```

#### 5️⃣ 热加载模板

无需重启服务，调用热加载接口即可生效：

```bash
curl -X POST http://localhost:8000/api/templates/reload
```

> **注意**：如果添加了自定义 API 路由，需要重启应用才能生效。仅修改 Handler 逻辑或 Schema 支持热加载。

---

## Schema 规范

### 完整 Schema 结构

```yaml
# ===== 基本信息 =====
id: template_id              # 唯一标识 (必需，与目录名一致)
name: 模板名称               # 显示名称 (必需)
description: 模板描述        # 描述 (可选)
version: "1.0.0"            # 版本号 (推荐)
icon: "📄"                  # 图标 (可选)
author: 作者                # 作者 (可选)
create_time: "2026-01-26"   # 创建时间 (可选)
update_time: "2026-01-26"   # 更新时间 (可选)

template_file: template.docx  # 模板文件名

# ===== 依赖声明 (可选) =====
dependencies:
  - requests>=2.28.0
  - pandas>=1.5.0

# ===== 字段分组 =====
field_groups:
  - id: group_id            # 分组ID
    name: 分组名称          # 显示名称
    icon: "📋"             # 图标 (可选)
    order: 1               # 排序 (数字越小越靠前)
    collapsed: false       # 默认是否折叠

# ===== 数据源定义 =====
data_sources:
  - id: source_id           # 数据源ID (用于字段引用)
    type: config            # 类型: config, database, api
    description: 描述
    config_key: key_name    # type=config 时的配置键名

# ===== 字段定义 =====
fields:
  - key: field_key          # 字段键名 (必需，唯一)
    label: 字段标签         # 显示标签 (必需)
    type: text              # 字段类型 (见下表)
    required: false         # 是否必填
    default: ""             # 默认值 ("today" 表示当前日期)
    placeholder: ""         # 输入提示
    group: group_id         # 所属分组
    order: 1                # 排序
    readonly: false         # 是否只读
    source: source_id       # 数据源引用 (type=select时)
    options: []             # 选项列表 (type=select时)
    template_placeholder: "#field_key#"  # 模板中的占位符

# ===== 行为定义 =====
behaviors:
  - id: behavior_id
    trigger:
      field: trigger_field  # 触发字段
      event: change         # 触发事件
    actions:
      - type: compute       # 动作类型: compute, api_call, set_value
        target: target_field
        rules:
          value1: result1
          value2: result2

# ===== 验证规则 =====
validation:
  rules:
    - fields: [field1, field2]
      rule: required
      message: 错误提示信息

# ===== 输出配置 =====
output:
  filename_pattern: "{field}_{date}.docx"
  output_dir: "{unit_name}"
  log_to_file: true
  log_pattern: "{date}_output.txt"

# ===== 预览配置 =====
preview:
  title: 预览标题
  fields:
    - key: field_key
      label: 显示标签
```

### 字段类型

| 类型 | 说明 | 特殊属性 |
|------|------|----------|
| `text` | 单行文本输入 | `placeholder` |
| `textarea` | 多行文本输入 | `rows` |
| `select` | 下拉选择框 | `options`, `source` |
| `searchable_select` | 可搜索下拉框 | `search_placeholder` |
| `date` | 日期选择 | `default: "today"` |
| `image` | 单张图片 | `accept`, `paste_enabled` |
| `image_list` | 多张图片 | `max_count`, `with_description` |
| `hidden` | 隐藏字段 | - |

### 选项定义格式

```yaml
# 简单格式
options:
  - 选项1
  - 选项2

# 对象格式 (推荐)
options:
  - value: opt1
    label: 选项一
  - value: opt2
    label: 选项二
```

---

## Handler 开发

### BaseTemplateHandler 接口

```python
class BaseTemplateHandler(ABC):
    """模板处理器基类"""
    
    def __init__(self, template_manager, config: Dict):
        self.template_manager = template_manager
        self.config = config
    
    def preprocess(self, data: Dict) -> Dict:
        """预处理数据 (可覆盖)"""
        return data
    
    @abstractmethod
    def generate(self, data: Dict, output_path: str) -> str:
        """生成报告 (必须实现)"""
        pass
    
    def validate(self, data: Dict) -> Tuple[bool, List[str]]:
        """验证数据 (可覆盖)"""
        pass
    
    def postprocess(self, result: Dict) -> Dict:
        """后处理 (可覆盖)"""
        return result
    
    def run(self, data: Dict, base_output_dir: str) -> Dict:
        """完整执行流程"""
        # 1. preprocess -> 2. validate -> 3. generate -> 4. postprocess
        pass
```

### Handler 示例

```python
from core.base_handler import BaseTemplateHandler, register_handler
from datetime import datetime
import os

@register_handler("my_template")
class MyTemplateHandler(BaseTemplateHandler):
    
    def __init__(self, template_manager, config):
        super().__init__(template_manager, config)
        self.template_id = "my_template"
    
    def preprocess(self, data):
        """预处理：添加默认值、转换格式等"""
        processed = data.copy()
        
        # 自动生成编号
        if not processed.get('report_id'):
            processed['report_id'] = f"RPT-{datetime.now().strftime('%Y%m%d%H%M%S')}"
        
        # 添加配置值
        processed['supplier_name'] = self.config.get('supplierName', '')
        
        return processed
    
    def generate(self, data, output_path):
        """生成报告"""
        from docx import Document
        from core.document_editor import DocumentEditor
        
        # 获取模板文件
        template_file = self.template_manager.get_template_file_path(self.template_id)
        
        # 加载文档
        doc = Document(template_file)
        editor = DocumentEditor(doc)
        
        # 替换占位符
        replacements = {
            '#report_id#': data.get('report_id', ''),
            '#title#': data.get('title', ''),
            # ... 更多字段
        }
        editor.replace_all(replacements)
        
        # 保存
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        doc.save(output_path)
        
        return output_path
    
    def postprocess(self, result):
        """后处理：记录日志、发送通知等"""
        # 写入日志
        self._write_log(result)
        return result
```

### 注册装饰器

```python
@register_handler("template_id")
class MyHandler(BaseTemplateHandler):
    pass
```

使用 `@register_handler` 装饰器会自动将 Handler 注册到 `HandlerRegistry`。

---

## API 接口

### 模板相关 API

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/templates` | GET | 获取所有模板列表 |
| `/api/templates/{id}/schema` | GET | 获取模板 Schema |
| `/api/templates/{id}/versions` | GET | 获取模板版本历史 |
| `/api/templates/{id}/data-sources` | GET | 获取数据源数据 |
| `/api/templates/{id}/validate` | POST | 验证表单数据 |
| `/api/templates/{id}/generate` | POST | 生成报告 |
| `/api/templates/{id}/preview` | GET | 获取预览配置 |
| `/api/templates/{id}/check-deps` | GET | 检查模板依赖 |
| `/api/templates/reload` | POST | 重新加载模板 |

### 响应示例

**GET /api/templates**
```json
{
  "templates": [
    {
      "id": "vuln_report",
      "name": "漏洞报告",
      "description": "...",
      "icon": "🛡️",
      "version": "1.0.0"
    }
  ],
  "default_template": "vuln_report"
}
```

**POST /api/templates/{id}/generate**
```json
// Request
{
  "title": "测试报告",
  "unit_name": "测试单位",
  // ... 其他字段
}

// Response
{
  "success": true,
  "report_path": "/path/to/report.docx",
  "download_url": "/reports/测试单位/report.docx",
  "message": "报告生成成功"
}
```

---

## 前端集成

### AppFormRenderer API

```javascript
// 初始化
AppFormRenderer.init();

// 加载模板列表
await AppFormRenderer.loadTemplateList();

// 加载指定模板
await AppFormRenderer.loadTemplate('template_id');

// 获取当前模板ID
const templateId = AppFormRenderer.getTemplateId();

// 收集表单数据
const data = AppFormRenderer.collectFormData();

// 验证表单
const { valid, errors } = AppFormRenderer.validateForm();

// 提交生成报告
const result = await AppFormRenderer.submitReport();

// 设置字段值
AppFormRenderer.setFieldValue('field_key', 'value');

// 获取字段值
const value = AppFormRenderer.getFieldValue('field_key');
```

### 监听模板加载事件

```javascript
window.addEventListener('template-loaded', (e) => {
    const { templateId, schema } = e.detail;
    console.log('Template loaded:', templateId);
    // 执行自定义逻辑
});
```

---

## 最佳实践

### 1. Schema 设计

- ✅ 字段 `key` 使用 snake_case 命名
- ✅ 为每个字段指定 `group` 和 `order`
- ✅ 必填字段设置 `required: true`
- ✅ 使用 `template_placeholder` 明确占位符格式

### 2. Handler 开发

- ✅ 在 `preprocess` 中处理数据转换
- ✅ 在 `generate` 中专注文档生成
- ✅ 使用 `postprocess` 处理日志和通知
- ✅ 异常处理要完善

### 3. 模板文件

- ✅ Word 模板中使用一致的占位符格式 `#field_key#`
- ✅ 图片占位符使用独立段落
- ✅ 保持模板结构清晰
- ✅ **图片占位符处理**：无论是否有图片上传，都应调用 `replace_placeholder_with_images` 方法清理占位符，避免占位符残留在输出文档中

### 4. 数据源

- ✅ 复用已有数据源 (`config.hazard_type` 等)
- ✅ 数据源 ID 要有意义

---

## 现有模板参考

### vuln_report (漏洞报告)

- **位置**: `backend/templates/vuln_report/`
- **字段数**: 18+
- **分组**: 基础信息、目标资产、漏洞详情、证据截图

### intrusion_report (入侵痕迹报告)

- **位置**: `backend/templates/intrusion_report/`
- **字段数**: 25+
- **分组**: 基础信息、受害主机、入侵详情、时间线、证据

---

## 常见问题

### Q: 新模板不显示？

1. 检查 `schema.yaml` 语法是否正确
2. 检查 Handler 是否有语法错误
3. 确认目录名符合命名规范（字母、数字、下划线）
4. 尝试调用 `/api/templates/reload` 接口

### Q: 字段不显示？

1. 检查字段的 `group` 是否存在于 `field_groups`
2. 检查 `order` 是否设置正确

### Q: 报告生成失败？

1. 检查模板文件路径是否正确
2. 检查占位符格式是否一致
3. 查看后端控制台错误日志

---

## 联系支持

如有问题，请提交 Issue 或联系开发团队。

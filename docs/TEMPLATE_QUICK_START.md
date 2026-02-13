# 🚀 模板开发快速入门

> 更新日期: 2026-02-13

本指南将带你快速创建一个自定义报告模板。

## 1. 准备工作

确保你已经安装了 ReportGenX 并能正常运行。

## 2. 创建模板目录

在 `backend/templates/` 目录下创建一个新文件夹，例如 `my_first_template`。

> **注意**：文件夹名称只能包含字母、数字和下划线，且不能以数字开头。

## 3. 定义模板结构 (schema.yaml)

在 `my_first_template` 目录下创建 `schema.yaml` 文件：

```yaml
id: my_first_template
name: 我的第一个模板
version: "1.0.0"
description: 这是一个示例模板
author: 我自己

# 字段定义
fields:
  - key: title
    label: 报告标题
    type: text
    required: true
    placeholder: 请输入报告标题
    order: 1
  
  - key: author
    label: 报告作者
    type: text
    default: "管理员"
    order: 2

# 输出配置
output:
  filename_pattern: "{title}_报告.docx"
```

## 4. 编写处理逻辑 (handler.py)

在同一目录下创建 `handler.py` 文件：

```python
from core.base_handler import BaseTemplateHandler, register_handler
from docx import Document

@register_handler("my_first_template")
class MyFirstTemplateHandler(BaseTemplateHandler):
    
    def generate(self, data, output_path):
        # 1. 创建或加载文档
        doc = Document()
        
        # 2. 写入内容
        doc.add_heading(data.get('title', '无标题'), 0)
        doc.add_paragraph(f"作者: {data.get('author', '')}")
        doc.add_paragraph("这是由 ReportGenX 生成的报告。")
        
        # 3. 保存文档
        doc.save(output_path)
        
        return True, output_path, "生成成功"
```

## 5. 加载模板

无需重启应用！只需调用热加载接口：

**方法 A：使用工具箱**
1. 打开应用前端
2. 进入"工具箱" -> "模板管理"
3. 点击"刷新模板"按钮

**方法 B：使用命令行**
```bash
curl -X POST http://localhost:8000/api/templates/reload
```

## 6. 测试生成

1. 在前端首页，点击"选择模板"
2. 选择"我的第一个模板"
3. 填写表单并点击"生成报告"

## 进阶功能

### 添加自定义 API

如果你的模板需要从后端获取特殊数据，可以在 `handler.py` 中添加路由：

```python
from fastapi import APIRouter

router = APIRouter(
    prefix="/api/templates/my_first_template",
    tags=["my_first_template"]
)

@router.get("/hello")
def hello():
    return {"message": "Hello World"}
```

> **注意**：添加路由后需要**重启应用**才能生效。

### 声明依赖

如果你的模板使用了额外的 Python 包，请在 `schema.yaml` 中声明：

```yaml
dependencies:
  - requests>=2.0.0
  - pandas
```

系统会检查这些包是否已安装。

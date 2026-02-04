# -*- coding: utf-8 -*-
"""
@Createtime: 2026-02-02
@description: 自定义异常类 - 用于更精确的错误处理和诊断
"""


class TemplateError(Exception):
    """模板相关错误的基类"""
    def __init__(self, message: str, template_id: str = None):
        self.message = message
        self.template_id = template_id
        super().__init__(self.message)


class TemplateNotFoundError(TemplateError):
    """模板不存在"""
    def __init__(self, template_id: str):
        super().__init__(f"Template not found: {template_id}", template_id)


class TemplateLoadError(TemplateError):
    """模板加载失败"""
    def __init__(self, template_id: str, reason: str):
        super().__init__(f"Failed to load template '{template_id}': {reason}", template_id)
        self.reason = reason


class TemplateValidationError(TemplateError):
    """模板验证失败"""
    def __init__(self, template_id: str, errors: list):
        message = f"Template validation failed for '{template_id}': {'; '.join(errors)}"
        super().__init__(message, template_id)
        self.errors = errors


class InvalidTemplateIdError(TemplateError):
    """模板 ID 不符合命名规范"""
    def __init__(self, template_id: str):
        message = (
            f"Invalid template ID: '{template_id}'. "
            f"Template ID must match pattern: ^[a-zA-Z_][a-zA-Z0-9_]*$ "
            f"(only letters, numbers, underscores; cannot start with a number)"
        )
        super().__init__(message, template_id)


class SchemaParseError(TemplateError):
    """Schema 文件解析错误"""
    def __init__(self, template_id: str, file_path: str, reason: str):
        super().__init__(
            f"Failed to parse schema for '{template_id}' at {file_path}: {reason}",
            template_id
        )
        self.file_path = file_path
        self.reason = reason


class DependencyError(TemplateError):
    """模板依赖缺失"""
    def __init__(self, template_id: str, missing_deps: list):
        message = f"Template '{template_id}' has missing dependencies: {', '.join(missing_deps)}"
        super().__init__(message, template_id)
        self.missing_deps = missing_deps


class HandlerNotFoundError(TemplateError):
    """Handler 未注册"""
    def __init__(self, template_id: str):
        super().__init__(f"No handler registered for template: {template_id}", template_id)


class SecurityError(TemplateError):
    """安全相关错误"""
    def __init__(self, message: str, template_id: str = None):
        super().__init__(f"Security violation: {message}", template_id)


class PathTraversalError(SecurityError):
    """路径遍历攻击检测"""
    def __init__(self, path: str, template_id: str = None):
        super().__init__(f"Path traversal detected: {path}", template_id)
        self.path = path

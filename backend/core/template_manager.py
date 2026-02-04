# -*- coding: utf-8 -*-
"""
@Createtime: 2026-01-24
@description: 模板管理器 - 负责加载、验证和管理报告模板
支持版本管理、数据源解析、动态表单生成
"""

import os
import yaml
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, field
from datetime import datetime
from functools import lru_cache
import re
from .logger import setup_logger
from .exceptions import (
    TemplateNotFoundError,
    TemplateLoadError,
    InvalidTemplateIdError,
    SchemaParseError,
    DependencyError,
    PathTraversalError
)

# 初始化日志记录器
logger = setup_logger('TemplateManager')


def validate_template_id(template_id: str) -> bool:
    """
    验证模板 ID 是否符合 Python 模块命名规范
    
    规则：
    - 只允许字母、数字、下划线
    - 不能以数字开头
    - 推荐使用 snake_case 命名（如 vuln_report）
    
    Args:
        template_id: 模板 ID
        
    Returns:
        bool: 是否有效
        
    Examples:
        >>> validate_template_id("vuln_report")
        True
        >>> validate_template_id("my-template")
        False
        >>> validate_template_id("123test")
        False
    """
    if not template_id:
        return False
    
    # 只允许字母、数字、下划线，且不能以数字开头
    pattern = r'^[a-zA-Z_][a-zA-Z0-9_]*$'
    return bool(re.match(pattern, template_id))


def validate_path_safety(path: str, base_dir: str) -> bool:
    """
    验证路径安全性，防止路径遍历攻击（解决问题 12：安全风险）
    
    Args:
        path: 要验证的路径
        base_dir: 基础目录
        
    Returns:
        bool: 路径是否安全
        
    Examples:
        >>> validate_path_safety("templates/vuln_report", "templates")
        True
        >>> validate_path_safety("../../../etc/passwd", "templates")
        False
    """
    try:
        # 规范化路径
        abs_path = os.path.abspath(os.path.join(base_dir, path))
        abs_base = os.path.abspath(base_dir)
        
        # 检查路径是否在基础目录内
        return abs_path.startswith(abs_base)
    except Exception:
        return False




@dataclass
class FieldDefinition:
    """字段定义"""
    key: str                          # 字段键名 (对应模板中的占位符，不含 #)
    label: str                        # 显示标签
    type: str                         # 字段类型: text, select, textarea, date, image, image_list, searchable_select
    required: bool = False            # 是否必填
    default: Any = ""                 # 默认值
    placeholder: str = ""             # 输入提示
    help_text: str = ""               # 帮助文本
    options: List[Any] = field(default_factory=list)  # 下拉选项 (type=select时)
    source: str = ""                  # 数据源 (如 "vulnerabilities", "config.hazard_types")
    max_count: int = 5                # 最大数量 (type=image_list时)
    group: str = "default"            # 字段分组 (用于前端UI分组显示)
    order: int = 0                    # 显示顺序
    readonly: bool = False            # 是否只读
    computed: bool = False            # 是否计算字段
    compute_from: str = ""            # 计算来源字段
    compute_rule: Dict = field(default_factory=dict)  # 计算规则
    on_change: str = ""               # 值变化时触发的行为ID
    validation: Dict = field(default_factory=dict)    # 验证规则
    auto_generate: bool = False       # 是否自动生成
    auto_generate_rule: str = ""      # 自动生成规则
    auto_fill_from: str = ""          # 自动填充来源
    fill_field: str = ""              # 填充的字段名
    template_placeholder: str = ""    # 模板中的占位符
    inline_group: str = ""            # 内联分组 (同一行显示)
    rows: int = 3                     # textarea 行数
    accept: str = ""                  # 文件接受类型
    max_size_mb: int = 5              # 最大文件大小
    paste_enabled: bool = False       # 是否支持粘贴
    with_description: bool = False    # 图片是否带描述
    description_placeholder: str = "" # 描述输入提示
    search_placeholder: str = ""      # 搜索提示
    display_field: str = ""           # 显示字段
    value_field: str = ""             # 值字段
    editable_config: bool = False     # 是否可编辑配置
    save_to_config: bool = False      # 是否保存到配置
    presets: Dict = field(default_factory=dict)  # 预设值 (根据选择自动填充其他字段)


@dataclass
class FieldGroup:
    """字段分组"""
    id: str
    name: str
    icon: str = ""
    order: int = 0
    collapsed: bool = False


@dataclass
class DataSourceDef:
    """数据源定义"""
    id: str
    type: str                         # database, config, api
    description: str = ""
    config_key: str = ""              # type=config 时的配置键名
    endpoint: str = ""                # type=api 时的端点


@dataclass
class BehaviorAction:
    """行为动作"""
    type: str                         # api_call, compute, set_value
    endpoint: str = ""
    params: Dict = field(default_factory=dict)
    result_mapping: Dict = field(default_factory=dict)
    target: str = ""
    rules: Dict = field(default_factory=dict)


@dataclass
class Behavior:
    """行为定义"""
    id: str
    trigger_field: str
    trigger_event: str = "change"
    actions: List[BehaviorAction] = field(default_factory=list)


@dataclass
class ValidationRule:
    """验证规则"""
    fields: List[str]
    rule: str
    message: str


@dataclass
class PreviewField:
    """预览字段"""
    key: str
    label: str


@dataclass
class TemplateInfo:
    """模板信息"""
    id: str                           # 模板唯一ID
    name: str                         # 模板显示名称
    description: str = ""             # 模板描述
    version: str = "1.0.0"            # 模板版本
    order: int = 999                  # 显示顺序 (数字越小越靠前)
    template_file: str = ""           # 模板文件名 (相对于模板目录)
    icon: str = ""                    # 图标 (可选)
    author: str = ""                  # 作者
    create_time: str = ""             # 创建时间
    update_time: str = ""             # 更新时间
    fields: List[FieldDefinition] = field(default_factory=list)
    field_groups: List[FieldGroup] = field(default_factory=list)
    data_sources: List[DataSourceDef] = field(default_factory=list)
    behaviors: List[Behavior] = field(default_factory=list)
    validation_rules: List[ValidationRule] = field(default_factory=list)
    output_config: Dict = field(default_factory=dict)
    preview_config: Dict = field(default_factory=dict)


class TemplateManager:
    """模板管理器"""
    
    # 排除的目录：以 _ 或 . 开头的目录，以及特定系统目录
    EXCLUDED_DIRS = {'_deleted', '_backup', '__pycache__', '.git', '.vscode', '.idea'}
    
    def __init__(self, templates_dir: str, config: Optional[Dict] = None):
        """
        初始化模板管理器
        
        Args:
            templates_dir: 模板根目录路径
            config: 全局配置 (用于解析数据源)
        """
        self.templates_dir = templates_dir
        self.config = config if config is not None else {}
        self._templates: Dict[str, TemplateInfo] = {}
        self._template_versions: Dict[str, List[str]] = {}  # {template_id: [versions]}
        self._template_routers: Dict[str, Any] = {}  # 新增：存储模板路由
        self._load_all_templates()
    
    def _load_all_templates(self):
        """扫描并加载所有模板"""
        if not os.path.exists(self.templates_dir):
            logger.warning(f"Templates directory not found: {self.templates_dir}")
            return
        
        for item in os.listdir(self.templates_dir):
            # 跳过排除目录和隐藏目录（以 _ 或 . 开头）
            if item in self.EXCLUDED_DIRS or item.startswith(('_', '.')):
                logger.debug(f"Skipping excluded directory: {item}")
                continue
            
            # 安全检查：防止路径遍历（解决问题 12）
            if not validate_path_safety(item, self.templates_dir):
                logger.warning(f"Skipping unsafe path: {item}")
                continue
            
            template_path = os.path.join(self.templates_dir, item)
            if not os.path.isdir(template_path):
                continue
            
            schema_path = os.path.join(template_path, "schema.yaml")
            if os.path.exists(schema_path):
                self._load_template(item, schema_path)
    
    def _load_template(self, template_id: str, schema_path: str):
        """
        加载单个模板的 schema
        
        Args:
            template_id: 模板ID (目录名)
            schema_path: schema.yaml 文件路径
            
        Raises:
            InvalidTemplateIdError: 模板 ID 不符合命名规范
            SchemaParseError: Schema 文件解析失败
            TemplateLoadError: 模板加载失败
        """
        # 验证模板 ID 是否符合 Python 模块命名规范
        if not validate_template_id(template_id):
            error = InvalidTemplateIdError(template_id)
            logger.error(str(error))
            return
        
        try:
            with open(schema_path, 'r', encoding='utf-8') as f:
                schema = yaml.safe_load(f)
        except FileNotFoundError:
            error = SchemaParseError(template_id, schema_path, "File not found")
            logger.error(str(error))
            return
        except yaml.YAMLError as e:
            error = SchemaParseError(template_id, schema_path, f"YAML parse error: {str(e)}")
            logger.error(str(error))
            return
        except Exception as e:
            error = SchemaParseError(template_id, schema_path, f"Unexpected error: {str(e)}")
            logger.error(str(error))
            return
        
        try:
            
            # 解析字段分组
            field_groups = []
            for idx, group_data in enumerate(schema.get('field_groups', [])):
                group = FieldGroup(
                    id=group_data.get('id', f'group_{idx}'),
                    name=group_data.get('name', ''),
                    icon=group_data.get('icon', ''),
                    order=group_data.get('order', idx),
                    collapsed=group_data.get('collapsed', False)
                )
                field_groups.append(group)
            field_groups.sort(key=lambda x: x.order)
            
            # 解析数据源定义
            data_sources = []
            for ds_data in schema.get('data_sources', []):
                ds = DataSourceDef(
                    id=ds_data.get('id', ''),
                    type=ds_data.get('type', 'config'),
                    description=ds_data.get('description', ''),
                    config_key=ds_data.get('config_key', ''),
                    endpoint=ds_data.get('endpoint', '')
                )
                data_sources.append(ds)
            
            # 解析字段定义
            fields = []
            for idx, field_data in enumerate(schema.get('fields', [])):
                field_def = FieldDefinition(
                    key=field_data.get('key', ''),
                    label=field_data.get('label', ''),
                    type=field_data.get('type', 'text'),
                    required=field_data.get('required', False),
                    default=field_data.get('default', ''),
                    placeholder=field_data.get('placeholder', ''),
                    help_text=field_data.get('help_text', ''),
                    options=field_data.get('options', []),
                    source=field_data.get('source', ''),
                    max_count=field_data.get('max_count', 5),
                    group=field_data.get('group', 'default'),
                    order=field_data.get('order', idx),
                    readonly=field_data.get('readonly', False),
                    computed=field_data.get('computed', False),
                    compute_from=field_data.get('compute_from', ''),
                    compute_rule=field_data.get('compute_rule', {}),
                    on_change=field_data.get('on_change', ''),
                    validation=field_data.get('validation', {}),
                    auto_generate=field_data.get('auto_generate', False),
                    auto_generate_rule=field_data.get('auto_generate_rule', ''),
                    auto_fill_from=field_data.get('auto_fill_from', ''),
                    fill_field=field_data.get('fill_field', ''),
                    template_placeholder=field_data.get('template_placeholder', ''),
                    inline_group=field_data.get('inline_group', ''),
                    rows=field_data.get('rows', 3),
                    accept=field_data.get('accept', ''),
                    max_size_mb=field_data.get('max_size_mb', 5),
                    paste_enabled=field_data.get('paste_enabled', False),
                    with_description=field_data.get('with_description', False),
                    description_placeholder=field_data.get('description_placeholder', ''),
                    search_placeholder=field_data.get('search_placeholder', ''),
                    display_field=field_data.get('display_field', ''),
                    value_field=field_data.get('value_field', ''),
                    editable_config=field_data.get('editable_config', False),
                    save_to_config=field_data.get('save_to_config', False),
                    presets=field_data.get('presets', {})
                )
                fields.append(field_def)
            
            # 按 order 排序
            fields.sort(key=lambda x: x.order)
            
            # 解析行为定义
            behaviors = []
            for beh_data in schema.get('behaviors', []):
                trigger = beh_data.get('trigger', {})
                actions = []
                for act_data in beh_data.get('actions', []):
                    action = BehaviorAction(
                        type=act_data.get('type', ''),
                        endpoint=act_data.get('endpoint', ''),
                        params=act_data.get('params', {}),
                        result_mapping=act_data.get('result_mapping', {}),
                        target=act_data.get('target', ''),
                        rules=act_data.get('rules', {})
                    )
                    actions.append(action)
                
                behavior = Behavior(
                    id=beh_data.get('id', ''),
                    trigger_field=trigger.get('field', ''),
                    trigger_event=trigger.get('event', 'change'),
                    actions=actions
                )
                behaviors.append(behavior)
            
            # 解析验证规则
            validation_rules = []
            validation_data = schema.get('validation', {})
            for rule_data in validation_data.get('rules', []):
                rule = ValidationRule(
                    fields=rule_data.get('fields', []),
                    rule=rule_data.get('rule', ''),
                    message=rule_data.get('message', '')
                )
                validation_rules.append(rule)
            
            # 创建模板信息
            template_info = TemplateInfo(
                id=schema.get('id', template_id),
                name=schema.get('name', template_id),
                description=schema.get('description', ''),
                version=schema.get('version', '1.0.0'),
                order=schema.get('order', 999),
                template_file=schema.get('template_file', 'template.docx'),
                icon=schema.get('icon', ''),
                author=schema.get('author', ''),
                create_time=schema.get('create_time', ''),
                update_time=schema.get('update_time', ''),
                fields=fields,
                field_groups=field_groups,
                data_sources=data_sources,
                behaviors=behaviors,
                validation_rules=validation_rules,
                output_config=schema.get('output', {}),
                preview_config=schema.get('preview', {})
            )
            
            self._templates[template_info.id] = template_info
            
            # 版本管理
            if template_info.id not in self._template_versions:
                self._template_versions[template_info.id] = []
            if template_info.version not in self._template_versions[template_info.id]:
                self._template_versions[template_info.id].append(template_info.version)
            
            logger.info(f"Loaded template: {template_info.id} v{template_info.version} ({template_info.name})")
            
            # 动态加载 handler（阶段 1：任务 1.1）
            template_dir = os.path.dirname(schema_path)
            self._load_handler(template_info.id, template_dir)
            
        except KeyError as e:
            error = TemplateLoadError(template_id, f"Missing required field in schema: {str(e)}")
            logger.error(str(error))
        except ValueError as e:
            error = TemplateLoadError(template_id, f"Invalid value in schema: {str(e)}")
            logger.error(str(error))
        except Exception as e:
            error = TemplateLoadError(template_id, f"Unexpected error: {str(e)}")
            logger.error(str(error))
            import traceback
            traceback.print_exc()
    
    def _load_handler(self, template_id: str, template_dir: str):
        """
        动态加载模板的 handler.py（阶段 1：任务 1.1）
        
        功能：
        1. 使用 importlib 动态导入 handler.py
        2. @register_handler 装饰器自动注册到 HandlerRegistry
        
        Args:
            template_id: 模板ID
            template_dir: 模板目录路径
        """
        handler_path = os.path.join(template_dir, "handler.py")
        if not os.path.exists(handler_path):
            logger.warning(f"Handler not found for template: {template_id}")
            return
        
        try:
            import importlib.util
            import sys
            
            # 动态加载模块
            module_name = f"templates.{template_id}.handler"
            spec = importlib.util.spec_from_file_location(module_name, handler_path)
            if spec is None or spec.loader is None:
                logger.error(f"Failed to create module spec for {template_id}")
                return
            
            module = importlib.util.module_from_spec(spec)
            
            # 添加到 sys.modules，避免重复加载
            sys.modules[module_name] = module
            
            # 执行模块（触发 @register_handler 装饰器）
            spec.loader.exec_module(module)
            
            # 收集模板路由（如果有）
            if hasattr(module, 'router'):
                self._template_routers[template_id] = module.router
                logger.info(f"Collected router for template: {template_id}")
            
            logger.info(f"Dynamically loaded handler for: {template_id}")
            
        except Exception as e:
            logger.error(f"Failed to load handler for {template_id}: {e}")
    
    def get_template_routers(self) -> Dict[str, Any]:
        """获取所有模板的路由"""
        return self._template_routers

    def get_template(self, template_id: str, raise_if_not_found: bool = False) -> Optional[TemplateInfo]:
        """
        获取指定模板信息
        
        Args:
            template_id: 模板ID
            raise_if_not_found: 如果为 True，模板不存在时抛出异常
            
        Returns:
            模板信息，如果不存在且 raise_if_not_found=False 则返回 None
            
        Raises:
            TemplateNotFoundError: 当 raise_if_not_found=True 且模板不存在时
        """
        template = self._templates.get(template_id)
        if template is None and raise_if_not_found:
            raise TemplateNotFoundError(template_id)
        return template
    
    def get_template_list(self) -> List[Dict[str, Any]]:
        """获取所有模板的简要列表（按 order 排序）"""
        # 先按 order 排序模板
        sorted_templates = sorted(self._templates.values(), key=lambda t: t.order)
        
        return [
            {
                "id": t.id,
                "name": t.name,
                "description": t.description,
                "icon": t.icon,
                "version": t.version,
                "author": t.author,
                "update_time": t.update_time,
                "order": t.order
            }
            for t in sorted_templates
        ]
    
    def get_template_versions(self, template_id: str) -> List[str]:
        """获取模板的所有版本"""
        return self._template_versions.get(template_id, [])
    
    def compare_versions(self, version1: str, version2: str) -> int:
        """
        比较两个版本号（解决问题 11：模板版本管理）
        
        Args:
            version1: 版本号1 (如 "1.2.3")
            version2: 版本号2 (如 "1.2.4")
            
        Returns:
            -1: version1 < version2
             0: version1 == version2
             1: version1 > version2
        """
        try:
            v1_parts = [int(x) for x in version1.split('.')]
            v2_parts = [int(x) for x in version2.split('.')]
            
            # 补齐长度
            max_len = max(len(v1_parts), len(v2_parts))
            v1_parts.extend([0] * (max_len - len(v1_parts)))
            v2_parts.extend([0] * (max_len - len(v2_parts)))
            
            for v1, v2 in zip(v1_parts, v2_parts):
                if v1 < v2:
                    return -1
                elif v1 > v2:
                    return 1
            return 0
        except (ValueError, AttributeError):
            # 如果版本号格式不正确，按字符串比较
            if version1 < version2:
                return -1
            elif version1 > version2:
                return 1
            return 0
    
    def check_version_conflict(self, template_id: str, new_version: str) -> Tuple[bool, str]:
        """
        检查版本冲突（解决问题 11：模板版本管理）
        
        Args:
            template_id: 模板ID
            new_version: 新版本号
            
        Returns:
            (是否有冲突, 冲突信息)
        """
        existing_versions = self.get_template_versions(template_id)
        
        if not existing_versions:
            return False, ""
        
        # 检查是否已存在相同版本
        if new_version in existing_versions:
            return True, f"Version {new_version} already exists"
        
        # 检查新版本是否比现有版本旧
        current_template = self._templates.get(template_id)
        if current_template:
            current_version = current_template.version
            if self.compare_versions(new_version, current_version) < 0:
                return True, f"New version {new_version} is older than current version {current_version}"
        
        return False, ""
    
    def _serialize_field(self, field: FieldDefinition) -> Dict[str, Any]:
        """
        将字段定义序列化为字典
        
        Args:
            field: 字段定义对象
            
        Returns:
            字段字典
        """
        return {
            "key": field.key,
            "label": field.label,
            "type": field.type,
            "required": field.required,
            "default": field.default,
            "placeholder": field.placeholder,
            "help_text": field.help_text,
            "options": field.options,
            "source": field.source,
            "max_count": field.max_count,
            "group": field.group,
            "order": field.order,
            "readonly": field.readonly,
            "computed": field.computed,
            "compute_from": field.compute_from,
            "compute_rule": field.compute_rule,
            "on_change": field.on_change,
            "validation": field.validation,
            "auto_generate": field.auto_generate,
            "auto_generate_rule": field.auto_generate_rule,
            "auto_fill_from": field.auto_fill_from,
            "template_placeholder": field.template_placeholder,
            "inline_group": field.inline_group,
            "rows": field.rows,
            "accept": field.accept,
            "max_size_mb": field.max_size_mb,
            "paste_enabled": field.paste_enabled,
            "with_description": field.with_description,
            "description_placeholder": field.description_placeholder,
            "search_placeholder": field.search_placeholder,
            "display_field": field.display_field,
            "value_field": field.value_field,
            "editable_config": field.editable_config,
            "save_to_config": field.save_to_config,
            "presets": field.presets
        }
    
    def _serialize_field_group(self, group: FieldGroup) -> Dict[str, Any]:
        """
        将字段分组序列化为字典
        
        Args:
            group: 字段分组对象
            
        Returns:
            字段分组字典
        """
        return {
            "id": group.id,
            "name": group.name,
            "icon": group.icon,
            "order": group.order,
            "collapsed": group.collapsed
        }
    
    def _serialize_data_source(self, ds: DataSourceDef) -> Dict[str, Any]:
        """
        将数据源定义序列化为字典
        
        Args:
            ds: 数据源定义对象
            
        Returns:
            数据源字典
        """
        return {
            "id": ds.id,
            "type": ds.type,
            "description": ds.description,
            "config_key": ds.config_key
        }
    
    def _serialize_behavior(self, behavior: Behavior) -> Dict[str, Any]:
        """
        将行为定义序列化为字典
        
        Args:
            behavior: 行为定义对象
            
        Returns:
            行为字典
        """
        return {
            "id": behavior.id,
            "trigger": {
                "field": behavior.trigger_field,
                "event": behavior.trigger_event
            },
            "actions": [
                {
                    "type": a.type,
                    "endpoint": a.endpoint,
                    "params": a.params,
                    "result_mapping": a.result_mapping,
                    "target": a.target,
                    "rules": a.rules
                }
                for a in behavior.actions
            ]
        }
    
    @lru_cache(maxsize=128)
    def _get_cached_schema(self, template_id: str, version: str) -> Optional[Dict[str, Any]]:
        """
        获取缓存的模板 schema（解决问题 13：性能优化）
        
        使用 LRU 缓存避免重复解析 schema
        """
        return self.get_template_schema(template_id)
    
    def get_template_schema(self, template_id: str) -> Optional[Dict[str, Any]]:
        """
        获取模板的完整 schema (用于前端渲染表单)
        """
        template = self._templates.get(template_id)
        if not template:
            return None
        
        return {
            "id": template.id,
            "name": template.name,
            "description": template.description,
            "version": template.version,
            "icon": template.icon,
            "author": template.author,
            "field_groups": [self._serialize_field_group(g) for g in template.field_groups],
            "fields": [self._serialize_field(f) for f in template.fields],
            "data_sources": [self._serialize_data_source(ds) for ds in template.data_sources],
            "behaviors": [self._serialize_behavior(b) for b in template.behaviors],
            "validation": {
                "rules": [
                    {
                        "fields": r.fields,
                        "rule": r.rule,
                        "message": r.message
                    }
                    for r in template.validation_rules
                ]
            },
            "output": template.output_config,
            "preview": template.preview_config
        }
    
    def get_template_file_path(self, template_id: str) -> Optional[str]:
        """获取模板 docx 文件的完整路径"""
        template = self._templates.get(template_id)
        if not template:
            return None
        
        template_dir = os.path.join(self.templates_dir, template_id)
        template_file = os.path.join(template_dir, template.template_file)
        
        if os.path.exists(template_file):
            return template_file
        return None
    
    def resolve_data_sources(self, template_id: str, 
                             db_data: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        解析模板所需的数据源
        
        Args:
            template_id: 模板ID
            db_data: 数据库数据 (如漏洞列表、ICP缓存等)
            
        Returns:
            {source_id: data, ...}
        """
        template = self._templates.get(template_id)
        if not template:
            return {}
        
        db_data = db_data if db_data is not None else {}
        resolved = {}
        
        for ds in template.data_sources:
            if ds.type == 'config' and ds.config_key:
                # 从全局配置读取
                resolved[ds.id] = self.config.get(ds.config_key, [])
            elif ds.type == 'database':
                # 从传入的数据库数据读取
                resolved[ds.id] = db_data.get(ds.id, [])
            elif ds.type == 'api':
                # API 类型由前端处理
                resolved[ds.id] = {"endpoint": ds.endpoint}
        
        # 处理字段级别的 source 属性 (如 config.risk_levels, config.supplierName)
        for field in template.fields:
            if field.source and field.source.startswith('config.'):
                config_key = field.source.replace('config.', '')
                if field.source not in resolved:
                    resolved[field.source] = self.config.get(config_key, [])
        
        # 处理嵌套 columns 中的 source（需要读取原始 schema）
        template_path = os.path.join(self.templates_dir, template_id)
        schema_path = os.path.join(template_path, "schema.yaml")
        if os.path.exists(schema_path):
            try:
                with open(schema_path, 'r', encoding='utf-8') as f:
                    raw_schema = yaml.safe_load(f)
                for field_data in raw_schema.get('fields', []):
                    columns = field_data.get('columns', [])
                    for col in columns:
                        if isinstance(col, dict):
                            src = col.get('source', '')
                            if src.startswith('config.') and src not in resolved:
                                config_key = src.replace('config.', '')
                                resolved[src] = self.config.get(config_key, [])
            except Exception as e:
                logger.warning(f"Failed to parse columns from schema: {e}")
        
        return resolved
    
    def validate_report_data(self, template_id: str, data: Dict[str, Any]) -> Tuple[bool, List[str]]:
        """
        验证报告数据是否符合模板要求
        
        Returns:
            (是否有效, 错误信息列表)
        """
        template = self._templates.get(template_id)
        if not template:
            return False, [f"Template not found: {template_id}"]
        
        errors = []
        
        # 检查必填字段
        for field_def in template.fields:
            if field_def.required:
                value = data.get(field_def.key, "")
                if not value or (isinstance(value, str) and not value.strip()):
                    errors.append(f"字段 '{field_def.label}' 为必填项")
            
            # 检查字段验证规则
            if field_def.validation:
                pattern = field_def.validation.get('pattern')
                if pattern:
                    value = data.get(field_def.key, "")
                    if value and not re.match(pattern, str(value)):
                        errors.append(field_def.validation.get('message', f"字段 '{field_def.label}' 格式不正确"))
        
        # 检查全局验证规则
        for rule in template.validation_rules:
            if rule.rule == 'required':
                for field_key in rule.fields:
                    value = data.get(field_key, "")
                    if not value or (isinstance(value, str) and not value.strip()):
                        errors.append(rule.message)
                        break
        
        return len(errors) == 0, errors
    
    def build_replacements(self, template_id: str, data: Dict[str, Any], 
                          extra: Optional[Dict[str, Any]] = None) -> Dict[str, str]:
        """
        根据模板定义和数据构建替换字典
        
        Args:
            template_id: 模板ID
            data: 前端提交的数据
            extra: 额外的替换项 (如 supplierName, reportTime)
            
        Returns:
            替换字典 {"#key#": "value", ...}
        """
        template = self._templates.get(template_id)
        if not template:
            return {}
        
        replacements = {}
        
        # 从模板字段构建
        for field_def in template.fields:
            # 优先使用模板中定义的占位符
            if field_def.template_placeholder:
                key = field_def.template_placeholder
            else:
                key = f"#{field_def.key}#"
            
            value = data.get(field_def.key)
            if value is None:
                value = field_def.default if field_def.default != 'today' else ''
            
            # 特殊处理
            if isinstance(value, list):
                # 图片列表等复杂类型，跳过文本替换，由专门的处理器处理
                continue
            else:
                replacements[key] = str(value) if value is not None else ""
        
        # 合并额外数据
        if extra:
            for k, v in extra.items():
                if not k.startswith("#"):
                    k = f"#{k}#"
                replacements[k] = str(v) if v is not None else ""
        
        return replacements
    
    def generate_output_path(self, template_id: str, data: Dict[str, Any], 
                            base_output_dir: str) -> str:
        """
        根据模板配置生成输出路径
        
        Args:
            template_id: 模板ID
            data: 报告数据
            base_output_dir: 基础输出目录
            
        Returns:
            完整的输出文件路径
        """
        template = self._templates.get(template_id)
        if not template:
            return os.path.join(base_output_dir, "report.docx")
        
        output_config = template.output_config
        
        # 解析文件名模式
        filename_pattern = output_config.get('filename_pattern', '{vul_name}_{date}.docx')
        output_dir_pattern = output_config.get('output_dir', '')
        
        # 替换变量
        now = datetime.now()
        replacements = {
            'date': now.strftime('%Y-%m-%d'),
            'datetime': now.strftime('%Y%m%d_%H%M%S'),
            'timestamp': str(int(now.timestamp()))
        }
        replacements.update(data)
        
        # 解析文件名
        filename = filename_pattern
        for key, value in replacements.items():
            filename = filename.replace(f'{{{key}}}', str(value) if value else '')
        
        # 清理文件名中的非法字符
        filename = re.sub(r'[<>:"/\\|?*]', '_', filename)
        
        # 解析输出目录
        if output_dir_pattern:
            output_dir = output_dir_pattern
            for key, value in replacements.items():
                output_dir = output_dir.replace(f'{{{key}}}', str(value) if value else '')
            output_dir = os.path.join(base_output_dir, output_dir)
        else:
            output_dir = base_output_dir
        
        # 确保目录存在
        os.makedirs(output_dir, exist_ok=True)
        
        return os.path.join(output_dir, filename)
    
    def check_dependencies(self, template_id: str, raise_on_missing: bool = False) -> Tuple[bool, List[str]]:
        """
        检查模板依赖是否满足（解决问题 9：模板依赖管理缺失）
        
        Args:
            template_id: 模板ID
            raise_on_missing: 如果为 True，依赖缺失时抛出异常
            
        Returns:
            (是否满足, 缺失的依赖列表)
            
        Raises:
            TemplateNotFoundError: 模板不存在
            DependencyError: 当 raise_on_missing=True 且依赖缺失时
        """
        template = self._templates.get(template_id)
        if not template:
            if raise_on_missing:
                raise TemplateNotFoundError(template_id)
            return False, [f"Template not found: {template_id}"]
        
        # 从模板目录读取 schema.yaml 获取依赖声明
        template_path = os.path.join(self.templates_dir, template_id)
        schema_path = os.path.join(template_path, "schema.yaml")
        
        if not os.path.exists(schema_path):
            return True, []
        
        try:
            with open(schema_path, 'r', encoding='utf-8') as f:
                schema = yaml.safe_load(f)
            
            dependencies = schema.get('dependencies', [])
            if not dependencies:
                return True, []
            
            missing = []
            for dep in dependencies:
                try:
                    # 简单检查：尝试导入包名
                    # 支持格式：requests>=2.28.0, pandas==1.5.0, pillow
                    pkg_name = dep.split('>=')[0].split('==')[0].split('<')[0].strip()
                    __import__(pkg_name)
                except ImportError:
                    missing.append(dep)
            
            if missing:
                logger.warning(f"Template {template_id} has missing dependencies: {missing}")
                if raise_on_missing:
                    raise DependencyError(template_id, missing)
                return False, missing
            
            return True, []
            
        except DependencyError:
            raise
        except Exception as e:
            error_msg = f"Error checking dependencies: {str(e)}"
            logger.error(f"Failed to check dependencies for {template_id}: {e}")
            if raise_on_missing:
                raise TemplateLoadError(template_id, error_msg)
            return False, [error_msg]
    
    def reload_templates(self):
        """重新加载所有模板"""
        import sys
        from .base_handler import HandlerRegistry
        
        # 清理 HandlerRegistry（解决问题 7：重复注册问题）
        HandlerRegistry.clear()
        logger.info("Cleared HandlerRegistry")
        
        # 清空路由缓存
        self._template_routers.clear()
        
        # 清理 sys.modules 中的旧模块（解决问题 6：sys.modules 缓存问题）
        modules_to_remove = []
        for module_name in sys.modules.keys():
            if module_name.startswith('templates.') and '.handler' in module_name:
                modules_to_remove.append(module_name)
        
        for module_name in modules_to_remove:
            del sys.modules[module_name]
            logger.info(f"Removed old module from cache: {module_name}")
        
        # 清理 LRU 缓存（解决问题 13：性能优化）
        self._get_cached_schema.cache_clear()
        logger.info("Cleared schema cache")
        
        self._templates.clear()
        self._template_versions.clear()
        self._load_all_templates()
    
    def get_template_details(self, template_id: str) -> Optional[Dict[str, Any]]:
        """
        获取模板的详细信息（包括文件大小、字段数量等）
        
        Args:
            template_id: 模板ID
            
        Returns:
            模板详细信息字典，如果模板不存在则返回 None
        """
        template = self._templates.get(template_id)
        if not template:
            return None
        
        template_path = os.path.join(self.templates_dir, template_id)
        schema_path = os.path.join(template_path, "schema.yaml")
        docx_path = os.path.join(template_path, "template.docx")
        
        # 获取文件大小
        schema_size = os.path.getsize(schema_path) if os.path.exists(schema_path) else 0
        docx_size = os.path.getsize(docx_path) if os.path.exists(docx_path) else 0
        total_size = schema_size + docx_size
        
        # 获取文件修改时间
        mtime = os.path.getmtime(schema_path) if os.path.exists(schema_path) else 0
        update_time = datetime.fromtimestamp(mtime).strftime("%Y-%m-%d %H:%M:%S") if mtime else ""
        
        return {
            "id": template.id,
            "name": template.name,
            "description": template.description,
            "icon": template.icon,
            "version": template.version,
            "author": template.author,
            "create_time": template.create_time,
            "update_time": update_time,
            "order": template.order,
            "field_count": len(template.fields),
            "group_count": len(template.field_groups),
            "file_size": total_size,
            "file_size_mb": round(total_size / 1024 / 1024, 2),
            "has_schema": os.path.exists(schema_path),
            "has_docx": os.path.exists(docx_path),
            "is_default": template.id == self.default_template_id
        }
    
    def delete_template(self, template_id: str) -> Tuple[bool, str]:
        """
        删除指定模板
        
        Args:
            template_id: 模板ID
            
        Returns:
            (成功标志, 消息)
        """
        import shutil
        
        # 检查模板是否存在
        if template_id not in self._templates:
            return False, f"模板不存在: {template_id}"
        
        # 防止删除默认模板
        if template_id == self.default_template_id and len(self._templates) == 1:
            return False, "无法删除唯一的模板"
        
        template_path = os.path.join(self.templates_dir, template_id)
        
        try:
            # 删除模板目录
            if os.path.exists(template_path):
                shutil.rmtree(template_path)
                logger.info(f"Deleted template directory: {template_path}")
            
            # 从内存中移除
            del self._templates[template_id]
            if template_id in self._template_versions:
                del self._template_versions[template_id]
            
            return True, f"模板 {template_id} 已删除"
        except Exception as e:
            logger.error(f"Failed to delete template {template_id}: {str(e)}")
            return False, f"删除失败: {str(e)}"
    
    def update_config(self, config: Dict):
        """更新全局配置"""
        self.config = config
    
    @property
    def template_ids(self) -> List[str]:
        """获取所有模板ID"""
        return list(self._templates.keys())
    
    @property
    def default_template_id(self) -> Optional[str]:
        """获取默认模板ID (order 最小的模板)"""
        if self._templates:
            # 按 order 排序，返回第一个
            sorted_templates = sorted(self._templates.values(), key=lambda t: t.order)
            return sorted_templates[0].id if sorted_templates else None
        return None

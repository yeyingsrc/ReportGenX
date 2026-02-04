# -*- coding: utf-8 -*-
"""
@Createtime: 2026-01-24
@description: 模板处理器基类 - 定义报告生成的标准接口
所有模板处理器都应该继承此基类
"""

import os
from abc import ABC, abstractmethod
from typing import Dict, Any, List, Optional, Tuple
from datetime import datetime
from docx import Document

from .template_manager import TemplateManager, TemplateInfo


class BaseTemplateHandler(ABC):
    """
    模板处理器基类
    
    每种报告模板都需要一个对应的 Handler 类来处理其特定的业务逻辑。
    Handler 负责：
    1. 数据预处理 (preprocess)
    2. 数据验证 (validate)
    3. 报告生成 (generate)
    4. 后处理 (postprocess)
    """
    
    def __init__(self, template_manager: TemplateManager, template_id: str, config: Optional[Dict] = None):
        """
        初始化处理器
        
        Args:
            template_manager: 模板管理器实例
            template_id: 模板ID
            config: 全局配置
        """
        self.template_manager = template_manager
        self.template_id = template_id
        self.config = config or {}
        self.template_info: Optional[TemplateInfo] = template_manager.get_template(template_id)
        
        if not self.template_info:
            raise ValueError(f"Template not found: {template_id}")
    
    @abstractmethod
    def preprocess(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """
        数据预处理
        
        在生成报告前对数据进行预处理，如：
        - 自动生成编号
        - 日期格式化
        - 数据补全
        - 计算派生字段
        
        Args:
            data: 原始表单数据
            
        Returns:
            预处理后的数据
        """
        pass
    
    def validate(self, data: Dict[str, Any]) -> Tuple[bool, List[str]]:
        """
        数据验证
        
        验证数据是否符合模板要求，默认使用 TemplateManager 的验证逻辑
        子类可以覆盖此方法添加自定义验证
        
        Args:
            data: 表单数据
            
        Returns:
            (是否有效, 错误信息列表)
        """
        return self.template_manager.validate_report_data(self.template_id, data)
    
    @abstractmethod
    def generate(self, data: Dict[str, Any], output_dir: str) -> Tuple[bool, str, str]:
        """
        生成报告
        
        核心方法，负责：
        1. 加载 docx 模板
        2. 执行占位符替换
        3. 插入图片
        4. 保存文件
        
        Args:
            data: 预处理后的表单数据
            output_dir: 输出目录
            
        Returns:
            (成功标志, 输出文件路径, 消息)
        """
        pass
    
    def postprocess(self, output_path: str, data: Dict[str, Any]) -> None:
        """
        后处理
        
        报告生成后的处理，如：
        - 记录日志
        - 写入数据库
        - 发送通知
        
        Args:
            output_path: 生成的报告文件路径
            data: 表单数据
        """
        pass
    
    def run(self, data: Dict[str, Any], output_dir: str) -> Dict[str, Any]:
        """
        执行完整的报告生成流程
        
        Args:
            data: 原始表单数据
            output_dir: 输出目录
            
        Returns:
            {
                "success": bool,
                "report_path": str,
                "message": str,
                "errors": List[str]
            }
        """
        result = {
            "success": False,
            "report_path": "",
            "message": "",
            "errors": []
        }
        
        try:
            # 1. 预处理
            processed_data = self.preprocess(data)
            
            # 2. 验证
            is_valid, errors = self.validate(processed_data)
            if not is_valid:
                result["errors"] = errors
                result["message"] = "数据验证失败: " + "; ".join(errors)
                return result
            
            # 3. 生成报告
            success, output_path, message = self.generate(processed_data, output_dir)
            
            if success:
                # 4. 后处理
                self.postprocess(output_path, processed_data)
                
                result["success"] = True
                result["report_path"] = output_path
                result["message"] = message or "报告生成成功"
            else:
                result["message"] = message or "报告生成失败"
                
        except Exception as e:
            result["message"] = f"报告生成异常: {str(e)}"
            import traceback
            traceback.print_exc()
        
        return result
    
    # ========== 工具方法 ==========
    
    def get_template_path(self) -> Optional[str]:
        """获取模板文件路径"""
        return self.template_manager.get_template_file_path(self.template_id)
    
    def build_replacements(self, data: Dict[str, Any], extra: Dict[str, Any] = None) -> Dict[str, str]:
        """构建替换字典"""
        return self.template_manager.build_replacements(self.template_id, data, extra)
    
    def generate_output_path(self, data: Dict[str, Any], output_dir: str) -> str:
        """生成输出路径"""
        return self.template_manager.generate_output_path(self.template_id, data, output_dir)
    
    def load_document(self) -> Optional[Document]:
        """加载 Word 文档模板"""
        template_path = self.get_template_path()
        if template_path and os.path.exists(template_path):
            return Document(template_path)
        return None
    
    def replace_text_in_document(self, doc: Document, replacements: Dict[str, str]) -> None:
        """
        替换文档中的占位符文本
        
        Args:
            doc: Document 对象
            replacements: 替换字典 {"#key#": "value", ...}
        """
        # 替换段落中的文本
        for paragraph in doc.paragraphs:
            self._replace_in_paragraph(paragraph, replacements)
        
        # 替换表格中的文本
        for table in doc.tables:
            for row in table.rows:
                for cell in row.cells:
                    for paragraph in cell.paragraphs:
                        self._replace_in_paragraph(paragraph, replacements)
    
    def _replace_in_paragraph(self, paragraph, replacements: Dict[str, str]) -> None:
        """替换段落中的占位符"""
        full_text = paragraph.text
        
        for key, value in replacements.items():
            if isinstance(value, str) and key in full_text:
                full_text = full_text.replace(key, value)
        
        # 如果有变化，更新段落
        if full_text != paragraph.text:
            # 保留原有格式，替换第一个 run 的文本，清空其他 runs
            if paragraph.runs:
                paragraph.runs[0].text = full_text
                for run in paragraph.runs[1:]:
                    run.text = ""
    
    def save_document(self, doc: Document, output_path: str) -> str:
        """
        保存文档，处理文件名冲突
        
        Args:
            doc: Document 对象
            output_path: 目标路径
            
        Returns:
            实际保存的文件路径
        """
        # 确保目录存在
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        
        # 处理文件名冲突
        if os.path.exists(output_path):
            base, ext = os.path.splitext(output_path)
            count = 1
            while os.path.exists(f"{base}-{count}{ext}"):
                count += 1
            output_path = f"{base}-{count}{ext}"
        
        doc.save(output_path)
        return output_path
    
    def get_current_date(self, format_str: str = "%Y-%m-%d") -> str:
        """获取当前日期字符串"""
        return datetime.now().strftime(format_str)
    
    def get_current_datetime(self, format_str: str = "%Y-%m-%d %H:%M:%S") -> str:
        """获取当前日期时间字符串"""
        return datetime.now().strftime(format_str)
    
    def generate_report_id(self, prefix: str = "RPT", date_format: str = "%Y%m%d", 
                          random_length: int = 4, use_sequence: bool = False) -> str:
        """
        生成报告编号
        
        Args:
            prefix: 前缀
            date_format: 日期格式
            random_length: 随机字符串长度 (如果 use_sequence=False)
            use_sequence: 是否使用时间戳序号 (替代随机字符串)
            
        Returns:
            格式化后的编号，如 PREFIX-YYYYMMDD-XXXX
        """
        date_str = datetime.now().strftime(date_format)
        
        if use_sequence:
            # 简单实现：使用时间戳生成唯一序号 (0000-9999)
            import time
            suffix = f"{int(time.time()) % 10000:04d}"
        else:
            import random
            import string
            suffix = ''.join(random.choices(string.ascii_uppercase + string.digits, k=random_length))
            
        return f"{prefix}-{date_str}-{suffix}"
    
    def generate_fallback_report(self, data: Dict[str, Any], output_dir: str) -> Tuple[bool, str, str]:
        """
        生成兜底报告（当模板文件丢失时）
        根据 Schema 结构自动生成文档
        """
        from docx import Document
        from docx.shared import Pt
        from docx.enum.text import WD_ALIGN_PARAGRAPH
        
        self.output_dir = output_dir
        
        try:
            doc = Document()
            
            # 标题
            title_text = self.template_info.name if self.template_info else "报告"
            title = doc.add_heading(title_text, 0)
            title.alignment = WD_ALIGN_PARAGRAPH.CENTER
            
            # 遍历字段分组
            if self.template_info and self.template_info.field_groups:
                for group in self.template_info.field_groups:
                    doc.add_heading(group.name, level=1)
                    
                    # 获取该分组下的字段
                    fields = [f for f in self.template_info.fields if f.group == group.id]
                    fields.sort(key=lambda x: x.order)
                    
                    # 创建表格展示字段
                    if fields:
                        table = doc.add_table(rows=len(fields), cols=2)
                        table.style = 'Table Grid'
                        for i, field in enumerate(fields):
                            row = table.rows[i]
                            row.cells[0].text = field.label
                            value = data.get(field.key, '')
                            # 处理列表类型（如图片）
                            if isinstance(value, list):
                                row.cells[1].text = f"[包含 {len(value)} 个项目]"
                            else:
                                row.cells[1].text = str(value)
            
            # 如果没有分组信息，直接打印所有数据
            else:
                doc.add_heading("报告数据", level=1)
                for k, v in data.items():
                    doc.add_paragraph(f"{k}: {v}")
            
            # 生成输出路径
            output_path = self.generate_output_path(data, output_dir)
            final_path = self.save_document(doc, output_path)
            
            return True, final_path, "已生成兜底报告（模板文件丢失）"
            
        except Exception as e:
            import traceback
            traceback.print_exc()
            return False, "", f"兜底报告生成失败: {str(e)}"
    
    # ========== 公共工具方法 ==========
    
    def sanitize_filename(self, filename: str) -> str:
        """
        清理文件名中的非法字符
        
        Args:
            filename: 原始文件名
            
        Returns:
            清理后的安全文件名
        """
        import re
        return re.sub(r'[<>:"/\\|?*]', '_', filename)
    
    def create_output_dir(self, base_dir: str, sub_dir: str = "") -> str:
        """
        创建输出目录
        
        Args:
            base_dir: 基础输出目录
            sub_dir: 子目录名称 (通常是单位名称)
            
        Returns:
            完整的输出目录路径
        """
        if sub_dir:
            output_dir = os.path.join(base_dir, sub_dir)
        else:
            output_dir = base_dir
        os.makedirs(output_dir, exist_ok=True)
        return output_dir
    
    def write_txt_log(self, output_dir: str, log_prefix: str, fields: list) -> None:
        """
        写入 TXT 格式日志
        
        Args:
            output_dir: 输出目录
            log_prefix: 日志文件前缀 (如 "penetration", "vuln")
            fields: 要记录的字段值列表
        """
        report_date = self.get_current_date()
        log_file = os.path.join(output_dir, f"{report_date}_{log_prefix}_output.txt")
        log_line = "\t".join([str(f) if f else '' for f in fields])
        
        with open(log_file, 'a+', encoding='utf-8') as f:
            f.write('\n' + log_line)

    def write_db_log(self, output_dir: str, db_name: str, table_name: str, record: Dict[str, Any]) -> None:
        """
        写入 SQLite 数据库日志
        
        Args:
            output_dir: 输出目录
            db_name: 数据库文件名 (如 "report_log.db")
            table_name: 表名
            record: 要记录的字典数据
        """
        import sqlite3
        db_path = os.path.join(output_dir, db_name)
        
        columns = list(record.keys())
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        
        try:
            # 检查表是否存在
            cursor.execute(f"SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table_name,))
            table_exists = cursor.fetchone()
            
            if not table_exists:
                # 创建表
                columns_def = ', '.join([f'"{col}" TEXT' for col in columns])
                cursor.execute(f'CREATE TABLE {table_name} ({columns_def})')
            else:
                # 检查并添加缺失的列
                cursor.execute(f"PRAGMA table_info({table_name})")
                existing_columns = [row[1] for row in cursor.fetchall()]
                
                for col in columns:
                    if col not in existing_columns:
                        cursor.execute(f'ALTER TABLE {table_name} ADD COLUMN "{col}" TEXT')
            
            # 插入数据
            columns_sql = ', '.join([f'"{col}"' for col in columns])
            placeholders = ', '.join(['?' for _ in columns])
            values = [str(v) if v is not None else '' for v in record.values()]
            
            cursor.execute(f'INSERT INTO {table_name} ({columns_sql}) VALUES ({placeholders})', values)
            conn.commit()
            
        except Exception as e:
            print(f"DB Error: {e}")
        finally:
            conn.close()


class HandlerRegistry:
    """
    处理器注册表
    
    用于注册和获取不同模板的处理器类
    """
    
    _handlers: Dict[str, type] = {}
    
    @classmethod
    def register(cls, template_id: str, handler_class: type) -> None:
        """
        注册模板处理器
        
        Args:
            template_id: 模板ID
            handler_class: 处理器类 (继承 BaseTemplateHandler)
        """
        if not issubclass(handler_class, BaseTemplateHandler):
            raise TypeError(f"{handler_class} must be a subclass of BaseTemplateHandler")
        
        # 支持覆盖注册（解决问题 7：重复注册问题）
        if template_id in cls._handlers:
            from .logger import setup_logger
            logger = setup_logger('HandlerRegistry')
            logger.warning(f"Overwriting existing handler: {template_id}")
        
        cls._handlers[template_id] = handler_class
    
    @classmethod
    def get_handler(cls, template_id: str, template_manager: TemplateManager, 
                   config: Dict = None) -> Optional[BaseTemplateHandler]:
        """
        获取模板处理器实例
        
        Args:
            template_id: 模板ID
            template_manager: 模板管理器
            config: 全局配置
            
        Returns:
            处理器实例，如果未注册则返回 None
        """
        handler_class = cls._handlers.get(template_id)
        if handler_class:
            return handler_class(template_manager, template_id, config)
        return None
    
    @classmethod
    def has_handler(cls, template_id: str) -> bool:
        """检查是否有注册的处理器"""
        return template_id in cls._handlers
    
    @classmethod
    def list_registered(cls) -> List[str]:
        """列出所有已注册的模板ID"""
        return list(cls._handlers.keys())
    
    @classmethod
    def clear(cls) -> None:
        """
        清空所有已注册的处理器
        
        用于重载模板时清理注册表（解决问题 7：重复注册问题）
        """
        cls._handlers.clear()


def register_handler(template_id: str):
    """
    装饰器：注册模板处理器
    
    Usage:
        @register_handler("vuln_report")
        class VulnReportHandler(BaseTemplateHandler):
            ...
    """
    def decorator(handler_class: type):
        HandlerRegistry.register(template_id, handler_class)
        return handler_class
    return decorator

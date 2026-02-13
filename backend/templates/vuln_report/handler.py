# -*- coding: utf-8 -*-
"""
@Createtime: 2026-01-24
@description: 漏洞报告处理器 - 处理风险隐患报告的生成逻辑
使用Template Method模式消除重复的处理器方法
"""

from typing import Dict, Any, List, Tuple, Optional

from core.handler_utils import BaseTemplateHandlerEnhanced, ErrorHandler
from core.base_handler import register_handler
from core.template_manager import TemplateManager
from core.logger import setup_logger
from core.document_editor import DocumentEditor
from core.document_image_processor import DocumentImageProcessor

# 初始化日志记录器
logger = setup_logger('VulnReportHandler')


@register_handler("vuln_report")
class VulnReportHandler(BaseTemplateHandlerEnhanced):
    """
    漏洞报告处理器
    
    负责处理风险隐患报告的生成，包括：
    - 自动生成隐患编号
    - 根据隐患级别计算预警级别
    - 处理 ICP 截图和漏洞证据截图
    - 记录报告日志
    
    使用Template Method模式，自动继承日志和数据库记录方法。
    """
    
    # 定义处理器类型 - 自动从配置中获取日志字段、前缀、数据库表等
    HANDLER_TYPE = 'vuln_report'
    
    # 隐患级别 -> 预警级别 映射
    ALERT_LEVEL_MAP = {
        "高危": "2级",
        "中危": "3级",
        "低危": "4级",
        "信息性": "5级"
    }
    
    def __init__(self, template_manager: TemplateManager, template_id: str, config: Optional[Dict] = None):
        super().__init__(template_manager, template_id, config)
        self.output_dir = ""  # 在 generate 时设置
    
    def preprocess(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """
        数据预处理
        
        1. 生成隐患编号 (如果为空)
        2. 计算预警级别
        3. 设置默认日期
        4. 构建报告名称
        """
        processed = data.copy()
        
        # 1. 生成隐患编号
        if not processed.get('vulnerability_id'):
            processed['vulnerability_id'] = self.generate_report_id(prefix="YHBH", use_sequence=True)
        
        # 2. 计算预警级别
        hazard_level = processed.get('hazard_level', '高危')
        processed['alert_level'] = self.ALERT_LEVEL_MAP.get(hazard_level, '2级')
        
        # 3. 设置发现时间（使用基类辅助方法）
        self._set_default_dates(processed, ['discovery_date'])
        
        # 4. 设置技术支持单位（使用基类辅助方法）
        self._set_supplier_defaults(processed)
        
        # 5. 设置城市/地区默认值
        if not processed.get('city'):
            processed['city'] = self.config.get('city', '北京')
        if not processed.get('region'):
            processed['region'] = self.config.get('region', '海淀区')
        
        # 6. 构建报告名称
        unit_name = processed.get('unit_name', '')
        website_name = processed.get('website_name', '')
        vul_name = processed.get('vul_name', '')
        report_name = f"{unit_name}{website_name}存在{vul_name}漏洞".replace("漏洞漏洞", "漏洞")
        processed['report_name'] = report_name
        
        # 7. 拼接漏洞描述和危害
        vul_description = processed.get('vul_description', '')
        vul_harm = processed.get('vul_harm', '')
        if vul_harm:
            processed['vul_description_full'] = f"{vul_description}{vul_harm}"
        else:
            processed['vul_description_full'] = vul_description
        
        # 8. 设置报告时间
        processed['report_time'] = self.get_current_date()
        
        return processed
    
    def validate(self, data: Dict[str, Any]) -> Tuple[bool, List[str]]:
        """
        数据验证
        
        除了基类验证外，添加漏洞报告特定的验证
        """
        # 先执行基类验证
        is_valid, errors = super().validate(data)
        
        # 添加自定义验证
        # 验证漏洞名称
        if not data.get('vul_name') and not data.get('vul_name_select'):
            errors.append("请选择或输入漏洞名称")
            is_valid = False
        
        # 验证 URL 格式
        url = data.get('url', '')
        if url and not (url.startswith('http://') or url.startswith('https://') or self.is_valid_ip(url)):
            # 允许宽松的 URL 格式
            pass
        
        return is_valid, errors
    
    def generate(self, data: Dict[str, Any], output_dir: str) -> Tuple[bool, str, str]:
        """
        生成漏洞报告
        """
        self.output_dir = output_dir
        
        try:
            # 1. 加载文档
            doc = self.load_document()
            if not doc:
                return False, "", "模板文件加载失败"
            
            # 2. 构建替换字典
            extra_replacements = {
                "#supplierName#": data.get('supplier_name', self.config.get('supplierName', '')),
                "#reportTime#": data.get('report_time', self.get_current_date()),
                "#reportName#": data.get('report_name', ''),
                "#vulDescription#": data.get('vul_description_full', data.get('vul_description', '')),
                # 兼容旧模板占位符
                "#customerCompanyName#": data.get('unit_name', ''),
                "#target#": data.get('url', ''),
            }
            
            replacements = self.build_replacements(data, extra_replacements)
            
            # 3. 替换文本
            editor = DocumentEditor(doc)
            editor.replace_report_text(replacements)
            
            # 4. 处理图片
            img_processor = DocumentImageProcessor(doc, [])
            
            # 处理备案截图（使用基类方法）
            self.process_single_image(img_processor, "#screenshotoffiling#", data.get('icp_screenshot'))
            
            # 处理漏洞证据截图（使用基类方法）
            self.process_image_list(img_processor, '#evidenceScreenshot#', data.get('vuln_evidence_images', []))
            
            # 5. 保存报告
            output_path = self._generate_output_path(data)
            final_path = self.save_document(doc, output_path)
            
            return True, final_path, "报告生成成功"
            
        except Exception as e:
            return ErrorHandler.handle_generation_error('generate', e, logger)
    
    def _generate_output_path(self, data: Dict[str, Any]) -> str:
        """生成输出文件路径"""
        unit_name = data.get('unit_name', 'Unknown')
        filename = self._build_output_filename(data)
        return self.build_output_path(self.output_dir, unit_name, filename)
    
    def _build_output_filename(self, data: Dict[str, Any]) -> str:
        """构建输出文件名"""
        region = data.get('region', '')
        hazard_type = data.get('hazard_type', '漏洞报告')
        report_name = data.get('report_name', 'Report')
        hazard_level = data.get('hazard_level', '高危')
        return f"【{region}】【{hazard_type}】{report_name}【{hazard_level}】.docx"
    
    # 以下方法已删除 - 现在由BaseTemplateHandlerEnhanced通过配置自动提供:
    # - _get_log_fields()      (从handler_config.py自动获取)
    # - _get_log_prefix()      (从handler_config.py自动获取)
    # - _get_db_table_name()   (从handler_config.py自动获取)
    # - _build_db_record()     (从handler_config.py自动获取)

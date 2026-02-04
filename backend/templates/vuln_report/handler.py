# -*- coding: utf-8 -*-
"""
@Createtime: 2026-01-24
@description: 漏洞报告处理器 - 处理风险隐患报告的生成逻辑
"""

import os
import sys
import sqlite3
from typing import Dict, Any, List, Tuple
from datetime import datetime

# 添加 core 目录到路径
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'core'))

from core.base_handler import BaseTemplateHandler, register_handler
from core.template_manager import TemplateManager
from core.logger import setup_logger

# 初始化日志记录器
logger = setup_logger('VulnReportHandler')



@register_handler("vuln_report")
class VulnReportHandler(BaseTemplateHandler):
    """
    漏洞报告处理器
    
    负责处理风险隐患报告的生成，包括：
    - 自动生成隐患编号
    - 根据隐患级别计算预警级别
    - 处理 ICP 截图和漏洞证据截图
    - 记录报告日志
    """
    
    # 隐患级别 -> 预警级别 映射
    ALERT_LEVEL_MAP = {
        "高危": "2级",
        "中危": "3级",
        "低危": "4级",
        "信息性": "5级"
    }
    
    def __init__(self, template_manager: TemplateManager, template_id: str, config: Dict = None):
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
        
        # 3. 设置发现时间
        if not processed.get('discovery_date') or processed.get('discovery_date') == 'today':
            processed['discovery_date'] = self.get_current_date()
        
        # 4. 设置技术支持单位
        if not processed.get('supplier_name'):
            processed['supplier_name'] = self.config.get('supplierName', '')
        
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
        if url and not (url.startswith('http://') or url.startswith('https://') or self._is_ip(url)):
            # 允许宽松的 URL 格式
            pass
        
        return is_valid, errors
    
    def _is_ip(self, text: str) -> bool:
        """检查是否为 IP 地址"""
        import re
        ip_pattern = r'^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$'
        return bool(re.match(ip_pattern, text.strip()))
    
    def generate(self, data: Dict[str, Any], output_dir: str) -> Tuple[bool, str, str]:
        """
        生成漏洞报告
        """
        self.output_dir = output_dir
        
        try:
            # 延迟导入，避免循环依赖
            from core.document_editor import DocumentEditor
            from core.document_image_processor import DocumentImageProcessor
            
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
            
            # 处理备案截图
            icp_screenshot = data.get('icp_screenshot')
            if icp_screenshot:
                # 支持路径字符串或对象
                icp_path = icp_screenshot if isinstance(icp_screenshot, str) else icp_screenshot.get('path', '')
                if icp_path and os.path.exists(icp_path):
                    img_processor.text_with_image("#screenshotoffiling#", icp_path)
                else:
                    editor.replace_report_text({"#screenshotoffiling#": "（未提供）"})
            else:
                editor.replace_report_text({"#screenshotoffiling#": "（未提供）"})
            
            # 处理漏洞证据截图
            vuln_images = data.get('vuln_evidence_images', [])
            if vuln_images:
                for item in vuln_images:
                    if isinstance(item, dict):
                        img_path = item.get('path', '')
                        description = item.get('description', '')
                    else:
                        img_path = str(item)
                        description = ''
                    
                    if img_path and os.path.exists(img_path):
                        img_processor.text_with_image(description, img_path, keyword="#evidenceScreenshot#")
            else:
                # 无图片时清理占位符
                img_processor.replace_placeholder_with_images('#evidenceScreenshot#', [])
            
            # 5. 保存报告
            output_path = self._generate_output_path(data)
            final_path = self.save_document(doc, output_path)
            
            return True, final_path, "报告生成成功"
            
        except Exception as e:
            import traceback
            traceback.print_exc()
            return False, "", f"报告生成失败: {str(e)}"
    
    def _generate_output_path(self, data: Dict[str, Any]) -> str:
        """生成输出文件路径"""
        unit_name = data.get('unit_name', 'Unknown')
        region = data.get('region', '')
        hazard_type = data.get('hazard_type', '漏洞报告')
        report_name = data.get('report_name', 'Report')
        hazard_level = data.get('hazard_level', '高危')
        
        # 创建客户公司目录
        company_dir = os.path.join(self.output_dir, unit_name)
        os.makedirs(company_dir, exist_ok=True)
        
        # 构建文件名
        filename = f"【{region}】【{hazard_type}】{report_name}【{hazard_level}】.docx"
        
        # 清理非法字符
        import re
        filename = re.sub(r'[<>:"/\\|?*]', '_', filename)
        
        return os.path.join(company_dir, filename)
    
    def postprocess(self, output_path: str, data: Dict[str, Any]) -> None:
        """
        后处理：记录日志
        """
        try:
            # 记录到 TXT 日志
            report_time = data.get('report_time', self.get_current_date())
            log_fields = [
                data.get('hazard_type', ''),
                data.get('unit_name', ''),
                data.get('url', ''),
                data.get('vuln_name', ''),
                data.get('supplier_name', self.config.get('supplierName', '')),
                data.get('hazard_level', ''),
                report_time
            ]
            # 使用统一的日志方法，前缀为 vuln
            self.write_txt_log(self.output_dir, "vuln", log_fields)
            
            # 记录到 SQLite 数据库
            db_name = f"{report_time}_output.db"
            
            # 构建记录字典
            record = {
                'vulnerability_id': data.get('vulnerability_id', ''),
                'hazard_type': data.get('hazard_type', ''),
                'hazard_level': data.get('hazard_level', ''),
                'alert_level': data.get('alert_level', ''),
                'vuln_name': data.get('vuln_name', ''),
                'unit_type': data.get('unit_type', ''),
                'industry': data.get('industry', ''),
                'unit_name': data.get('unit_name', ''),
                'url': data.get('url', ''),
                'website_name': data.get('website_name', ''),
                'domain': data.get('domain', ''),
                'ip': data.get('ip', ''),
                'icp_number': data.get('icp_number', ''),
                'discovery_date': data.get('discovery_date', ''),
                'city': data.get('city', ''),
                'region': data.get('region', ''),
                'supplier_name': data.get('supplier_name', ''),
                'report_time': report_time
            }
            
            self.write_db_log(self.output_dir, db_name, "vuln_report", record)
            
        except Exception as e:
            logger.error(f"Postprocess error: {e}")

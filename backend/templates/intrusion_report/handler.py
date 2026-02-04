# -*- coding: utf-8 -*-
"""
@Createtime: 2026-01-26
@Description: 入侵痕迹报告模板处理器
"""

import os
import re
from datetime import datetime
from typing import Dict, Any, Optional

from core.base_handler import BaseTemplateHandler, register_handler
from core.logger import setup_logger

# 初始化日志记录器
logger = setup_logger('IntrusionHandler')



# 严重等级映射
SEVERITY_LEVEL_MAP = {
    'critical': '严重',
    'high': '高危',
    'medium': '中危',
    'low': '低危',
    '严重': '严重',
    '高危': '高危',
    '中危': '中危',
    '低危': '低危'
}

# 入侵类型映射
INTRUSION_TYPE_MAP = {
    'webshell': 'Webshell植入',
    'backdoor': '后门程序',
    'malware': '恶意软件',
    'data_theft': '数据窃取',
    'privilege_escalation': '权限提升',
    'lateral_movement': '横向移动',
    'crypto_mining': '挖矿木马',
    'ransomware': '勒索软件',
    'other': '其他'
}


@register_handler("intrusion_report")
class IntrusionReportHandler(BaseTemplateHandler):
    """入侵痕迹报告处理器"""
    
    def __init__(self, template_manager, template_id: str, config: Dict):
        super().__init__(template_manager, template_id, config)
    
    def preprocess(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """预处理数据"""
        processed = data.copy()
        
        # 自动生成报告编号
        if not processed.get('report_id'):
            processed['report_id'] = self.generate_report_id(prefix="IR", use_sequence=False)
        
        # 转换入侵类型显示值
        intrusion_type = processed.get('intrusion_type', '')
        if intrusion_type in INTRUSION_TYPE_MAP:
            processed['intrusion_type_display'] = INTRUSION_TYPE_MAP[intrusion_type]
        else:
            processed['intrusion_type_display'] = intrusion_type
        
        # 转换严重等级
        severity = processed.get('severity_level', '')
        if severity in SEVERITY_LEVEL_MAP:
            processed['severity_level'] = SEVERITY_LEVEL_MAP[severity]
        
        # 处理攻击手法：优先使用自定义输入，否则从漏洞库获取
        attack_method_custom = processed.get('attack_method_custom', '').strip()
        attack_method_id = processed.get('attack_method', '')
        
        if attack_method_custom:
            # 用户输入了自定义攻击手法
            processed['attack_method_display'] = attack_method_custom
        elif attack_method_id:
            # 从漏洞库中获取漏洞名称
            vuln_name = self._get_vulnerability_name(attack_method_id)
            processed['attack_method_display'] = vuln_name if vuln_name else attack_method_id
        else:
            processed['attack_method_display'] = ''
        
        # 设置默认日期
        if not processed.get('discovery_time'):
            processed['discovery_time'] = datetime.now().strftime('%Y-%m-%d')
        if not processed.get('report_time'):
            processed['report_time'] = datetime.now().strftime('%Y-%m-%d')
        
        # 设置分析人员
        if not processed.get('analyst_name'):
            processed['analyst_name'] = self.config.get('supplierName', '')
        
        return processed
    
    def _get_vulnerability_name(self, vuln_id: str) -> str:
        """
        从漏洞库获取漏洞名称
        
        Args:
            vuln_id: 漏洞ID
            
        Returns:
            漏洞名称，如果未找到则返回空字符串
        """
        try:
            # 导入数据库读取器
            from core.data_reader_db import DbDataReader
            
            # 获取数据库路径
            base_dir = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
            db_path = os.path.join(base_dir, self.config.get("vul_or_icp", "data/combined.db"))
            
            # 读取漏洞数据
            db_reader = DbDataReader(db_path, "", "")
            vuln_list, vulnerabilities = db_reader.read_vulnerabilities_from_db()
            
            # 查找漏洞名称
            if vuln_id in vulnerabilities:
                return vulnerabilities[vuln_id].get('Vuln_Name', '')
            
            # 如果ID未找到，尝试在列表中查找
            for vuln in vuln_list:
                if vuln.get('id') == vuln_id:
                    return vuln.get('name', '')
            
            return ''
        except Exception as e:
            logger.error(f"Failed to get vulnerability name: {e}")
            return ''
    
    def generate(self, data: Dict[str, Any], output_dir: str) -> tuple:
        """
        生成入侵痕迹报告
        
        Args:
            data: 预处理后的报告数据
            output_dir: 输出目录路径
            
        Returns:
            (成功标志, 输出文件路径, 消息)
        """
        from docx import Document
        from core.document_editor import DocumentEditor
        from core.document_image_processor import DocumentImageProcessor
        
        self.output_dir = output_dir
        
        try:
            # 获取模板文件路径
            template_file = self.template_manager.get_template_file_path(self.template_id)
            
            # 如果没有模板文件，创建简单文档
            if not template_file or not os.path.exists(template_file):
                return self.generate_fallback_report(data, output_dir)
            
            # 构建替换字典
            extra_replacements = {
                '#intrusion_type#': data.get('intrusion_type_display', ''),
                '#attack_method#': data.get('attack_method_display', ''),
                '#supplierName#': data.get('supplier_name') or self.config.get('supplierName', ''),
                '#reportTime#': datetime.now().strftime('%Y-%m-%d')
            }
            replacements = self.build_replacements(data, extra_replacements)
            
            # 加载并编辑文档
            doc = Document(template_file)
            editor = DocumentEditor(doc)
            
            # 执行文本替换
            editor.replace_report_text(replacements)
            
            # 处理证据图片
            evidence_images = data.get('evidence_images', [])
            log_evidence_images = data.get('log_evidence', [])

            img_processor = DocumentImageProcessor(doc, [])
            # 无论是否有图片，都需要处理占位符（有图片则替换，无图片则移除占位符）
            img_processor.replace_placeholder_with_images('#evidence_images#', evidence_images)
            img_processor.replace_placeholder_with_images('#log_evidence#', log_evidence_images)
            
            # 生成输出文件路径
            output_path = self._generate_output_path(data)
            
            # 保存文档（使用基类方法，自动处理文件名冲突）
            final_path = self.save_document(doc, output_path)
            
            return True, final_path, "入侵痕迹报告生成成功"
            
        except Exception as e:
            import traceback
            traceback.print_exc()
            return False, "", f"报告生成失败: {str(e)}"
    
    def _generate_output_path(self, data: Dict[str, Any]) -> str:
        """生成输出文件路径"""
        unit_name = data.get('unit_name', 'Unknown')
        intrusion_type = data.get('intrusion_type_display', data.get('intrusion_type', '入侵痕迹'))
        severity_level = data.get('severity_level', '高危')
        victim_ip = data.get('victim_ip', '')
        
        # 创建客户公司目录
        company_dir = os.path.join(self.output_dir, unit_name)
        os.makedirs(company_dir, exist_ok=True)
        
        # 构建文件名
        filename = f"【入侵痕迹报告】{unit_name}存在{intrusion_type}【{severity_level}】.docx"
        
        # 清理非法字符
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
                data.get('intrusion_type_display', ''),
                data.get('severity_level', ''),
                data.get('unit_name', ''),
                data.get('victim_ip', ''),
                data.get('attack_method_display', ''),
                data.get('analyst_name', self.config.get('supplierName', '')),
                report_time
            ]
            # 使用统一的日志方法，前缀为 intrusion
            self.write_txt_log(self.output_dir, "intrusion", log_fields)
            
            # 记录到 SQLite 数据库
            db_name = f"{report_time}_output.db"
            
            # 构建记录字典
            record = {
                'report_id': data.get('report_id', ''),
                'intrusion_type': data.get('intrusion_type_display', ''),
                'severity_level': data.get('severity_level', ''),
                'discovery_time': data.get('discovery_time', ''),
                'report_time': report_time,
                'analyst_name': data.get('analyst_name', ''),
                'supplier_name': data.get('supplier_name', self.config.get('supplierName', '')),
                'victim_ip': data.get('victim_ip', ''),
                'victim_hostname': data.get('victim_hostname', ''),
                'victim_os': data.get('victim_os', ''),
                'victim_service': data.get('victim_service', ''),
                'unit_name': data.get('unit_name', ''),
                'unit_type': data.get('unit_type', ''),
                'industry': data.get('industry', ''),
                'attack_method': data.get('attack_method_display', ''),
                'malware_name': data.get('malware_name', ''),
                'malware_path': data.get('malware_path', ''),
                'malware_hash': data.get('malware_hash', ''),
                'c2_address': data.get('c2_address', ''),
                'first_access_time': data.get('first_access_time', ''),
                'persistence_time': data.get('persistence_time', ''),
                'output_path': output_path
            }
            
            self.write_db_log(self.output_dir, db_name, "intrusion_report", record)
            
        except Exception as e:
            logger.error(f"Postprocess error: {e}")

# -*- coding: utf-8 -*-
"""
@Createtime: 2026-02-13
@description: Handler configuration - Consolidates handler-specific metadata
Eliminates duplication of _get_log_fields, _get_log_prefix, _build_db_record, etc.
"""

from typing import Dict, List, Any


class HandlerConfig:
    """
    Configuration for template handlers using Template Method pattern.
    
    Each handler defines its own config dict with:
    - log_prefix: Prefix for TXT log files
    - log_fields: List of field keys to extract for logging
    - db_table: Database table name
    - db_fields: Mapping of {db_column: data_key}
    
    This eliminates 15+ duplicated methods across handlers.
    """
    
    # Vulnerability Report Handler Config
    VULN_REPORT = {
        'log_prefix': 'vuln',
        'log_fields': [
            'hazard_type',
            'unit_name',
            'url',
            'vuln_name',
            'supplier_name',
            'hazard_level',
            'report_time'
        ],
        'db_table': 'vuln_report',
        'db_fields': {
            'vulnerability_id': 'vulnerability_id',
            'hazard_type': 'hazard_type',
            'hazard_level': 'hazard_level',
            'alert_level': 'alert_level',
            'vuln_name': 'vuln_name',
            'unit_type': 'unit_type',
            'industry': 'industry',
            'unit_name': 'unit_name',
            'url': 'url',
            'website_name': 'website_name',
            'domain': 'domain',
            'ip': 'ip',
            'icp_number': 'icp_number',
            'discovery_date': 'discovery_date',
            'city': 'city',
            'region': 'region',
            'supplier_name': 'supplier_name',
            'report_time': 'report_time'
        }
    }
    
    # Penetration Test Handler Config
    PENETRATION_TEST = {
        'log_prefix': 'penetration',
        'log_fields': [
            'unit_name',
            'system_full_name',
            'overall_risk_level',
            'vuln_summary',
            'supplier_name',
            'report_date'
        ],
        'db_table': 'penetration_report',
        'db_fields': {
            'unit_name': 'unit_name',
            'system_full_name': 'system_full_name',
            'supplier_name': 'supplier_name',
            'test_start_date': 'test_start_date',
            'test_end_date': 'test_end_date',
            'report_date': 'report_date',
            'overall_risk_level': 'overall_risk_level',
            'vuln_count_critical': 'vuln_count_critical',
            'vuln_count_high': 'vuln_count_high',
            'vuln_count_medium': 'vuln_count_medium',
            'vuln_count_low': 'vuln_count_low',
            'vuln_count_info': 'vuln_count_info',
            'vuln_count_total': 'vuln_count_total',
            'vuln_summary': 'vuln_summary',
            'output_path': 'output_path'
        }
    }
    
    # Intrusion Report Handler Config
    INTRUSION_REPORT = {
        'log_prefix': 'intrusion',
        'log_fields': [
            'intrusion_type_display',
            'severity_level',
            'unit_name',
            'victim_ip',
            'attack_method_display',
            'analyst_name',
            'report_time'
        ],
        'db_table': 'intrusion_report',
        'db_fields': {
            'report_id': 'report_id',
            'intrusion_type': 'intrusion_type_display',
            'severity_level': 'severity_level',
            'discovery_time': 'discovery_time',
            'report_time': 'report_time',
            'analyst_name': 'analyst_name',
            'supplier_name': 'supplier_name',
            'victim_ip': 'victim_ip',
            'victim_hostname': 'victim_hostname',
            'victim_os': 'victim_os',
            'victim_service': 'victim_service',
            'unit_name': 'unit_name',
            'unit_type': 'unit_type',
            'industry': 'industry',
            'attack_method': 'attack_method_display',
            'malware_name': 'malware_name',
            'malware_path': 'malware_path',
            'malware_hash': 'malware_hash',
            'c2_address': 'c2_address',
            'first_access_time': 'first_access_time',
            'persistence_time': 'persistence_time',
            'output_path': 'output_path'
        }
    }
    
    @classmethod
    def get_config(cls, handler_type: str) -> Dict[str, Any]:
        """Get configuration for a specific handler type"""
        configs = {
            'vuln_report': cls.VULN_REPORT,
            'penetration_test': cls.PENETRATION_TEST,
            'intrusion_report': cls.INTRUSION_REPORT,
        }
        return configs.get(handler_type, {})

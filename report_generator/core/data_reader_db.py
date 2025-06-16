# -*- coding: utf-8 -*-
"""
@Createtime: 2024-08-05 10:15
@Updatetime: 2025-05-09 15:51
@description: 从SQLite数据库中读取漏洞和备案信息
"""

import sqlite3
import pandas as pd
from datetime import datetime

class DbDataReader:
    def __init__(self, db_path):
        self.db_path = db_path

    def read_Icp_from_db(self):
        """从SQLite数据库读取ICP信息"""
        try:
            conn = sqlite3.connect(self.db_path)
            query = "SELECT * FROM icp_info_Sheet1"
            df = pd.read_sql_query(query, conn)
            conn.close()
            
            # 转换为字典格式
            icp_infos = {}
            for _, row in df.iterrows():
                domain = row['domain'].lower() if isinstance(row['domain'], str) else ''  # 确保域名转小写且非空
                if domain:  # 只添加有效的域名记录
                    icp_infos[domain] = {
                        'domain': domain,
                        'unitName': str(row['unitName']),
                        'natureName': str(row['natureName']),
                        'mainLicence': str(row['mainLicence']),
                        'serviceLicence': str(row['serviceLicence']),
                        'updateRecordTime': self._format_date(row['updateRecordTime'])
                    }
            return icp_infos
        except Exception as e:
            print(f"读取ICP信息时出错：{str(e)}")
            return {}

    def read_vulnerabilities_from_db(self):
        """从SQLite数据库读取漏洞信息"""
        try:
            conn = sqlite3.connect(self.db_path)
            query = "SELECT * FROM vulnerabilities_Sheet1"
            df = pd.read_sql_query(query, conn)
            conn.close()
            
            # 转换为所需格式
            vulnerability_names = []
            vulnerabilities = {}
            
            for _, row in df.iterrows():
                name = str(row['漏洞名称']).strip()
                if name:  # 只处理有效的漏洞名称
                    name_lower = name.lower()
                    vulnerability_names.append(name)
                    vulnerabilities[name_lower] = {
                        "漏洞名称": name,
                        "风险级别": str(row['风险级别']).strip(),
                        "漏洞描述": str(row['漏洞描述']).strip(),
                        "加固建议": str(row['加固建议']).strip()
                    }
            
            return vulnerability_names, vulnerabilities
        except Exception as e:
            print(f"读取漏洞信息时出错：{str(e)}")
            return [], {}

    def _format_date(self, date_value):
        """格式化日期值"""
        if pd.isna(date_value):
            return ""
        if isinstance(date_value, datetime):
            return date_value.strftime("%Y-%m-%d")
        elif isinstance(date_value, str):
            return date_value.split(" ")[0]
        return ""

    def get_vulnerability_info(self, name):
        """根据漏洞名称获取详细信息"""
        # 确保每次查询漏洞信息都是最新的，便于实时更新
        _, vulnerabilities = self.read_vulnerabilities_from_db()
		
        name = name.lower()
        if name in vulnerabilities:
            description = vulnerabilities[name]['漏洞描述']
            solution = vulnerabilities[name]['加固建议']
            return description, solution
        return None, None

    def get_icp_info(self, domain):
        """根据域名获取ICP信息"""
		# 确保每次查询ICP信息都是最新的，便于实时更新
        Icp_infos = self.read_Icp_from_db()
		
        domain_to_search = domain.lower()
        if domain_to_search in Icp_infos:
            unitName = Icp_infos[domain_to_search]['unitName']
            serviceLicence = Icp_infos[domain_to_search]['serviceLicence']
            return unitName, serviceLicence
        return None, None
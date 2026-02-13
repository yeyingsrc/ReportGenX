# -*- coding: utf-8 -*-
"""
@Createtime: 2024-08-05 10:15
@Updatetime: 2025-05-09 15:51
@description: 从SQLite数据库中读取漏洞和备案信息
"""

import sqlite3
import re
import hashlib
from datetime import datetime
from .logger import setup_logger

# 初始化日志记录器
logger = setup_logger('DataReader')

class DbDataReader:
    def __init__(self, db_path, input_path=None, output_path=None):
        self.db_path = db_path
        self.input_path = input_path
        self.output_path = output_path

    def read_Icp_from_db(self):
        """从SQLite数据库读取ICP信息"""
        try:
            conn = sqlite3.connect(self.db_path)
            conn.row_factory = sqlite3.Row  # Allow accessing columns by name
            conn.text_factory = str  # 确保文本以字符串形式返回
            cursor = conn.cursor()
            
            query = "SELECT * FROM icp_info_Sheet1"
            cursor.execute(query)
            rows = cursor.fetchall()
            conn.close()
            
            # 转换为字典格式
            icp_infos = {}
            for row in rows:
                # row is sqlite3.Row, behaves like dict
                domain_val = row['domain']
                domain = domain_val.lower() if isinstance(domain_val, str) else ''  # 确保域名转小写且非空
                
                if domain:  # 只添加有效的域名记录
                    # 尝试修复可能的编码问题
                    def safe_str(val):
                        if val is None:
                            return ''
                        if isinstance(val, bytes):
                            try:
                                return val.decode('utf-8')
                            except UnicodeDecodeError:
                                try:
                                    return val.decode('gbk')
                                except UnicodeDecodeError:
                                    return str(val)
                        return str(val)
                    
                    icp_infos[domain] = {
                        'domain': domain,
                        'unitName': safe_str(row['unitName']),
                        'natureName': safe_str(row['natureName']),
                        'mainLicence': safe_str(row['mainLicence']),
                        'serviceLicence': safe_str(row['serviceLicence']),
                        'updateRecordTime': self._format_date(row['updateRecordTime'])
                    }
            return icp_infos
        except Exception as e:
            logger.error(f"读取ICP信息时出错：{str(e)}")
            return {}

    def read_vulnerabilities_from_db(self):
        """从SQLite数据库读取漏洞信息"""
        try:
            conn = sqlite3.connect(self.db_path)
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            
            # 尝试获取 Vuln_id 列，如果不存在则只会获取其他列
            query = "SELECT * FROM vulnerabilities_Sheet1"
            cursor.execute(query)
            rows = cursor.fetchall()
            conn.close()
            
            # 转换为所需格式
            vulnerability_list = [] # List of {id, name}
            vulnerabilities = {} # Map id -> details
            
            for row in rows:
                # Get name from 'Vuln_Name' (English)
                # row['Vuln_Name'] could be None
                name_val = row['Vuln_Name']
                name = str(name_val).strip() if name_val else ''
                
                # 获取或生成 ID
                # Check if 'Vuln_id' exists in keys (it should if select * returned it)
                # sqlite3.Row keys() method available? Yes.
                # Or just try/except or check keys
                
                Vuln_id = None
                if 'Vuln_id' in row.keys() and row['Vuln_id']:
                     Vuln_id = str(row['Vuln_id'])
                else:
                    # Fallback compatibility
                    if name:
                         Vuln_id = hashlib.md5(name.encode('utf-8')).hexdigest()
                    else: 
                         continue # Skip invalid rows

                if name:  # 只处理有效的漏洞名称
                    # id, name for simple lists
                    vulnerability_list.append({"id": Vuln_id, "name": name})
                    
                    # STRICT ENGLISH KEYS as requested
                    vulnerabilities[Vuln_id] = {
                        "id": Vuln_id,
                        "Vuln_Name": name,
                        "Vuln_Class": self._clean_str(row['Vuln_Class']),
                        "Default_port": self._clean_str(row['Default_port']),
                        "Risk_Level": self._clean_str(row['Risk_Level']),
                        "Class_basis": self._clean_str(row['Class_basis']),
                        "Vuln_Description": self._clean_str(row['Vuln_Description']),
                        "Vuln_Hazards": self._clean_str(row['Vuln_Hazards']),
                        "Repair_suggestions": self._clean_str(row['Repair_suggestions'])
                    }
            
            return vulnerability_list, vulnerabilities
        except Exception as e:
            logger.error(f"读取漏洞信息时出错：{str(e)}")
            return [], {}

    def _format_date(self, date_value):
        """格式化日期值"""
        if date_value is None:
            return ""
        if isinstance(date_value, datetime):
            return date_value.strftime("%Y-%m-%d")
        elif isinstance(date_value, str):
            return date_value.split(" ")[0]
        return ""

    def _clean_str(self, val):
        """清理字符串，处理NaN和None，以及浮点数整数化"""
        if val is None:
            return ""
        # 如果是浮点数且实际上是整数值（如 1.0），转换为整数字符串
        if isinstance(val, float):
            if val.is_integer():
                return str(int(val))
            return str(val)
        s = str(val).strip()
        return "" if s.lower() == 'nan' else s

    def get_vulnerability_info(self, Vuln_id):
        """根据漏洞ID获取详细信息"""
        # 确保每次查询漏洞信息都是最新的，便于实时更新
        _, vulnerabilities = self.read_vulnerabilities_from_db()
		
        # 支持 ID 查询
        if Vuln_id in vulnerabilities:
            return vulnerabilities[Vuln_id]['Vuln_Description'], vulnerabilities[Vuln_id]['Repair_suggestions']
            
        # Fallback: 尝试按名称查询 (兼容旧代码或名称传递)
        # 遍历所有 value 找 name
        for v in vulnerabilities.values():
            if v.get('Vuln_Name') == Vuln_id:
                return v.get('Vuln_Description'), v.get('Repair_suggestions')
                
        return None, None

    def contains_empty_value(self, dictionary):
        '''
        判断字典的值是否存在空值
        '''
        return any(not value for value in dictionary.values())

    def get_icp_info(self, domain):
        """根据域名获取ICP信息"""
        # 确保每次查询ICP信息都是最新的，便于实时更新
        Icp_infos = self.read_Icp_from_db()
		
        domain_to_search = domain.lower()
        if domain_to_search in Icp_infos:
            unitName = Icp_infos[domain_to_search]['unitName']
            serviceLicence = Icp_infos[domain_to_search]['serviceLicence']
        
            # 检查字典是否包含空值
            if not self.contains_empty_value(Icp_infos[domain_to_search]):
                pass
                # if self.input_path and self.output_path:
                #     mhtml_modifier = MHtmlModifier(domain_to_search, self.input_path, self.output_path, Icp_infos)
                #     mhtml_modifier.modify_mhtml_file()
            return unitName, serviceLicence
        return None, None

    def _ensure_column_exists(self, conn, table_name, column_name, col_type="TEXT"):
        """确保表中存在指定列，如果不存在则添加"""
        # Security: Validate identifiers
        if not re.match(r'^[a-zA-Z0-9_]+$', table_name):
             logger.error(f"Security check failed: Invalid table name '{table_name}'")
             return False
        if not re.match(r'^[a-zA-Z0-9_]+$', column_name):
             logger.error(f"Security check failed: Invalid column name '{column_name}'")
             return False

        try:
            cursor = conn.cursor()
            # 获取所有列名
            cursor.execute(f"PRAGMA table_info({table_name})")
            columns = [info[1] for info in cursor.fetchall()]
            
            if column_name not in columns:
                cursor.execute(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {col_type}")
                return True
            return False
        except Exception as e:
            logger.error(f"检查/添加列失败: {e}")
            return False

    def add_vulnerability_to_db(self, vuln_data):
        """添加新漏洞到数据库"""
        try:
            conn = sqlite3.connect(self.db_path)
            
            # --- Schema Migration: Ensure Vuln_id columns exist ---
            self._ensure_column_exists(conn, "vulnerabilities_Sheet1", "Vuln_id")
            
            cursor = conn.cursor()
            
            import hashlib
            name = vuln_data.get('name', '').strip()
            if not name:
                return False, "漏洞名称不能为空"

            # Check duplication (English Key Only)
            cursor.execute(
                "SELECT count(*) FROM vulnerabilities_Sheet1 WHERE Vuln_Name=?", 
                (name,)
            )
            if cursor.fetchone()[0] > 0:
                conn.close()
                return False, "该漏洞名称已存在"

            vuln_id = hashlib.md5(name.encode('utf-8')).hexdigest()

            # Strict English Columns Insertion
            fields = [
                'Vuln_id', 'Vuln_Name', 'Vuln_Class', 'Default_port', 
                'Risk_Level', 'Class_basis', 'Vuln_Description', 
                'Vuln_Hazards', 'Repair_suggestions'
            ]
            values = [
                vuln_id,
                name,
                vuln_data.get('category', ''),
                vuln_data.get('port', ''),
                vuln_data.get('level', ''),
                vuln_data.get('basis', ''),
                vuln_data.get('description', ''),
                vuln_data.get('impact', ''),
                vuln_data.get('suggestion', '')
            ]
            
            placeholders = ','.join(['?'] * len(fields))
            col_str = ','.join(fields)
            
            final_sql = f"INSERT INTO vulnerabilities_Sheet1 ({col_str}) VALUES ({placeholders})"
            cursor.execute(final_sql, values)
            
            conn.commit()
            conn.close()
            return True, "添加成功"
        except Exception as e:
            return False, f"添加失败: {str(e)}"

    def update_vulnerability_in_db(self, vuln_id, vuln_data):
        """更新数据库中的漏洞信息"""
        try:
            conn = sqlite3.connect(self.db_path)
            
            # --- Schema Migration ---
            self._ensure_column_exists(conn, "vulnerabilities_Sheet1", "Vuln_id")
            
            cursor = conn.cursor()
            
            updates = []
            values = []
            
            # English Mapping Only
            mapping = {
                'Vuln_Name': vuln_data.get('name'),
                'Vuln_Class': vuln_data.get('category'),
                'Default_port': vuln_data.get('port'),
                'Risk_Level': vuln_data.get('level'),
                'Class_basis': vuln_data.get('basis'),
                'Vuln_Description': vuln_data.get('description'),
                'Vuln_Hazards': vuln_data.get('impact'),
                'Repair_suggestions': vuln_data.get('suggestion')
            }

            for col, val in mapping.items():
                if val is not None:
                    updates.append(f"{col}=?")
                    values.append(val)
            
            if not updates:
                conn.close()
                return False, "没有可更新的字段"

            values.append(vuln_id)
            sql = f"UPDATE vulnerabilities_Sheet1 SET {', '.join(updates)} WHERE Vuln_id=?"
            
            cursor.execute(sql, tuple(values))
            
            if cursor.rowcount == 0:
                 # No legacy fallback logic needed
                 pass

            conn.commit()
            conn.close()
            return True, "更新成功"
        except Exception as e:
            return False, f"更新失败: {str(e)}"

    def delete_vulnerability_from_db(self, vuln_id):
        try:
            conn = sqlite3.connect(self.db_path)
            
            # --- Schema Migration ---
            self._ensure_column_exists(conn, "vulnerabilities_Sheet1", "Vuln_id")
            
            cursor = conn.cursor()
            cursor.execute("DELETE FROM vulnerabilities_Sheet1 WHERE Vuln_id=?", (vuln_id,))
            if cursor.rowcount == 0:
                # Fallback: legacy delete by name? No, risky. 
                pass
            conn.commit()
            conn.close()
            return True, "删除成功"
        except Exception as e:
            return False, f"删除失败: {str(e)}"

    def get_table_columns(self, table_name):
        """获取表头字段"""
        # Security: Validate table name
        if not re.match(r'^[a-zA-Z0-9_]+$', table_name):
            logger.error(f"Security check failed: Invalid table name '{table_name}'")
            return []
        
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            cursor.execute(f"PRAGMA table_info({table_name})")
            columns = [info[1] for info in cursor.fetchall()]
            conn.close()
            return columns
        except Exception as e:
            logger.error(f"Error getting columns for {table_name}: {e}")
            return []

    def read_icp_raw_list(self):
        """读取原始ICP数据列表（带所有字段）"""
        try:
            conn = sqlite3.connect(self.db_path)
            conn.row_factory = sqlite3.Row # Allow dict-like access
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM icp_info_Sheet1")
            rows = cursor.fetchall()
            
            result = []
            for row in rows:
                result.append(dict(row))
            conn.close()
            return result
        except Exception as e:
            logger.error(f"Error reading ICP raw: {e}")
            return []

    def delete_icp_entry(self, vuln_id):
        """删除指定的 ICP 信息 (根据 Vuln_id)"""
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            
            cursor.execute("DELETE FROM icp_info_Sheet1 WHERE Vuln_id = ?", (vuln_id,))
            rows_affected = cursor.rowcount
            
            conn.commit()
            conn.close()
            
            if rows_affected > 0:
                return True, f"成功删除记录 {vuln_id}"
            else:
                return False, "未找到对应记录或删除失败"
        except Exception as e:
            return False, str(e)

    def add_icp_entry(self, data):
        """添加 ICP 备案信息"""
        try:
            conn = sqlite3.connect(self.db_path)
            # Ensure Vuln_id exists (migrating implicitly if needed)
            self._ensure_column_exists(conn, "icp_info_Sheet1", "Vuln_id")
            
            cursor = conn.cursor()
            
            # Generate ID
            import uuid
            vuln_id = str(uuid.uuid4())
            
            # Fields based on observation: 
            # unitName (性质), natureName (单位名称), domain, mainLicence, serviceLicence, updateRecordTime
            fields = ['Vuln_id', 'unitName', 'natureName', 'domain', 'mainLicence', 'serviceLicence', 'updateRecordTime']
            
            values = [
                vuln_id,
                data.get('unitName', ''),    # 对应页面上的 "性质"
                data.get('natureName', ''),  # 对应页面上的 "单位名称"
                data.get('domain', ''),
                data.get('mainLicence', ''),
                data.get('serviceLicence', ''),
                data.get('updateRecordTime', '')
            ]
            
            placeholders = ','.join(['?'] * len(fields))
            col_str = ','.join(fields)
            
            sql = f"INSERT INTO icp_info_Sheet1 ({col_str}) VALUES ({placeholders})"
            cursor.execute(sql, values)
            conn.commit()
            conn.close()
            return True, "添加成功"
        except Exception as e:
            return False, f"添加失败: {str(e)}"

    def update_icp_entry(self, vuln_id, data):
        """更新 ICP 备案信息"""
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            
            updates = []
            values = []
            
            mapping = {
                'unitName': data.get('unitName'),
                'natureName': data.get('natureName'),
                'domain': data.get('domain'),
                'mainLicence': data.get('mainLicence'),
                'serviceLicence': data.get('serviceLicence'),
                'updateRecordTime': data.get('updateRecordTime')
            }

            for col, val in mapping.items():
                if val is not None:
                    updates.append(f"{col}=?")
                    values.append(val)
            
            if not updates:
                conn.close()
                return False, "没有可更新的字段"

            values.append(vuln_id)
            sql = f"UPDATE icp_info_Sheet1 SET {', '.join(updates)} WHERE Vuln_id=?"
            
            cursor.execute(sql, tuple(values))
            affected = cursor.rowcount
            conn.commit()
            conn.close()
            
            if affected > 0:
                return True, "更新成功"
            else:
                return False, "记录不存在"
        except Exception as e:
            return False, f"更新失败: {str(e)}"

    def batch_delete_icp(self, id_list):
        """批量删除 ICP 信息"""
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            
            if not id_list:
                return True, "未选择记录"
                
            placeholders = ','.join(['?'] * len(id_list))
            sql = f"DELETE FROM icp_info_Sheet1 WHERE Vuln_id IN ({placeholders})"
            
            cursor.execute(sql, id_list)
            conn.commit()
            conn.close()
            return True, f"成功删除 {cursor.rowcount} 条记录"
        except Exception as e:
            return False, f"批量删除失败: {str(e)}"
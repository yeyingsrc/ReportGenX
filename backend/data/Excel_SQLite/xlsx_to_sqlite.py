# -*- coding: utf-8 -*-
"""
@Createtime: 2024-08-05 10:15
@Updatetime: 2025-05-08 15:30
@description: Excel与SQLite数据库间相互转换工具
"""

import os
import re
import sys
import sqlite3
import argparse
import pandas as pd
from pathlib import Path
import hashlib
import json
try:
    import yaml
except Exception:
    yaml = None


class ExcelToSQLite:
    """Excel与SQLite转换器类，提供Excel和SQLite数据库之间的相互转换功能"""
    
    def __init__(self):
        """初始化转换器"""
        # SQLite关键字列表
        self.sqlite_keywords = [
            'ABORT', 'ACTION', 'ADD', 'AFTER', 'ALL', 'ALTER', 'ANALYZE', 'AND', 'AS', 'ASC',
            'ATTACH', 'AUTOINCREMENT', 'BEFORE', 'BEGIN', 'BETWEEN', 'BY', 'CASCADE', 'CASE',
            'CAST', 'CHECK', 'COLLATE', 'COLUMN', 'COMMIT', 'CONFLICT', 'CONSTRAINT', 'CREATE',
            'CROSS', 'CURRENT_DATE', 'CURRENT_TIME', 'CURRENT_TIMESTAMP', 'DATABASE', 'DEFAULT',
            'DEFERRABLE', 'DEFERRED', 'DELETE', 'DESC', 'DETACH', 'DISTINCT', 'DROP', 'EACH',
            'ELSE', 'END', 'ESCAPE', 'EXCEPT', 'EXCLUSIVE', 'EXISTS', 'EXPLAIN', 'FAIL', 'FOR',
            'FOREIGN', 'FROM', 'FULL', 'GLOB', 'GROUP', 'HAVING', 'IF', 'IGNORE', 'IMMEDIATE',
            'IN', 'INDEX', 'INDEXED', 'INITIALLY', 'INNER', 'INSERT', 'INSTEAD', 'INTERSECT',
            'INTO', 'IS', 'ISNULL', 'JOIN', 'KEY', 'LEFT', 'LIKE', 'LIMIT', 'MATCH', 'NATURAL',
            'NO', 'NOT', 'NOTNULL', 'NULL', 'OF', 'OFFSET', 'ON', 'OR', 'ORDER', 'OUTER', 'PLAN',
            'PRAGMA', 'PRIMARY', 'QUERY', 'RAISE', 'RECURSIVE', 'REFERENCES', 'REGEXP', 'REINDEX',
            'RELEASE', 'RENAME', 'REPLACE', 'RESTRICT', 'RIGHT', 'ROLLBACK', 'ROW', 'SAVEPOINT',
            'SELECT', 'SET', 'TABLE', 'TEMP', 'TEMPORARY', 'THEN', 'TO', 'TRANSACTION', 'TRIGGER',
            'UNION', 'UNIQUE', 'UPDATE', 'USING', 'VACUUM', 'VALUES', 'VIEW', 'VIRTUAL', 'WHEN',
            'WHERE', 'WITH', 'WITHOUT'
        ]
    
    def normalize_column_name(self, name):
        """
        规范化列名，替换或移除SQLite不支持的字符
        
        参数:
            name: 原始列名
            
        返回:
            规范化后的列名
        """
        # Mapping Chinese to English if found (User request conversion logic)
        CH_TO_EN = {
            'vuln_id': 'Vuln_id',
            '漏洞分类': 'Vuln_Class',
            '漏洞名称': 'Vuln_Name',
            '默认端口': 'Default_port',
            '风险级别': 'Risk_Level',
            '定级依据': 'Class_basis',
            '漏洞描述': 'Vuln_Description',
            '漏洞危害': 'Vuln_Hazards',
            '加固建议': 'Repair_suggestions',
            # ICP备案信息映射
            'domainId': 'domainId',
            'natureName': 'natureName',
            'unitName': 'unitName',
            'domain': 'domain',
            'mainLicence': 'mainLicence',
            'serviceLicence': 'serviceLicence',
            'updateRecordTime': 'updateRecordTime',
            'contentTypeName': 'contentTypeName',
            'leaderName': 'leaderName',
            'limitAccess': 'limitAccess',
            'mainId': 'mainId',
            'serviceId': 'serviceId'

        }
        
        name_str = str(name).strip()
        if name_str in CH_TO_EN:
            return CH_TO_EN[name_str]

        # 处理空列名
        if not name or pd.isna(name):
            return "column_" + str(abs(hash(str(name))) % 10000)
        
        # 转换为字符串
        name = str(name).strip()
        
        # 替换常见的问题字符
        name = re.sub(r'[^\w\s]', '_', name)
        
        # 确保不以数字开头
        if name and name[0].isdigit():
            name = 'col_' + name
        
        # 处理空格
        name = name.replace(' ', '_')
        
        # 处理SQLite关键字
        if name.upper() in self.sqlite_keywords:
            name = name + '_'
        
        # 如果经过处理后名称为空，为其生成一个唯一标识
        if not name:
            name = "column_" + str(abs(hash(str(name))) % 10000)
        
        return name
    
    def convert_file(self, xlsx_file, db_file=None):
        """
        将单个Excel文件转换为SQLite数据库
        
        参数:
            xlsx_file: Excel文件路径
            db_file: SQLite数据库文件路径，如果为None则使用与Excel文件相同的名称
            
        返回:
            生成的SQLite数据库文件路径
        """
        # 获取Excel文件的绝对路径
        xlsx_path = Path(xlsx_file).resolve()
        
        # 如果未指定数据库文件路径，则使用Excel文件名
        if db_file is None:
            db_file = xlsx_path.with_suffix('.db')
        else:
            db_file = Path(db_file).resolve()
        
        # 读取Excel文件的所有sheet
        print(f"正在读取Excel文件: {xlsx_path}")
        xlsx = pd.ExcelFile(xlsx_path)
        sheet_names = xlsx.sheet_names
        
        # 创建SQLite连接
        print(f"正在创建数据库: {db_file}")
        conn = sqlite3.connect(db_file)
        
        # 遍历每个sheet并转换为表
        for sheet_name in sheet_names:
            print(f"正在处理工作表: {sheet_name}")
            df = pd.read_excel(xlsx_path, sheet_name=sheet_name)
            
            # 删除全为空的行
            df.dropna(how='all', inplace=True)
            
            # 规范化表名（移除非法字符）
            table_name = ''.join(c if c.isalnum() else '_' for c in sheet_name)
            
            # 检查工作表是否为空
            if df.empty:
                print(f"工作表 {sheet_name} 为空，跳过该表")
                continue
            
            # 检查是否有无效的列名(全部为NaN)
            if df.columns.isnull().any():
                # 重新命名列
                df.columns = [f"column_{i}" if pd.isna(col) else col for i, col in enumerate(df.columns)]
            
            # 规范化列名，移除或替换SQLite不支持的字符
            df.columns = [self.normalize_column_name(col) for col in df.columns]
            
            # --- Generate unique ID for new entries ---
            # 主要用于 vulnerabilities 表
            if 'vulnerabilities' in table_name.lower() or 'Sheet1'in table_name: # Handle table naming flexibility
                if 'id' not in df.columns and 'ID' not in df.columns:
                     # 使用 MD5 哈希基于行内容生成 ID (Deterministic)
                     # 这样重新运行脚本且内容没变时，ID 保持不变
                    def generate_id(row):
                         # 连接所有列的内容
                        content = "".join([str(val) for val in row.values])
                        return hashlib.md5(content.encode('utf-8')).hexdigest()

                    df.insert(0, 'Vuln_id', df.apply(generate_id, axis=1))


            self._write_dataframe_to_sqlite(df, table_name, conn)
        
        # 关闭连接
        conn.close()
        
        print(f"转换完成！Excel文件 {xlsx_path} 已转换为SQLite数据库 {db_file}")
        return db_file
    
    def convert_directory(self, directory='.', output_db=None):
        """
        转换目录中的所有xlsx文件到一个SQLite数据库
        
        参数:
            directory: 包含xlsx文件的目录
            output_db: 输出的SQLite数据库文件名，如果为None则使用目录名
            
        返回:
            生成的SQLite数据库文件路径
        """
        directory = Path(directory).resolve()
        
        # 如果未指定输出数据库名，则使用目录名
        if output_db is None:
            output_db = directory.name + '.db'
        
        output_db = directory / output_db
        
        # 创建SQLite连接
        print(f"正在创建统一数据库: {output_db}")
        conn = sqlite3.connect(output_db)
        
        # 查找目录中的所有xlsx文件
        xlsx_files = list(directory.glob('*.xlsx'))
        
        if not xlsx_files:
            print(f"在目录 {directory} 中未找到xlsx文件")
            return None
        
        # 遍历每个xlsx文件
        for xlsx_file in xlsx_files:
            print(f"\n处理文件: {xlsx_file.name}")
            
            try:
                # 读取Excel文件的所有sheet
                xlsx = pd.ExcelFile(xlsx_file)
                sheet_names = xlsx.sheet_names
                
                # 遍历每个sheet并转换为表
                for sheet_name in sheet_names:
                    print(f"正在处理工作表: {sheet_name}")
                    
                    try:
                        df = pd.read_excel(xlsx_file, sheet_name=sheet_name)
                        
                        # 删除全为空的行
                        df.dropna(how='all', inplace=True)
                        
                        # 规范化表名（使用文件名和工作表名组合）
                        base_filename = xlsx_file.stem
                        table_name = f"{base_filename}_{sheet_name}"
                        table_name = ''.join(c if c.isalnum() else '_' for c in table_name)
                        
                        # 检查工作表是否为空
                        if df.empty:
                            print(f"工作表 {sheet_name} 为空，跳过该表")
                            continue
                        
                        # 检查是否有无效的列名(全部为NaN)
                        if df.columns.isnull().any():
                            # 重新命名列
                            df.columns = [f"column_{i}" if pd.isna(col) else col for i, col in enumerate(df.columns)]
                        
                        # 规范化列名，移除或替换SQLite不支持的字符
                        df.columns = [self.normalize_column_name(col) for col in df.columns]
                        
                        # --- Generate unique ID for new entries ---
                        # 主要用于 vulnerabilities 表
                        if 'vulnerabilities' in table_name.lower() or 'Sheet1'in table_name: # Handle table naming flexibility
                            if 'id' not in df.columns and 'ID' not in df.columns:
                                 # 使用 MD5 哈希基于行内容生成 ID (Deterministic)
                                 # 这样重新运行脚本且内容没变时，ID 保持不变
                                def generate_id(row):
                                     # 连接所有列的内容
                                    content = "".join([str(val) for val in row.values])
                                    return hashlib.md5(content.encode('utf-8')).hexdigest()

                                df.insert(0, 'Vuln_id', df.apply(generate_id, axis=1))


                        self._write_dataframe_to_sqlite(df, table_name, conn)
                    except Exception as e:
                        print(f"读取工作表 {sheet_name} 时出错: {e}")
                        print(f"跳过工作表 {sheet_name}")
                        continue
            except Exception as e:
                print(f"读取文件 {xlsx_file} 时出错: {e}")
                print(f"跳过文件 {xlsx_file}")
                continue
        
        # 关闭连接
        conn.close()
        
        print(f"\n转换完成！所有Excel文件已合并到SQLite数据库 {output_db}")
        return output_db
    
    def _write_dataframe_to_sqlite(self, df, table_name, conn):
        """
        将DataFrame写入SQLite数据库
        
        参数:
            df: 要写入的DataFrame
            table_name: 表名
            conn: SQLite连接对象
        """
        # 自动添加 ID (如果它看起来像是一个漏洞表)
        is_vuln_table = 'vulnerabilities' in table_name.lower() or '漏洞' in table_name
        # Fallback check cols
        if not is_vuln_table:
             col_str = "".join([str(c) for c in df.columns])
             if '漏洞名称' in col_str or 'vulnerability' in col_str.lower():
                 is_vuln_table = True

        if is_vuln_table and 'Vuln_id' not in df.columns:
            try:
                import hashlib
                def generate_id(row):
                    # Use specific columns if available for stable ID, else full row
                    if '漏洞名称' in row:
                        content = str(row['漏洞名称'])
                    elif 'name' in row:
                        content = str(row['name'])
                    else:
                        content = "".join([str(val) for val in row.values])
                    return hashlib.md5(content.encode('utf-8')).hexdigest()
                
                # Make sure to handle potential issues
                # Create a copy to avoid SettingWithCopy warning if it's a slice
                df = df.copy() 
                df.insert(0, 'Vuln_id', df.apply(generate_id, axis=1))
                print(f"为表 {table_name} 自动生成了 Vuln_id")
            except Exception as e:
                print(f"生成ID失败: {e}")

        try:
            # 将数据写入SQLite
            df.to_sql(table_name, conn, if_exists='replace', index=False)
            print(f"已创建表: {table_name}，包含 {len(df)} 行数据")
        except sqlite3.Error as e:
            print(f"处理表 {table_name} 时出错: {e}")
            print("尝试使用替代方法写入...")
            
            # 如果标准方法失败，尝试手动创建表并插入数据
            try:
                # 创建临时表名
                temp_table_name = f"temp_{table_name}"
                
                # 如果DataFrame没有列，则跳过
                if df.columns.empty:
                    print(f"工作表没有列，跳过该表")
                    return
                
                # 创建表
                columns = []
                for col in df.columns:
                    # 处理列类型
                    if pd.api.types.is_integer_dtype(df[col]):
                        dtype = "INTEGER"
                    elif pd.api.types.is_float_dtype(df[col]):
                        dtype = "REAL"
                    else:
                        dtype = "TEXT"
                    
                    col_name = f'"{col}"'
                    columns.append(f"{col_name} {dtype}")
                
                # 如果没有列定义，跳过
                if not columns:
                    print(f"工作表没有有效列，跳过该表")
                    return
                
                create_stmt = f"CREATE TABLE IF NOT EXISTS {temp_table_name} ({', '.join(columns)})"
                conn.execute(create_stmt)
                
                # 逐行插入数据
                for _, row in df.iterrows():
                    placeholders = ", ".join(["?"] * len(df.columns))
                    insert_stmt = f'INSERT INTO {temp_table_name} VALUES ({placeholders})'
                    
                    # 处理NaN值
                    values = []
                    for val in row:
                        if pd.isna(val):
                            values.append(None)
                        else:
                            values.append(val)
                            
                    conn.execute(insert_stmt, values)
                
                # 重命名表
                conn.execute(f"DROP TABLE IF EXISTS {table_name}")
                conn.execute(f"ALTER TABLE {temp_table_name} RENAME TO {table_name}")
                conn.commit()
                
                print(f"已手动创建表: {table_name}，包含 {len(df)} 行数据")
            except sqlite3.Error as e2:
                print(f"替代方法也失败: {e2}")
                print(f"跳过表 {table_name}")
    
    def convert_sqlite_to_excel(self, db_file, xlsx_file=None, tables=None, separate_files=False):
        """
        将SQLite数据库转换为Excel文件
        
        参数:
            db_file: SQLite数据库文件路径
            xlsx_file: 输出Excel文件路径，如果为None则使用与数据库文件相同的名称
            tables: 要转换的表列表，如果为None则转换所有表
            separate_files: 是否将每个表保存为独立的Excel文件，如为True则xlsx_file作为目录名
            
        返回:
            生成的Excel文件路径或文件路径列表
        """
        # 获取数据库文件的绝对路径
        db_path = Path(db_file).resolve()
        
        # 创建SQLite连接
        print(f"正在读取数据库: {db_path}")
        conn = sqlite3.connect(db_path)
        
        # 获取所有表名
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        all_tables = [row[0] for row in cursor.fetchall()]
        
        if not all_tables:
            print(f"数据库 {db_path} 中没有找到表")
            conn.close()
            return None
        
        # 如果未指定表，则转换所有表
        if tables is None:
            tables = all_tables
        else:
            # 检查指定的表是否存在
            invalid_tables = [table for table in tables if table not in all_tables]
            if invalid_tables:
                print(f"警告: 以下表在数据库中不存在并将被跳过: {', '.join(invalid_tables)}")
            tables = [table for table in tables if table in all_tables]
        
        if not tables:
            print("没有找到有效的表用于转换")
            conn.close()
            return None
        
        output_files = []
        
        # 按照表分别保存为独立的Excel文件
        if separate_files:
            # 如果未指定输出路径，则使用数据库文件所在的目录
            if xlsx_file is None:
                output_dir = db_path.parent
            else:
                output_dir = Path(xlsx_file).resolve()
                
                # 确保目录存在
                if not output_dir.exists():
                    output_dir.mkdir(parents=True)
                elif not output_dir.is_dir():
                    output_dir = output_dir.parent
            
            print(f"将每个表保存为独立的Excel文件到: {output_dir}")
            
            # 遍历每个表并转换为独立的Excel文件
            for table_name in tables:
                print(f"正在处理表: {table_name}")
                
                try:
                    # 从SQLite读取表数据
                    df = pd.read_sql_query(f"SELECT * FROM {table_name}", conn)
                    
                    # 检查数据是否为空
                    if df.empty:
                        print(f"表 {table_name} 为空，跳过该表")
                        continue
                    
                    # 生成输出文件路径
                    output_file = output_dir / f"{table_name}.xlsx"
                    
                    # 写入Excel文件
                    df.to_excel(output_file, index=False)
                    output_files.append(output_file)
                    print(f"已创建文件: {output_file}，包含 {len(df)} 行数据")
                except Exception as e:
                    print(f"处理表 {table_name} 时出错: {e}")
                    print(f"跳过表 {table_name}")
                    continue
            
            print(f"\n转换完成！已将数据库 {db_path} 中的表分别保存为独立的Excel文件")
            
        # 保存为单个Excel文件
        else:
            # 如果未指定Excel文件路径，则使用数据库文件名
            if xlsx_file is None:
                xlsx_file = db_path.with_suffix('.xlsx')
            else:
                xlsx_file = Path(xlsx_file).resolve()
            
            # 创建Excel写入器
            print(f"正在创建Excel文件: {xlsx_file}")
            with pd.ExcelWriter(xlsx_file, engine='openpyxl') as writer:
                # 遍历每个表并转换为工作表
                for table_name in tables:
                    print(f"正在处理表: {table_name}")
                    
                    try:
                        # 从SQLite读取表数据
                        df = pd.read_sql_query(f"SELECT * FROM {table_name}", conn)
                        
                        # 检查数据是否为空
                        if df.empty:
                            print(f"表 {table_name} 为空，跳过该表")
                            continue
                        
                        # 写入工作表
                        df.to_excel(writer, sheet_name=table_name, index=False)
                        print(f"已创建工作表: {table_name}，包含 {len(df)} 行数据")
                    except Exception as e:
                        print(f"处理表 {table_name} 时出错: {e}")
                        print(f"跳过表 {table_name}")
                        continue
            
            output_files = [xlsx_file]
            print(f"转换完成！SQLite数据库 {db_path} 已转换为Excel文件 {xlsx_file}")
        
        # 关闭连接
        conn.close()
        
        return output_files

    def convert_sqlite_to_json(self, db_file, json_file=None, tables=None, pretty=False, indent=4):
        """
        将SQLite数据库转换为JSON文件。

        参数:
            db_file: SQLite数据库文件路径
            json_file: 输出JSON文件路径，如果为None则使用与数据库文件相同的名称
            tables: 要转换的表列表，如果为None则转换所有表
            pretty: 是否以可读的格式（缩进）输出
            indent: 缩进空格数（仅当pretty为True时生效）

        返回:
            生成的JSON文件路径
        """
        db_path = Path(db_file).resolve()
        print(f"正在读取数据库: {db_path}")
        conn = sqlite3.connect(db_path)

        cursor = conn.cursor()
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        all_tables = [row[0] for row in cursor.fetchall()]

        if not all_tables:
            print(f"数据库 {db_path} 中没有找到表")
            conn.close()
            return None

        # 如果未指定表，则转换所有表
        if tables is None:
            tables = all_tables
        else:
            invalid_tables = [table for table in tables if table not in all_tables]
            if invalid_tables:
                print(f"警告: 以下表在数据库中不存在并将被跳过: {', '.join(invalid_tables)}")
            tables = [table for table in tables if table in all_tables]

        if not tables:
            print("没有找到有效的表用于转换")
            conn.close()
            return None

        # 构建输出数据结构: 如果只有一个表，输出为列表，否则输出为字典{table: [rows]}
        output_data = {}
        single_table_mode = len(tables) == 1

        for table_name in tables:
            try:
                df = pd.read_sql_query(f"SELECT * FROM {table_name}", conn)
                # 将NaN转换为None以便JSON序列化
                df = df.where(pd.notnull(df), None)
                records = df.to_dict(orient='records')
                output_data[table_name] = records
                print(f"已读取表: {table_name}，包含 {len(records)} 行数据")
            except Exception as e:
                print(f"处理表 {table_name} 时出错: {e}")
                print(f"跳过表 {table_name}")
                continue

        # 选择输出路径
        if json_file is None:
            json_file = db_path.with_suffix('.json')
        else:
            json_file = Path(json_file).resolve()

        try:
            with open(json_file, 'w', encoding='utf-8') as f:
                if single_table_mode:
                    # 写入单表的列表数据
                    table = tables[0]
                    if pretty:
                        json.dump(output_data.get(table, []), f, ensure_ascii=False, indent=indent, default=str)
                    else:
                        json.dump(output_data.get(table, []), f, ensure_ascii=False, separators=(',', ':'), default=str)
                else:
                    if pretty:
                        json.dump(output_data, f, ensure_ascii=False, indent=indent, default=str)
                    else:
                        json.dump(output_data, f, ensure_ascii=False, separators=(',', ':'), default=str)

            print(f"转换完成！已将数据库 {db_path} 导出为JSON文件 {json_file}")
        except Exception as e:
            print(f"写入JSON文件 {json_file} 时出错: {e}")
            json_file = None

        conn.close()
        return json_file

    def convert_json_to_sqlite(self, json_file, db_file, if_exists='replace', table_name=None):
        """
        将JSON文件导入到SQLite数据库。

        支持两种JSON格式：
          - 根对象为字典：{ "table1": [rows], "table2": [rows], ... }
          - 根对象为列表：[rows]，将导入到指定或根据文件名生成的单表中

        参数:
            json_file: JSON文件路径
            db_file: 输出或目标SQLite数据库路径
            if_exists: 表存在时的处理方式（目前在写入时使用replace逻辑）

        返回:
            目标数据库路径（Path对象）或None
        """
        json_path = Path(json_file).resolve()
        db_path = Path(db_file).resolve()

        print(f"正在读取JSON文件: {json_path}")
        try:
            with open(json_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
        except Exception as e:
            print(f"读取JSON文件失败: {e}")
            return None

        # 打开数据库连接
        conn = sqlite3.connect(db_path)

        try:
            # 根为字典 => 多表
            if isinstance(data, dict):
                for table_name, rows in data.items():
                    try:
                        if not isinstance(rows, list):
                            print(f"表 {table_name} 的数据不是列表，跳过")
                            continue

                        df = pd.DataFrame(rows)
                        # 规范化列名
                        if not df.empty:
                            df.columns = [self.normalize_column_name(col) for col in df.columns]
                        self._write_dataframe_to_sqlite(df, table_name, conn)
                    except Exception as e:
                        print(f"导入表 {table_name} 时出错: {e}")
                        continue

            # 根为列表 => 单表
            elif isinstance(data, list):
                if table_name:
                    use_table_name = table_name
                else:
                    use_table_name = json_path.stem

                df = pd.DataFrame(data)
                if not df.empty:
                    df.columns = [self.normalize_column_name(col) for col in df.columns]
                self._write_dataframe_to_sqlite(df, use_table_name, conn)
            else:
                print("不支持的JSON根类型（仅支持对象或数组）")
                conn.close()
                return None

            conn.commit()
            print(f"导入完成！JSON文件 {json_path} 已导入到数据库 {db_path}")
        except Exception as e:
            print(f"导入过程中发生错误: {e}")
            conn.rollback()
            db_path = None
        finally:
            conn.close()

        return db_path

    def convert_sqlite_to_yaml(self, db_file, yml_file=None, tables=None, pretty=False, indent=4):
        """
        将SQLite数据库转换为YAML文件（使用PyYAML）。

        参数与 convert_sqlite_to_json 类似。
        """
        if yaml is None:
            raise RuntimeError("PyYAML 未安装。请通过 pip install pyyaml 安装此依赖以启用 YML 功能。")

        db_path = Path(db_file).resolve()
        print(f"正在读取数据库: {db_path}")
        conn = sqlite3.connect(db_path)

        cursor = conn.cursor()
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        all_tables = [row[0] for row in cursor.fetchall()]

        if not all_tables:
            print(f"数据库 {db_path} 中没有找到表")
            conn.close()
            return None

        if tables is None:
            tables = all_tables
        else:
            invalid_tables = [table for table in tables if table not in all_tables]
            if invalid_tables:
                print(f"警告: 以下表在数据库中不存在并将被跳过: {', '.join(invalid_tables)}")
            tables = [table for table in tables if table in all_tables]

        if not tables:
            print("没有找到有效的表用于转换")
            conn.close()
            return None

        output_data = {}
        single_table_mode = len(tables) == 1

        for table_name in tables:
            try:
                df = pd.read_sql_query(f"SELECT * FROM {table_name}", conn)
                df = df.where(pd.notnull(df), None)
                records = df.to_dict(orient='records')
                output_data[table_name] = records
                print(f"已读取表: {table_name}，包含 {len(records)} 行数据")
            except Exception as e:
                print(f"处理表 {table_name} 时出错: {e}")
                print(f"跳过表 {table_name}")
                continue

        if yml_file is None:
            yml_file = db_path.with_suffix('.yml')
        else:
            yml_file = Path(yml_file).resolve()

        try:
            with open(yml_file, 'w', encoding='utf-8') as f:
                if single_table_mode:
                    table = tables[0]
                    if pretty:
                        yaml.safe_dump(output_data.get(table, []), f, allow_unicode=True, sort_keys=False)
                    else:
                        yaml.safe_dump(output_data.get(table, []), f, allow_unicode=True, default_flow_style=True, sort_keys=False)
                else:
                    if pretty:
                        yaml.safe_dump(output_data, f, allow_unicode=True, sort_keys=False)
                    else:
                        yaml.safe_dump(output_data, f, allow_unicode=True, default_flow_style=True, sort_keys=False)

            print(f"转换完成！已将数据库 {db_path} 导出为YML文件 {yml_file}")
        except Exception as e:
            print(f"写入YML文件 {yml_file} 时出错: {e}")
            yml_file = None

        conn.close()
        return yml_file

    def convert_yaml_to_sqlite(self, yml_file, db_file, if_exists='replace', table_name=None):
        """
        将YAML文件导入到SQLite数据库。

        支持与 JSON 相同的两种根结构：mapping{table: [rows]} 或 sequence [rows]
        """
        if yaml is None:
            raise RuntimeError("PyYAML 未安装。请通过 pip install pyyaml 安装此依赖以启用 YML 功能。")

        yml_path = Path(yml_file).resolve()
        db_path = Path(db_file).resolve()

        print(f"正在读取YML文件: {yml_path}")
        try:
            with open(yml_path, 'r', encoding='utf-8') as f:
                data = yaml.safe_load(f)
        except Exception as e:
            print(f"读取YML文件失败: {e}")
            return None

        conn = sqlite3.connect(db_path)

        try:
            if isinstance(data, dict):
                for tbl, rows in data.items():
                    try:
                        if not isinstance(rows, list):
                            print(f"表 {tbl} 的数据不是列表，跳过")
                            continue
                        df = pd.DataFrame(rows)
                        if not df.empty:
                            df.columns = [self.normalize_column_name(col) for col in df.columns]
                        self._write_dataframe_to_sqlite(df, tbl, conn)
                    except Exception as e:
                        print(f"导入表 {tbl} 时出错: {e}")
                        continue
            elif isinstance(data, list):
                use_table_name = table_name if table_name else yml_path.stem
                df = pd.DataFrame(data)
                if not df.empty:
                    df.columns = [self.normalize_column_name(col) for col in df.columns]
                self._write_dataframe_to_sqlite(df, use_table_name, conn)
            else:
                print("不支持的YML根类型（仅支持映射或序列）")
                conn.close()
                return None

            conn.commit()
            print(f"导入完成！YML文件 {yml_path} 已导入到数据库 {db_path}")
        except Exception as e:
            print(f"导入过程中发生错误: {e}")
            conn.rollback()
            db_path = None
        finally:
            conn.close()

        return db_path
    
    def list_sqlite_tables(self, db_file):
        """
        列出SQLite数据库中的所有表
        
        参数:
            db_file: SQLite数据库文件路径
            
        返回:
            表名列表
        """
        # 获取数据库文件的绝对路径
        db_path = Path(db_file).resolve()
        
        # 创建SQLite连接
        conn = sqlite3.connect(db_path)
        
        # 获取所有表名
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        tables = [row[0] for row in cursor.fetchall()]
        
        # 关闭连接
        conn.close()
        
        return tables


def main():
    """主函数，处理命令行参数并执行转换"""

    # 创建命令行参数解析器
    parser = create_argument_parser()
    args = parser.parse_args()
    
    # 创建转换器实例
    converter = ExcelToSQLite()
    
    try:
        # 根据命令参数执行相应操作
        if args.list_tables:
            list_db_tables(converter, args.list_tables)
        elif args.db2json:
            sqlite_to_json(converter, args)
        elif args.json2db:
            json_to_sqlite(converter, args)
        elif args.db2yml:
            sqlite_to_yaml(converter, args)
        elif args.yml2db:
            yaml_to_sqlite(converter, args)
        elif args.db2xlsx:
            sqlite_to_excel(converter, args)
        else:  # 默认为Excel转SQLite模式
            excel_to_sqlite(converter, args)
    except Exception as e:
        print(f"执行过程中发生错误: {e}")
        return 1
    
    return 0


def create_argument_parser():
    """创建命令行参数解析器"""
    parser = argparse.ArgumentParser(description='Excel与SQLite数据库间相互转换工具')
    
    # 转换模式
    parser.add_argument('--xlsx2db', action='store_true', help='Excel转SQLite模式')
    parser.add_argument('--db2xlsx', action='store_true', help='SQLite转Excel模式')
    parser.add_argument('--db2json', action='store_true', help='SQLite转JSON模式')
    parser.add_argument('--json2db', action='store_true', help='JSON转SQLite模式')
    parser.add_argument('--db2yml', action='store_true', help='SQLite转YML模式')
    parser.add_argument('--yml2db', action='store_true', help='YML转SQLite模式')
    
    # 文件和目录参数
    parser.add_argument('--file', '-f', help='单个文件路径（Excel或SQLite）')
    parser.add_argument('--dir', '-d', help='包含多个Excel文件的目录路径')
    parser.add_argument('--output', '-o', help='输出文件名')
    
    # 其他选项
    parser.add_argument('--merge', '-m', action='store_true', help='将目录中的所有Excel文件合并到一个数据库')
    parser.add_argument('--tables', '-t', nargs='+', help='指定要转换的表（适用于SQLite转Excel）')
    parser.add_argument('--list-tables', '-l', help='列出SQLite数据库中的所有表')
    parser.add_argument('--separate', '-s', action='store_true', help='将每个表保存为独立的Excel文件（适用于SQLite转Excel）')
    parser.add_argument('--json-table', '-j', help='JSON->SQLite 时指定单表的表名（当JSON根为数组时有效）')
    parser.add_argument('--pretty', action='store_true', help='JSON输出为可读的缩进格式（适用于SQLite->JSON）')
    parser.add_argument('--yml-table', help='YML->SQLite 时指定单表的表名（当YML根为数组时有效）')
    
    return parser


def list_db_tables(converter, db_file):
    """列出数据库中的所有表"""
    tables = converter.list_sqlite_tables(db_file)
    if tables:
        print(f"数据库 {db_file} 中的表:")
        for table in tables:
            print(f"  - {table}")
    else:
        print(f"数据库 {db_file} 中没有找到表")


def sqlite_to_excel(converter, args):
    """执行SQLite转Excel的转换"""
    if not args.file:
        print("错误：请指定SQLite数据库文件路径")
        return
    
    result_files = converter.convert_sqlite_to_excel(
        args.file, 
        args.output, 
        args.tables, 
        args.separate
    )
    
    if result_files:
        # 输出转换结果摘要
        if len(result_files) == 1:
            print(f"转换成功！生成了1个Excel文件: {result_files[0]}")
        else:
            print(f"转换成功！生成了{len(result_files)}个Excel文件")


def sqlite_to_json(converter, args):
    """执行SQLite转JSON的转换"""
    if not args.file:
        print("错误：请指定SQLite数据库文件路径")
        return

    json_file = args.output
    result = converter.convert_sqlite_to_json(
        args.file,
        json_file,
        args.tables,
        pretty=bool(getattr(args, 'pretty', False)),
    )

    if result:
        print(f"转换成功！生成了JSON文件: {result}")


def sqlite_to_yaml(converter, args):
    """执行SQLite转YML的转换"""
    if yaml is None:
        print("错误：PyYAML 未安装。请运行: pip install pyyaml")
        return

    if not args.file:
        print("错误：请指定SQLite数据库文件路径")
        return

    yml_file = args.output
    result = converter.convert_sqlite_to_yaml(
        args.file,
        yml_file,
        args.tables,
        pretty=bool(getattr(args, 'pretty', False)),
    )

    if result:
        print(f"转换成功！生成了YML文件: {result}")


def yaml_to_sqlite(converter, args):
    """执行YML转SQLite的转换"""
    if yaml is None:
        print("错误：PyYAML 未安装。请运行: pip install pyyaml")
        return

    if not args.file:
        print("错误：请指定YML文件路径")
        return

    # 如果未指定输出数据库，则使用YML文件同名的 .db
    if args.output:
        db_file = args.output
    else:
        db_file = Path(args.file).resolve().with_suffix('.db')

    result = converter.convert_yaml_to_sqlite(args.file, db_file, table_name=getattr(args, 'yml_table', None))
    if result:
        print(f"转换成功！YML已导入到数据库: {result}")


def json_to_sqlite(converter, args):
    """执行JSON转SQLite的转换"""
    if not args.file:
        print("错误：请指定JSON文件路径")
        return

    # 如果未指定输出数据库，则使用JSON文件同名的 .db
    if args.output:
        db_file = args.output
    else:
        db_file = Path(args.file).resolve().with_suffix('.db')

    result = converter.convert_json_to_sqlite(args.file, db_file, table_name=getattr(args, 'json_table', None))
    if result:
        print(f"转换成功！JSON已导入到数据库: {result}")


def excel_to_sqlite(converter, args):
    """执行Excel转SQLite的转换"""
    if args.file:
        # 转换单个文件
        db_file = converter.convert_file(args.file, args.output)
        if db_file:
            print(f"转换成功！生成了数据库文件: {db_file}")
    elif args.dir or args.merge:
        # 转换目录中的所有文件到一个数据库
        dir_path = args.dir or '.'
        db_file = converter.convert_directory(dir_path, args.output)
        if db_file:
            print(f"转换成功！目录中的Excel文件已合并到数据库: {db_file}")
    else:
        # 默认转换当前目录中的所有文件
        current_dir = Path.cwd()
        print(f"未指定文件或目录，将转换当前目录 ({current_dir}) 中的所有Excel文件")
        db_file = converter.convert_directory(current_dir, args.output)
        if db_file:
            print(f"转换成功！目录中的Excel文件已合并到数据库: {db_file}")


if __name__ == "__main__":
    sys.exit(main())
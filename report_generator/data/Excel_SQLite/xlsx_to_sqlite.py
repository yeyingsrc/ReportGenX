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
    
    # 文件和目录参数
    parser.add_argument('--file', '-f', help='单个文件路径（Excel或SQLite）')
    parser.add_argument('--dir', '-d', help='包含多个Excel文件的目录路径')
    parser.add_argument('--output', '-o', help='输出文件名')
    
    # 其他选项
    parser.add_argument('--merge', '-m', action='store_true', help='将目录中的所有Excel文件合并到一个数据库')
    parser.add_argument('--tables', '-t', nargs='+', help='指定要转换的表（适用于SQLite转Excel）')
    parser.add_argument('--list-tables', '-l', help='列出SQLite数据库中的所有表')
    parser.add_argument('--separate', '-s', action='store_true', help='将每个表保存为独立的Excel文件（适用于SQLite转Excel）')
    
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
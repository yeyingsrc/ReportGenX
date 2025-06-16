# -*- coding: utf-8 -*-
"""
@Createtime: 2024-08-05 10:15
@Updatetime: 2025-06-11 15:00
@description: 导出报告及日志
"""

import os
import sqlite3

class ReportGenerator:
    def __init__(self, doc, output_file, supplierName):
        self.doc = doc
        self.output_file = output_file
        self.supplierName = supplierName

    def save_document(self, report_file_path_notime):
        if not os.path.exists(report_file_path_notime):
            # 文件不存在，直接保存文档
            self.doc.save(report_file_path_notime)
            return report_file_path_notime
        else:
            # 文件已存在
            count = 1
            while os.path.exists(f'{report_file_path_notime[:-5]}-{count}.docx'):
                # 根据规则生成新的文件名，继续检查是否存在
                count += 1
            new_file_path = f'{report_file_path_notime[:-5]}-{count}.docx'
            self.doc.save(new_file_path)
            return new_file_path

    def create_and_insert_report(self, db_path, replacements, table_name="report"):
        columns = [k.replace('#', '') for k in replacements.keys()]
        columns_def = ', '.join(['"{}" TEXT'.format(col) for col in columns])
        create_table_sql = f'CREATE TABLE IF NOT EXISTS {table_name} ({columns_def});'
        columns_sql = ', '.join(['"{}"'.format(col) for col in columns])
        placeholders = ', '.join(['?' for _ in columns])
        insert_sql = f'INSERT INTO {table_name} ({columns_sql}) VALUES ({placeholders});'
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute(create_table_sql)
        values = list(replacements.values())
        cursor.execute(insert_sql, values)
        conn.commit()
        conn.close()

    def log_save(self, replacements):

        # 创建日志目录
        if not os.path.exists(self.output_file):
            os.makedirs(self.output_file)

        # 创建客户公司目录
        customerCompanyName_dir = f'{self.output_file}{replacements["#customerCompanyName#"]}'
        if not os.path.exists(customerCompanyName_dir):
            os.makedirs(customerCompanyName_dir)

        # 构建报告文件路径
        report_file_path_notime = f'{customerCompanyName_dir}/【{replacements["#region#"]}】【{replacements["#hazard_type#"]}】{replacements["#reportName#"]}【{replacements["#hazardLevel#"]}】.docx'      
        # 保存文档
        report_file_path = self.save_document(report_file_path_notime)

        output_file = f'{replacements["#hazard_type#"]}\t{replacements["#customerCompanyName#"]}\t{replacements["#target#"]}\t{replacements["#vulName#"]}\t{self.supplierName}\t{replacements["#hazardLevel#"]}\t{replacements["#reportTime#"]}'
        output_file_path = f'{self.output_file}{replacements["#reportTime#"]}_output.txt'
        output_db_path = f'{self.output_file}{replacements["#reportTime#"]}_output.db'
        with open(output_file_path, 'a+') as f: f.write('\n'+output_file)
        self.create_and_insert_report(output_db_path, replacements)
        return report_file_path
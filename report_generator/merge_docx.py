#!/usr/bin/env python
# -*- coding: utf-8 -*-

'''
Author     : S1g0day
Version    : 0.0.3
Creat time : 2024/6/12 09:29
Update time: 2025/6/12 12:30
Introduce  : 合并Word文档脚本
直接操作docx文件的XML结构，将多个docx文件合并为一个
'''

import os
import sys
import glob
import zipfile
import shutil
from datetime import datetime
from lxml import etree
import re

# 定义输出目录和报告目录
OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'output')
REPORT_DIR = os.path.join(OUTPUT_DIR, 'report')

# 定义合并后的文件名
MERGED_FILENAME = f"合并漏洞报告_{datetime.now().strftime('%Y%m%d_%H%M%S')}.docx"
MERGED_FILE_PATH = os.path.join(REPORT_DIR, MERGED_FILENAME)

# 临时目录
TEMP_DIR = os.path.join(OUTPUT_DIR, 'temp_merge')


def extract_docx(docx_path, target_dir):
    """
    解压docx文件到指定目录
    """
    with zipfile.ZipFile(docx_path, 'r') as zip_ref:
        zip_ref.extractall(target_dir)


def create_docx(source_dir, output_path):
    """
    将目录打包为docx文件
    确保按照正确的顺序和格式创建docx文件
    """
    try:
        with zipfile.ZipFile(output_path, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as zip_ref:
            # 首先添加[Content_Types].xml文件（如果存在）
            content_types_path = os.path.join(source_dir, '[Content_Types].xml')
            if os.path.exists(content_types_path):
                zip_ref.write(content_types_path, '[Content_Types].xml')
            
            # 然后添加_rels目录
            rels_dir = os.path.join(source_dir, '_rels')
            if os.path.exists(rels_dir):
                for root, _, files in os.walk(rels_dir):
                    for file in files:
                        file_path = os.path.join(root, file)
                        arcname = os.path.relpath(file_path, source_dir)
                        zip_ref.write(file_path, arcname)
            
            # 添加其他所有文件和目录
            for root, _, files in os.walk(source_dir):
                for file in files:
                    file_path = os.path.join(root, file)
                    arcname = os.path.relpath(file_path, source_dir)
                    
                    # 跳过已经添加的文件
                    if arcname == '[Content_Types].xml' or arcname.startswith('_rels'):
                        continue
                    
                    zip_ref.write(file_path, arcname)
        
        print(f"成功创建docx文件: {output_path}")
        return True
        
    except Exception as e:
        print(f"创建docx文件时出错: {e}")
        return False


def merge_docx_files(docx_files, output_path):
    """
    合并多个docx文件
    直接操作XML结构
    """
    if not docx_files:
        print("没有找到要合并的文档！")
        return False

    # 验证输入文件
    valid_files = []
    for docx_file in docx_files:
        if os.path.exists(docx_file) and docx_file.lower().endswith('.docx'):
            try:
                # 尝试打开文件验证其有效性
                with zipfile.ZipFile(docx_file, 'r') as test_zip:
                    if 'word/document.xml' in test_zip.namelist():
                        valid_files.append(docx_file)
                        print(f"验证文件有效: {os.path.basename(docx_file)}")
                    else:
                        print(f"警告: 文件 {os.path.basename(docx_file)} 不是有效的Word文档")
            except Exception as e:
                print(f"警告: 无法读取文件 {os.path.basename(docx_file)}: {e}")
        else:
            print(f"警告: 文件不存在或格式不正确: {docx_file}")
    
    if not valid_files:
        print("没有找到有效的Word文档！")
        return False
    
    print(f"找到 {len(valid_files)} 个有效的Word文档")

    # 创建临时目录
    if os.path.exists(TEMP_DIR):
        shutil.rmtree(TEMP_DIR)
    os.makedirs(TEMP_DIR)

    # 解压第一个文档作为基础
    base_doc_dir = os.path.join(TEMP_DIR, 'base_doc')
    os.makedirs(base_doc_dir)
    
    print(f"正在解压基础文档: {os.path.basename(valid_files[0])}")
    extract_docx(valid_files[0], base_doc_dir)
    
    # 解析基础文档的document.xml
    document_xml_path = os.path.join(base_doc_dir, 'word', 'document.xml')
    if not os.path.exists(document_xml_path):
        print(f"错误: 基础文档中没有找到document.xml文件")
        return False
        
    try:
        tree = etree.parse(document_xml_path)
        root = tree.getroot()
        print(f"成功解析基础文档的XML结构")
    except Exception as e:
        print(f"错误: 无法解析基础文档的XML: {e}")
        return False

    # 查找文档主体
    nsmap = {k: v for k, v in root.nsmap.items() if k}
    # 安全地获取默认命名空间
    if None in root.nsmap:
        nsmap['w'] = root.nsmap[None]  # 默认命名空间
    else:
        # 如果没有默认命名空间，尝试使用常见的Word命名空间
        nsmap['w'] = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
    body = root.xpath('//w:body', namespaces=nsmap)[0]

    # 获取最后一个段落的索引（通常是节属性）
    last_elements = body.xpath('./w:sectPr', namespaces=nsmap)
    sect_pr = None
    if last_elements:
        sect_pr = last_elements[0]
        body.remove(sect_pr)  # 暂时移除节属性

    # 处理其他文档
    print(f"\n开始合并其他 {len(valid_files)-1} 个文档...")
    for i, docx_file in enumerate(valid_files[1:], 2):  # 从第二个文档开始
        print(f"\n正在处理第 {i} 个文档: {os.path.basename(docx_file)}")
        
        # 解压当前文档
        temp_doc_dir = os.path.join(TEMP_DIR, f'temp_doc_{i}')
        os.makedirs(temp_doc_dir)
        
        try:
            extract_docx(docx_file, temp_doc_dir)
        except Exception as e:
            print(f"警告: 无法解压文档 {os.path.basename(docx_file)}: {e}")
            shutil.rmtree(temp_doc_dir)
            continue  # 跳过此文档，继续处理下一个
        
        # 读取当前文档的document.xml
        curr_doc_xml = os.path.join(temp_doc_dir, 'word', 'document.xml')
        if not os.path.exists(curr_doc_xml):
            print(f"警告: 文档 {os.path.basename(docx_file)} 中没有找到document.xml")
            shutil.rmtree(temp_doc_dir)
            continue  # 跳过此文档，继续处理下一个
            
        try:
            curr_tree = etree.parse(curr_doc_xml)
            curr_root = curr_tree.getroot()
        except Exception as e:
            print(f"警告: 无法解析文档 {os.path.basename(docx_file)} 的XML: {e}")
            shutil.rmtree(temp_doc_dir)
            continue  # 跳过此文档，继续处理下一个
        
        # 获取当前文档的主体内容
        # 为当前文档创建命名空间映射
        curr_nsmap = {k: v for k, v in curr_root.nsmap.items() if k}
        if None in curr_root.nsmap:
            curr_nsmap['w'] = curr_root.nsmap[None]
        else:
            curr_nsmap['w'] = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
        
        try:
            curr_body = curr_root.xpath('//w:body', namespaces=curr_nsmap)[0]
        except Exception as e:
            print(f"警告: 无法找到文档 {os.path.basename(docx_file)} 的主体内容: {e}")
            continue  # 跳过此文档，继续处理下一个
        
        # 复制所有段落（除了节属性）
        try:
            # 添加分页符（在合并前插入）
            # 创建一个包含分页符的新段落，使用正确的命名空间
            w_ns = curr_nsmap.get('w', 'http://schemas.openxmlformats.org/wordprocessingml/2006/main')
            
            page_break_p = etree.Element(f'{{{w_ns}}}p')
            page_break_r = etree.SubElement(page_break_p, f'{{{w_ns}}}r')
            page_break_br = etree.SubElement(page_break_r, f'{{{w_ns}}}br')
            page_break_br.set('type', 'page')  # 使用简单的属性名，不需要命名空间前缀
            
            # 将分页符段落添加到文档主体
            body.append(page_break_p)
            print(f"已为文档 {os.path.basename(docx_file)} 添加分页符")
            
            # 复制文档内容
            for element in curr_body.xpath('./*[not(self::w:sectPr)]', namespaces=curr_nsmap):
                # 深度复制元素以避免命名空间冲突
                copied_element = etree.fromstring(etree.tostring(element))
                body.append(copied_element)
        except Exception as e:
            print(f"警告: 复制段落或添加分页符时出错: {e}")
            # 继续处理，不中断合并过程
        
        # 处理媒体文件（图片等）
        media_dir = os.path.join(temp_doc_dir, 'word', 'media')
        if os.path.exists(media_dir):
            base_media_dir = os.path.join(base_doc_dir, 'word', 'media')
            if not os.path.exists(base_media_dir):
                os.makedirs(base_media_dir)
            
            # 复制媒体文件
            for media_file in os.listdir(media_dir):
                src_path = os.path.join(media_dir, media_file)
                # 生成唯一文件名避免冲突
                file_name, file_ext = os.path.splitext(media_file)
                new_file_name = f"{file_name}_{i}{file_ext}"
                dst_path = os.path.join(base_media_dir, new_file_name)
                shutil.copy2(src_path, dst_path)
                
                # 更新XML中的引用
                # 确保命名空间存在
                if 'a' not in nsmap:
                    nsmap['a'] = "http://schemas.openxmlformats.org/drawingml/2006/main"
                if 'r' not in nsmap:
                    nsmap['r'] = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
                
                try:
                    for element in body.xpath(f'//a:blip[@r:embed="{media_file}"]', namespaces=nsmap):
                        element.attrib['{{{0}}}embed'.format(nsmap['r'])] = new_file_name
                except Exception as e:
                    print(f"警告: 更新媒体引用时出错: {e}")
                    # 继续处理，不中断合并过程
        
        # 处理关系文件
        rels_dir = os.path.join(temp_doc_dir, 'word', '_rels')
        if os.path.exists(rels_dir):
            base_rels_dir = os.path.join(base_doc_dir, 'word', '_rels')
            if not os.path.exists(base_rels_dir):
                os.makedirs(base_rels_dir)
            
            # 合并关系文件
            document_rels_path = os.path.join(rels_dir, 'document.xml.rels')
            if os.path.exists(document_rels_path):
                curr_rels_tree = etree.parse(document_rels_path)
                curr_rels_root = curr_rels_tree.getroot()
                
                base_rels_path = os.path.join(base_rels_dir, 'document.xml.rels')
                if os.path.exists(base_rels_path):
                    base_rels_tree = etree.parse(base_rels_path)
                    base_rels_root = base_rels_tree.getroot()
                    
                    # 获取当前最大ID
                    rel_ids = [rel.attrib['Id'] for rel in base_rels_root]
                    max_id = 0
                    for rel_id in rel_ids:
                        if rel_id.startswith('rId'):
                            try:
                                id_num = int(rel_id[3:])
                                max_id = max(max_id, id_num)
                            except ValueError:
                                pass
                    
                    # 添加新关系，避免ID冲突
                    for rel in curr_rels_root:
                        rel_id = rel.attrib['Id']
                        if rel_id.startswith('rId'):
                            max_id += 1
                            new_rel_id = f"rId{max_id}"
                            rel.attrib['Id'] = new_rel_id
                        base_rels_root.append(rel)
                    
                    # 保存更新后的关系文件
                    base_rels_tree.write(base_rels_path, encoding='UTF-8', xml_declaration=True)
        
        # 清理临时目录
        shutil.rmtree(temp_doc_dir)
    
    # 恢复节属性
    if sect_pr is not None:
        body.append(sect_pr)
    
    # 保存合并后的document.xml
    try:
        # 确保XML格式正确
        etree.cleanup_namespaces(tree)
        
        # 使用更安全的方式保存XML
        xml_str = etree.tostring(tree, encoding='UTF-8', xml_declaration=True, pretty_print=True)
        
        # 写入文件
        with open(document_xml_path, 'wb') as f:
            f.write(xml_str)
        
        print(f"成功保存document.xml: {document_xml_path}")
        
        # 验证XML文件是否可以正确解析
        try:
            etree.parse(document_xml_path)
            print("XML文件验证通过")
        except etree.XMLSyntaxError as e:
            print(f"XML文件验证失败: {e}")
            return False
            
    except Exception as e:
        print(f"保存document.xml时出错: {e}")
        return False
    
    # 创建最终的docx文件
    if not create_docx(base_doc_dir, output_path):
        print("创建docx文件失败")
        return False
    
    # 清理临时文件
    shutil.rmtree(TEMP_DIR)
    
    print(f"\n合并完成！输出文件: {output_path}")
    return True


def main():
    # 获取所有docx文件
    docx_pattern = os.path.join(REPORT_DIR, '*.docx')
    docx_files = glob.glob(docx_pattern)
    
    # 按文件名排序
    docx_files.sort()
    
    if not docx_files:
        print(f"在 {REPORT_DIR} 目录下没有找到docx文件！")
        return
    
    print(f"找到 {len(docx_files)} 个docx文件:")
    for i, file in enumerate(docx_files, 1):
        print(f"{i}. {os.path.basename(file)}")
    
    print(f"\n开始合并文档...")
    merge_docx_files(docx_files, MERGED_FILE_PATH)


if __name__ == "__main__":
    main()
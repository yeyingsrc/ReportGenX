#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
@Createtime: 2025-07-01 10:00
@Updatetime: 2025-07-01 10:00
@description: 文档合并处理模块
"""

import os
import shutil
import zipfile
from lxml import etree
from datetime import datetime


class DocumentMerger:
    """文档合并处理类"""
    
    def __init__(self):
        """初始化文档合并器"""
        self.temp_dir = None
        
    def merge_docx_files(self, docx_files, output_path):
        """
        合并多个docx文件
        
        Args:
            docx_files (list): 要合并的docx文件路径列表
            output_path (str): 输出文件路径
            
        Returns:
            bool: 合并是否成功
        """
        if not docx_files:
            print("错误: 没有提供要合并的文件")
            return False

        if len(docx_files) < 2:
            print("错误: 至少需要两个文件进行合并")
            return False

        # 创建临时目录
        self.temp_dir = os.path.join(os.path.dirname(output_path), 'temp_merge')
        if os.path.exists(self.temp_dir):
            shutil.rmtree(self.temp_dir)
        os.makedirs(self.temp_dir)

        try:
            print(f"开始合并 {len(docx_files)} 个文档...")
            
            # 解压第一个文档作为基础
            base_doc_dir = os.path.join(self.temp_dir, 'base_doc')
            os.makedirs(base_doc_dir)
            self._extract_docx(docx_files[0], base_doc_dir)
            print(f"基础文档: {os.path.basename(docx_files[0])}")

            # 读取document.xml
            document_xml_path = os.path.join(base_doc_dir, 'word', 'document.xml')
            if not os.path.exists(document_xml_path):
                print(f"错误: 基础文档中找不到document.xml")
                return False
                
            tree = etree.parse(document_xml_path)
            root = tree.getroot()

            # 查找文档主体
            nsmap = self._get_namespace_map(root)
            body = self._get_document_body(root, nsmap)
            if body is None:
                print("错误: 无法找到文档主体")
                return False

            # 获取并移除节属性
            sect_pr = self._remove_section_properties(body, nsmap)

            # 处理其他文档
            for i, docx_file in enumerate(docx_files[1:], 1):
                print(f"正在合并文档 {i}/{len(docx_files)-1}: {os.path.basename(docx_file)}")
                
                if not self._merge_single_document(docx_file, base_doc_dir, body, nsmap, i):
                    print(f"警告: 跳过文档 {os.path.basename(docx_file)}")
                    continue
            
            # 恢复节属性
            if sect_pr is not None:
                body.append(sect_pr)
            
            # 保存合并后的document.xml
            tree.write(document_xml_path, encoding='UTF-8', xml_declaration=True)
            
            # 创建最终的docx文件
            self._create_docx(base_doc_dir, output_path)
            
            print(f"合并完成！输出文件: {output_path}")
            return True
            
        except Exception as e:
            print(f"合并文档时出错: {e}")
            return False
        finally:
            # 清理临时文件
            self._cleanup()

    def _extract_docx(self, docx_path, target_dir):
        """解压docx文件到指定目录"""
        try:
            with zipfile.ZipFile(docx_path, 'r') as zip_ref:
                zip_ref.extractall(target_dir)
            return True
        except Exception as e:
            print(f"解压文档失败 {docx_path}: {e}")
            return False

    def _create_docx(self, source_dir, output_path):
        """将目录打包为docx文件"""
        try:
            with zipfile.ZipFile(output_path, 'w', zipfile.ZIP_DEFLATED) as zip_ref:
                for root, _, files in os.walk(source_dir):
                    for file in files:
                        file_path = os.path.join(root, file)
                        arcname = os.path.relpath(file_path, source_dir)
                        zip_ref.write(file_path, arcname)
            return True
        except Exception as e:
            print(f"创建docx文件失败: {e}")
            return False

    def _get_namespace_map(self, root):
        """获取命名空间映射"""
        nsmap = {k: v for k, v in root.nsmap.items() if k}
        
        # 安全地获取默认命名空间
        if None in root.nsmap:
            nsmap['w'] = root.nsmap[None]  # 默认命名空间
        else:
            # 如果没有默认命名空间，尝试使用常见的Word命名空间
            nsmap['w'] = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
        
        # 添加其他可能需要的命名空间
        if 'a' not in nsmap:
            nsmap['a'] = "http://schemas.openxmlformats.org/drawingml/2006/main"
        if 'r' not in nsmap:
            nsmap['r'] = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
            
        return nsmap

    def _get_document_body(self, root, nsmap):
        """获取文档主体"""
        try:
            bodies = root.xpath('//w:body', namespaces=nsmap)
            if bodies:
                return bodies[0]
            return None
        except Exception as e:
            print(f"获取文档主体失败: {e}")
            return None

    def _remove_section_properties(self, body, nsmap):
        """移除并返回节属性"""
        try:
            last_elements = body.xpath('./w:sectPr', namespaces=nsmap)
            if last_elements:
                sect_pr = last_elements[0]
                body.remove(sect_pr)
                return sect_pr
            return None
        except Exception as e:
            print(f"处理节属性失败: {e}")
            return None

    def _merge_single_document(self, docx_file, base_doc_dir, body, nsmap, doc_index):
        """合并单个文档"""
        print(f"正在合并文档 {doc_index}: {os.path.basename(docx_file)}")
        
        try:
            # 为每个文档创建临时目录
            temp_doc_dir = os.path.join(self.temp_dir, f'doc_{doc_index}')
            os.makedirs(temp_doc_dir)
            
            if not self._extract_docx(docx_file, temp_doc_dir):
                return False
            
            # 读取当前文档的document.xml
            curr_doc_xml = os.path.join(temp_doc_dir, 'word', 'document.xml')
            if not os.path.exists(curr_doc_xml):
                print(f"警告: 文档 {os.path.basename(docx_file)} 中找不到document.xml")
                return False
                
            curr_tree = etree.parse(curr_doc_xml)
            curr_root = curr_tree.getroot()
            
            # 获取当前文档的主体内容
            curr_nsmap = self._get_namespace_map(curr_root)
            curr_body = self._get_document_body(curr_root, curr_nsmap)
            
            if curr_body is None:
                print(f"警告: 无法找到文档 {os.path.basename(docx_file)} 的主体内容")
                return False
            
            # 添加分页符（从第二个文档开始）
            self._add_page_break(body, nsmap)
            
            # 先处理媒体文件和关系文件，获取ID映射
            id_mapping = self._merge_media_files(temp_doc_dir, base_doc_dir, body, nsmap, doc_index)
            
            # 更新当前文档内容中的图片引用ID
            self._update_document_media_references(curr_body, curr_nsmap, id_mapping)
            
            # 复制文档内容
            self._copy_document_content(curr_body, body, curr_nsmap)
            
            # 清理临时目录
            shutil.rmtree(temp_doc_dir)
            
            print(f"文档 {os.path.basename(docx_file)} 合并完成")
            return True
            
        except Exception as e:
            print(f"合并文档 {os.path.basename(docx_file)} 时出错: {e}")
            return False

    def _update_document_media_references(self, document_body, nsmap, id_mapping):
        """更新文档内容中的媒体引用ID - 使用正确的ID映射"""
        try:
            if not id_mapping:
                print("没有ID映射，跳过引用更新")
                return
                
            # print(f"开始更新媒体引用，映射表: {id_mapping}")
            
            # 查找所有图片引用并更新
            updated_count = 0
            
            # 1. 更新a:blip元素的r:embed属性
            for blip in document_body.xpath('.//a:blip[@r:embed]', namespaces=nsmap):
                old_embed_id = blip.attrib.get('{{{0}}}embed'.format(nsmap['r']), '')
                if old_embed_id in id_mapping:
                    new_embed_id = id_mapping[old_embed_id]
                    blip.attrib['{{{0}}}embed'.format(nsmap['r'])] = new_embed_id
                    # print(f"更新blip引用: {old_embed_id} -> {new_embed_id}")
                    updated_count += 1
            
            # 2. 更新其他可能的r:embed引用
            for elem in document_body.xpath('.//*[@r:embed]', namespaces=nsmap):
                if elem.tag.endswith('}blip'):  # 跳过已处理的blip元素
                    continue
                old_embed_id = elem.attrib.get('{{{0}}}embed'.format(nsmap['r']), '')
                if old_embed_id in id_mapping:
                    new_embed_id = id_mapping[old_embed_id]
                    elem.attrib['{{{0}}}embed'.format(nsmap['r'])] = new_embed_id
                    # print(f"更新其他媒体引用: {old_embed_id} -> {new_embed_id}")
                    updated_count += 1
            
            # 3. 更新v:imagedata元素的r:id属性（兼容旧版Word格式）
            if 'v' not in nsmap:
                nsmap['v'] = "urn:schemas-microsoft-com:vml"
            
            for imagedata in document_body.xpath('.//v:imagedata[@r:id]', namespaces=nsmap):
                old_id = imagedata.attrib.get('{{{0}}}id'.format(nsmap['r']), '')
                if old_id in id_mapping:
                    new_id = id_mapping[old_id]
                    imagedata.attrib['{{{0}}}id'.format(nsmap['r'])] = new_id
                    # print(f"更新VML图片引用: {old_id} -> {new_id}")
                    updated_count += 1
            
            # print(f"总共更新了 {updated_count} 个媒体引用")
                        
        except Exception as e:
            print(f"更新文档媒体引用失败: {e}")
            import traceback
            traceback.print_exc()

    def _add_page_break(self, body, nsmap):
        """添加分页符"""
        try:
            # 创建分页符段落
            page_break_p = etree.Element('{{{0}}}p'.format(nsmap['w']))
            
            # 创建分页符运行
            page_break_r = etree.SubElement(page_break_p, '{{{0}}}r'.format(nsmap['w']))
            
            # 创建分页符
            page_break_br = etree.SubElement(page_break_r, '{{{0}}}br'.format(nsmap['w']))
            page_break_br.set('{{{0}}}type'.format(nsmap['w']), 'page')
            
            # 将分页符段落添加到文档主体
            body.append(page_break_p)
            print("已添加分页符")
            
        except Exception as e:
            print(f"添加分页符失败: {e}")

    def _copy_document_content(self, source_body, target_body, nsmap):
        """复制文档内容"""
        try:
            # 复制所有段落（除了节属性）
            for element in source_body.xpath('./*[not(self::w:sectPr)]', namespaces=nsmap):
                target_body.append(element)
        except Exception as e:
            print(f"复制文档内容失败: {e}")

    def _merge_media_files(self, temp_doc_dir, base_doc_dir, body, nsmap, doc_index):
        """处理媒体文件合并 - 完全重写版本"""
        try:
            media_dir = os.path.join(temp_doc_dir, 'word', 'media')
            if not os.path.exists(media_dir):
                print(f"文档 {doc_index} 没有媒体文件")
                return
                
            base_media_dir = os.path.join(base_doc_dir, 'word', 'media')
            if not os.path.exists(base_media_dir):
                os.makedirs(base_media_dir)
            
            print(f"处理文档 {doc_index} 的媒体文件...")
            
            # 1. 读取当前文档的关系文件
            temp_rels_path = os.path.join(temp_doc_dir, 'word', '_rels', 'document.xml.rels')
            base_rels_path = os.path.join(base_doc_dir, 'word', '_rels', 'document.xml.rels')
            
            if not os.path.exists(temp_rels_path):
                print(f"文档 {doc_index} 没有关系文件")
                return
            
            # 2. 确保基础关系目录存在
            base_rels_dir = os.path.dirname(base_rels_path)
            if not os.path.exists(base_rels_dir):
                os.makedirs(base_rels_dir)
            
            # 3. 解析关系文件
            temp_rels_tree = etree.parse(temp_rels_path)
            temp_rels_root = temp_rels_tree.getroot()
            
            # 4. 如果基础关系文件不存在，先创建
            if not os.path.exists(base_rels_path):
                self._create_base_relationships_file(base_rels_path)
            
            # 5. 解析基础关系文件
            base_rels_tree = etree.parse(base_rels_path)
            base_rels_root = base_rels_tree.getroot()
            
            # 6. 获取当前最大关系ID
            max_id = self._get_max_relationship_id(base_rels_root)
            
            # 7. 处理每个媒体文件
            id_mapping = {}  # 旧ID -> 新ID的映射
            
            for media_file in os.listdir(media_dir):
                # 复制媒体文件
                src_path = os.path.join(media_dir, media_file)
                file_name, file_ext = os.path.splitext(media_file)
                new_file_name = f"{file_name}_doc{doc_index}{file_ext}"
                dst_path = os.path.join(base_media_dir, new_file_name)
                shutil.copy2(src_path, dst_path)
                
                # 查找对应的关系条目
                for rel in temp_rels_root:
                    target = rel.attrib.get('Target', '')
                    if target == f'media/{media_file}':
                        # 创建新的关系ID
                        old_id = rel.attrib.get('Id', '')
                        max_id += 1
                        new_id = f'rId{max_id}'
                        id_mapping[old_id] = new_id
                        
                        # 创建新的关系条目
                        new_rel = etree.Element(rel.tag, nsmap=rel.nsmap)
                        new_rel.attrib.update(rel.attrib)
                        new_rel.attrib['Id'] = new_id
                        new_rel.attrib['Target'] = f'media/{new_file_name}'
                        
                        base_rels_root.append(new_rel)
                        # print(f"添加媒体关系: {old_id} -> {new_id}, {media_file} -> {new_file_name}")
                        break
            
            # 8. 保存更新后的关系文件
            base_rels_tree.write(base_rels_path, encoding='UTF-8', xml_declaration=True, pretty_print=True)
            
            # 9. 返回ID映射供文档内容更新使用
            return id_mapping
                
        except Exception as e:
            print(f"处理媒体文件失败: {e}")
            import traceback
            traceback.print_exc()
            return {}

    def _cleanup(self):
        """清理临时文件"""
        if self.temp_dir and os.path.exists(self.temp_dir):
            try:
                shutil.rmtree(self.temp_dir)
                print("已清理临时文件")
            except Exception as e:
                print(f"清理临时文件失败: {e}")

    @staticmethod
    def generate_default_filename(prefix="合并漏洞报告"):
        """生成默认的合并文件名"""
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        return f"{prefix}_{timestamp}.docx"

    def validate_files(self, file_paths):
        """验证文件是否有效"""
        valid_files = []
        invalid_files = []
        
        for file_path in file_paths:
            if not os.path.exists(file_path):
                invalid_files.append(f"{file_path} - 文件不存在")
                continue
                
            if not file_path.lower().endswith('.docx'):
                invalid_files.append(f"{file_path} - 不是docx文件")
                continue
                
            try:
                # 尝试打开文件检查是否为有效的zip文件
                with zipfile.ZipFile(file_path, 'r') as zip_ref:
                    # 检查是否包含必要的文件
                    if 'word/document.xml' not in zip_ref.namelist():
                        invalid_files.append(f"{file_path} - 不是有效的docx文件")
                        continue
                        
                valid_files.append(file_path)
                
            except Exception as e:
                invalid_files.append(f"{file_path} - 文件损坏: {str(e)}")
        
        return valid_files, invalid_files

    def _create_base_relationships_file(self, base_rels_path):
        """创建基础关系文件"""
        try:
            relationships_ns = "http://schemas.openxmlformats.org/package/2006/relationships"
            root = etree.Element("{%s}Relationships" % relationships_ns)
            tree = etree.ElementTree(root)
            tree.write(base_rels_path, encoding='UTF-8', xml_declaration=True, pretty_print=True)
            # print(f"创建基础关系文件: {base_rels_path}")
        except Exception as e:
            print(f"创建基础关系文件失败: {e}")

    def _get_max_relationship_id(self, rels_root):
        """获取关系文件中的最大ID数字"""
        max_id = 0
        try:
            for rel in rels_root:
                rel_id = rel.attrib.get('Id', '')
                if rel_id.startswith('rId'):
                    try:
                        id_num = int(rel_id[3:])
                        max_id = max(max_id, id_num)
                    except ValueError:
                        pass
        except Exception as e:
            print(f"获取最大关系ID失败: {e}")
        return max_id

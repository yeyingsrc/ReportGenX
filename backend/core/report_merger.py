# -*- coding: utf-8 -*-
from docx import Document
from docxcompose.composer import Composer
import os

class ReportMerger:
    @staticmethod
    def merge_reports(file_paths, output_path):
        """
        合并多个 Word 文档
        :param file_paths: 文档路径列表
        :param output_path: 输出路径
        :return: (success, message)
        """
        if not file_paths:
            return False, "未提供文件列表"
        
        # 过滤不存在的文件
        valid_paths = [p for p in file_paths if os.path.exists(p)]
        if not valid_paths:
            return False, "提供的文件均不存在"
            
        try:
            # 以第一个文档为模板
            master = Document(valid_paths[0])
            composer = Composer(master)
            
            # 追加后续文档
            for i in range(1, len(valid_paths)):
                master.add_page_break() # 在文档之间添加分页符
                doc_to_append = Document(valid_paths[i])
                composer.append(doc_to_append)
                
            composer.save(output_path)
            return True, "合并成功"
        except Exception as e:
            import traceback
            traceback.print_exc()
            return False, f"合并失败: {str(e)}"

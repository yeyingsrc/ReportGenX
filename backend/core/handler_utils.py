# -*- coding: utf-8 -*-
"""
Table processing utilities for report generation.
"""

from typing import Dict, Any, List, Optional, Callable


class TableProcessor:
    """
    Generic table processing utility.
    
    Consolidates _handle_tester_info_table, _handle_test_targets_table,
    _handle_vuln_list_table patterns into single reusable method.
    
    Eliminates ~2 duplicated methods per handler.
    """
    
    @staticmethod
    def populate_table(
        doc,
        table_header_text: str,
        data_rows: List[Dict[str, Any]],
        row_builder_func: Callable,
        keep_header_rows: int = 1,
        clear_indent: bool = False,
        logger_instance=None
    ) -> bool:
        """
        Generic table population method.
        
        Args:
            doc: Document object
            table_header_text: Text to find table by (searches first cell)
            data_rows: List of data dicts to populate
            row_builder_func: Function(row, data_item) -> None to build each row
            keep_header_rows: Number of header rows to preserve (default 1)
            clear_indent: Auto clear paragraph indent for all cells (default False)
            logger_instance: Logger for debug output
            
        Returns:
            True if table found and populated, False otherwise
        """
        # Find table by header text
        table = None
        for t in doc.tables:
            if t.rows and table_header_text in t.rows[0].cells[0].text:
                table = t
                break
        
        if not table:
            if logger_instance:
                logger_instance.warning(f"Table with header '{table_header_text}' not found")
            return False
        
        # Delete template rows (keep header rows)
        while len(table.rows) > keep_header_rows:
            table._tbl.remove(table.rows[keep_header_rows]._tr)
        
        # Add data rows
        for data_item in data_rows:
            row = table.add_row()
            row_builder_func(row, data_item)
            
            # Auto clear indent if requested
            if clear_indent:
                for cell in row.cells:
                    for para in cell.paragraphs:
                        if para.paragraph_format.first_line_indent:
                            para.paragraph_format.first_line_indent = None
        
        if logger_instance:
            logger_instance.info(f"Populated table '{table_header_text}' with {len(data_rows)} rows")
        
        return True

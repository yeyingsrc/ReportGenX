# -*- coding: utf-8 -*-
"""
@Createtime: 2026-02-13
@description: Enhanced base handler with Template Method pattern consolidation
Eliminates 15+ duplicated methods across handlers using configuration-driven approach
Based on Context7 design patterns documentation
"""

import os
from typing import Dict, Any, List, Optional, Callable
from abc import ABC, abstractmethod

from .handler_config import HandlerConfig
from .logger import setup_logger
from .base_handler import BaseTemplateHandler

logger = setup_logger('BaseHandlerEnhanced')


class BaseTemplateHandlerEnhanced(BaseTemplateHandler):
    """
    Enhanced base handler using Template Method pattern.
    
    Consolidates handler-specific methods (_get_log_fields, _get_log_prefix, 
    _build_db_record, _get_db_table_name) into configuration-driven approach.
    
    Subclasses only need to:
    1. Define HANDLER_TYPE (e.g., 'vuln_report')
    2. Implement preprocess(), generate()
    3. Optionally override _get_handler_config() for custom config
    
    This eliminates ~10 duplicated methods per handler.
    """
    
    # Subclasses must define this
    HANDLER_TYPE: Optional[str] = None
    
    def _get_handler_config(self) -> Dict[str, Any]:
        """
        Get handler configuration. Override in subclass for custom config.
        
        Returns:
            Configuration dict with log_prefix, log_fields, db_table, db_fields
        """
        if not self.HANDLER_TYPE:
            raise NotImplementedError(f"{self.__class__.__name__} must define HANDLER_TYPE")
        
        config = HandlerConfig.get_config(self.HANDLER_TYPE)
        if not config:
            raise ValueError(f"No configuration found for handler type: {self.HANDLER_TYPE}")
        
        return config
    
    def _get_log_prefix(self) -> str:
        """
        Get log file prefix from configuration.
        
        Template Method: Subclasses don't override this anymore.
        """
        config = self._get_handler_config()
        return config.get('log_prefix', '')
    
    def _get_log_fields(self, data: Dict[str, Any], report_date: str) -> List[str]:
        """
        Get TXT log fields from configuration.
        
        Template Method: Subclasses don't override this anymore.
        Extracts field values from data dict using configured field keys.
        """
        config = self._get_handler_config()
        field_keys = config.get('log_fields', [])
        
        # Extract values from data using configured keys
        return [str(data.get(key, '')) for key in field_keys]
    
    def _get_db_table_name(self) -> str:
        """
        Get database table name from configuration.
        
        Template Method: Subclasses don't override this anymore.
        """
        config = self._get_handler_config()
        return config.get('db_table', '')
    
    def _build_db_record(self, data: Dict[str, Any], report_date: str, output_path: str) -> Dict[str, Any]:
        """
        Build database record from configuration.
        
        Template Method: Subclasses don't override this anymore.
        Maps data fields to database columns using configured field mapping.
        """
        config = self._get_handler_config()
        db_fields = config.get('db_fields', {})
        
        # Build record by mapping db_column -> data_key
        record = {}
        for db_column, data_key in db_fields.items():
            record[db_column] = data.get(data_key, '')
        
        return record



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
            logger_instance: Logger for debug output
            
        Returns:
            True if table found and populated, False otherwise
            
        Example:
            def build_row(row, info):
                row.cells[0].text = info.get('name', '')
                row.cells[1].text = info.get('email', '')
            
            TableProcessor.populate_table(
                doc, 
                'Contact Information',
                contacts,
                build_row
            )
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
        
        if logger_instance:
            logger_instance.info(f"Populated table '{table_header_text}' with {len(data_rows)} rows")
        
        return True


class ErrorHandler:
    """
    Centralized error handling for report generation.
    
    Consolidates try/except patterns across all handlers.
    Eliminates ~8+ error handling blocks.
    """
    
    @staticmethod
    def handle_generation_error(func_name: str, error: Exception, logger_instance=None):
        """
        Handle generation errors consistently.
        
        Args:
            func_name: Name of function that failed
            error: Exception that occurred
            logger_instance: Logger instance
            
        Returns:
            Tuple (success=False, path='', message=error_message)
        """
        error_msg = f"{func_name} failed: {str(error)}"
        
        if logger_instance:
            logger_instance.error(error_msg)
            import traceback
            traceback.print_exc()
        
        return False, "", error_msg
    
    @staticmethod
    def wrap_generation(func: Callable, func_name: str, logger_instance=None):
        """
        Decorator-like wrapper for generation methods.
        
        Usage:
            success, path, msg = ErrorHandler.wrap_generation(
                lambda: handler.generate(data, output_dir),
                'generate',
                logger
            )
        """
        try:
            return func()
        except Exception as e:
            return ErrorHandler.handle_generation_error(func_name, e, logger_instance)

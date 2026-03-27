# -*- coding: utf-8 -*-
"""
@Createtime: 2026-02-26
@description: 通用汇总描述生成器
消除 handler 中重复的 _generate_xxx_summary 方法，提供配置驱动的汇总生成
"""

from typing import Dict, Any, List, Tuple, Optional


class SummaryGenerator:
    """
    通用汇总描述生成器
    
    支持两种模式：
    1. 计数汇总：统计各类型数量并生成描述
    2. 数据汇总：按类型汇总数值并生成描述
    
    Usage:
        # 计数汇总
        summary = SummaryGenerator.count_summary(
            items=servers,
            type_key='server_type',
            type_names={'SSH': 'SSH服务实例', 'RDP': 'RDP服务实例'},
            template_zero="未发现可控服务连接信息。",
            template_single="共有{total}个可控主机，其中包括{detail}。",
            template_multi="共有{total}个可控主机，其中包括{detail}。"
        )
        
        # 数据汇总
        summary, total = SummaryGenerator.data_summary(
            items=statistics,
            type_key='data_type',
            count_key='data_count',
            template_zero="未发现敏感数据泄露。",
            template_with_data="共泄露{total:,}条数据，其中{detail}。"
        )
    """
    
    @staticmethod
    def count_summary(
        items: List[Dict[str, Any]],
        type_key: str,
        type_names: Dict[str, str],
        template_zero: str,
        template_single: str,
        template_multi: str,
        connector: str = '、',
        last_connector: str = '以及'
    ) -> str:
        """
        生成计数汇总描述
        
        Args:
            items: 数据列表
            type_key: 类型字段名
            type_names: 类型名称映射 {'SSH': 'SSH服务实例'}
            template_zero: 无数据时的模板
            template_single: 单类型时的模板 (支持 {total}, {detail})
            template_multi: 多类型时的模板 (支持 {total}, {detail})
            connector: 连接符，默认 '、'
            last_connector: 最后一项连接符，默认 '以及'
            
        Returns:
            生成的汇总描述字符串
        """
        if not items:
            return template_zero
        
        # 统计各类型数量
        type_counts = {}
        for item in items:
            t = item.get(type_key, '其他')
            type_counts[t] = type_counts.get(t, 0) + 1
        
        # 生成描述部分
        parts = []
        for t, count in type_counts.items():
            if count > 0:
                name = type_names.get(t, f'{t}实例')
                parts.append(f"{count}个{name}")
        
        # 拼接描述
        if not parts:
            return template_zero
        
        total = len(items)
        
        if len(parts) == 1:
            detail = parts[0]
            return template_single.format(total=total, detail=detail)
        else:
            detail = connector.join(parts[:-1]) + last_connector + parts[-1]
            return template_multi.format(total=total, detail=detail)
    
    @staticmethod
    def data_summary(
        items: List[Dict[str, Any]],
        type_key: str,
        count_key: str,
        template_zero: str,
        template_with_data: str,
        connector: str = '，'
    ) -> Tuple[str, int]:
        """
        生成数据量汇总描述
        
        Args:
            items: 数据列表
            type_key: 类型字段名
            count_key: 数量字段名
            template_zero: 无数据时的模板
            template_with_data: 有数据时的模板 (支持 {total}, {detail})
            connector: 连接符，默认 '，'
            
        Returns:
            Tuple[str, int]: (汇总描述, 总数量)
        """
        if not items:
            return template_zero, 0
        
        # 按类型汇总数量
        type_totals = {}
        grand_total = 0
        
        for item in items:
            data_type = item.get(type_key, '未知类型')
            count_str = item.get(count_key, '0')
            
            # 解析数量（支持带逗号的数字）
            try:
                count = int(str(count_str).replace(',', ''))
            except ValueError:
                count = 0
            
            type_totals[data_type] = type_totals.get(data_type, 0) + count
            grand_total += count
        
        if grand_total == 0:
            return template_zero, 0
        
        # 生成描述部分
        parts = [f"{dtype}共计{total:,}条" for dtype, total in type_totals.items()]
        detail = connector.join(parts)
        
        return template_with_data.format(total=grand_total, detail=detail), grand_total


class SummaryTemplates:
    """
    预定义的汇总模板配置
    
    集中管理各类汇总的模板字符串，便于维护和国际化
    """
    
    # 可控服务器汇总
    CONTROLLED_SERVERS = {
        'type_names': {
            'SSH': 'SSH服务实例',
            'RDP': 'RDP服务实例',
            'FTP': 'FTP服务实例',
            'Telnet': 'Telnet服务实例',
            '其他': '其他服务实例'
        },
        'template_zero': "通过对内网已控服务器进行信息收集和敏感文件分析，未发现可控服务连接信息。",
        'template_single': "通过对内网已控服务器进行信息收集和敏感文件分析，发现了以下服务连接信息：统计结果显示共有{total}个可控主机，其中包括{detail}。",
        'template_multi': "通过对内网已控服务器进行信息收集和敏感文件分析，发现了以下服务连接信息：统计结果显示共有{total}个可控主机，其中包括{detail}。"
    }
    
    # 数据库连接汇总
    DB_CONNECTIONS = {
        'type_names': {
            'MySQL': 'MySQL服务实例',
            'SqlServer': 'SqlServer服务实例',
            'PostgreSQL': 'PostgreSQL服务实例',
            'Oracle': 'Oracle服务实例',
            'Redis': 'Redis服务实例',
            'MongoDB': 'MongoDB服务实例',
            '其他': '其他数据库实例'
        },
        'template_zero': "通过对内网已控服务器的信息收集和敏感文件收集，未发现数据库服务连接信息。",
        'template_single': "通过对内网已控服务器的信息收集和敏感文件收集，发现了以下数据库服务连接信息：统计结果显示共有{total}个数据库服务实例，其中包括{detail}。",
        'template_multi': "通过对内网已控服务器的信息收集和敏感文件收集，发现了以下数据库服务连接信息：统计结果显示共有{total}个数据库服务实例，其中包括{detail}。",
        'last_connector': '和'
    }
    
    # 数据统计汇总
    DATA_STATISTICS = {
        'template_zero': "未发现敏感数据泄露。",
        'template_with_data': "根据统计，共泄露{total:,}条数据，其中{detail}。"
    }

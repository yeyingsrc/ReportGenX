# -*- coding: utf-8 -*-
"""
@Createtime: 2024-08-05 10:15
@Updatetime: 2025-06-16 15:36
@description: 程序主窗体
"""

import re
import os
import socket
import sqlite3
import warnings
import threading
import tldextract
import webbrowser
import pandas as pd
from docx import Document
from datetime import datetime
from urllib.parse import urlparse
from concurrent.futures import ThreadPoolExecutor
from core.document_image_processor import DocumentImageProcessor
from core.report_generator import ReportGenerator
from core.data_reader_db import DbDataReader
from core.document_editor import DocumentEditor
from PyQt6.QtGui import QIcon, QPixmap
from PyQt6.QtCore import QMetaObject, Q_ARG, Qt
from PyQt6.QtWidgets import QApplication, QListView, QWidget, QLabel, QLineEdit, QComboBox, QPushButton, QVBoxLayout, QHBoxLayout, QFormLayout, QMessageBox, QScrollArea, QCheckBox
warnings.filterwarnings("ignore", category=DeprecationWarning)

class MainWindow(QWidget):
    def __init__(self, push_config):
        super().__init__()
        
        # 创建线程池
        self.thread_pool = ThreadPoolExecutor(max_workers=1)
        # 添加定时器用于延迟处理
        self.url_timer = None
        # IP地址的正则表达式
        self.ip_pattern = r'^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$'
        
        # 从 YAML 文件中获取默认值
        self.push_config = push_config

        # 保存所有的漏洞复现描述部分
        self.vuln_sections = []

        # 从配置文件中获取隐患类型列表
        self.hazard_type = self.push_config["hazard_type"]
        
        # 创建DbDataReader实例
        self.db_reader = DbDataReader(self.push_config["vul_or_icp"])
        
        # 从SQLite数据库中读取ICP信息
        self.Icp_infos = self.db_reader.read_Icp_from_db()
 
        # 从SQLite数据库中读取漏洞信息
        self.vulnerability_names, self.vulnerabilities = self.db_reader.read_vulnerabilities_from_db()

        # 设置窗口标题和图标
        self.setWindowTitle(f'风险隐患报告生成器 - {self.push_config["version"]}')
        self.setWindowIcon(QIcon(self.push_config["icon_path"]))

        # 设置窗口大小
        self.setMinimumSize(655, 700)  # 设置最小尺寸而不是固定尺寸
        self.init_ui()  # 初始化UI界面

    def init_ui(self):

        '''设置 GUI 组件的初始化代码'''
        self.labels = ["隐患编号:", "隐患名称:", "隐患URL:", "隐患类型:", "漏洞名称:", "隐患级别:",
                       "预警级别:", "归属城市:", "区域:", "单位类型:", "所属行业:", "单位名称:",
                       "网站名称:", "网站域名:", "网站IP:", "备案号:", "发现时间:",
                       "漏洞描述:", "漏洞危害:", "修复建议:", "证据截图:", "工信备案截图:", 
                       "备注:"]
        

        self.text_edits = [QLineEdit(self) for _ in range(16)]

        # 创建文本框用于隐患编号
        self.vulnerability_id_text_edit = self.text_edits[0]
        # 设置文本框的初始文本为生成的隐患编号
        self.vulnerability_id_text_edit.setText(self.generate_vulnerability_id())

        # 创建隐患类型下拉框
        self.hazard_type_box = QComboBox(self)
        self.hazard_type_box.addItems(self.hazard_type) 
        self.setup_combobox_style(self.hazard_type_box, 150)

        # 设置漏洞等级下拉框的样式和宽度
        self.hazardLevel_box = QComboBox(self)
        self.hazardLevel_box.addItems(['高危', '中危', '低危'])
        self.setup_combobox_style(self.hazardLevel_box, 100)

        # 创建文本框用于预警级别
        self.alert_level_text_edit = self.text_edits[1]
        # self.alert_level_text_edit.setFixedWidth(500)  # 修改宽度与其他输入框一致
        self.alert_level_text_edit.setReadOnly(True)  # 只读
        # 当hazardLevel_box值改变时调用update_alert_level方法
        self.hazardLevel_box.currentIndexChanged.connect(self.update_alert_level)
        # 初始化预警级别
        self.update_alert_level()

        # 创建漏洞名称下拉框
        self.vulName_box = QComboBox(self)
        self.vulName_box.addItems(self.vulnerability_names)
        self.vulName_box.setEditable(True)  # 设置为可编辑
        self.setup_combobox_style(self.vulName_box, 390)  # 减小宽度以适应搜索框
        # 添加漏洞名称的信号连接
        self.vulName_box.currentTextChanged.connect(self.update_hazard_name)

        # 创建搜索框和布局
        self.vuln_search_layout = QHBoxLayout()
        self.vuln_search_box = QLineEdit(self)
        self.vuln_search_box.setPlaceholderText("输入关键字搜索漏洞...")
        self.vuln_search_box.setMinimumWidth(130)
        self.vuln_search_layout.addWidget(self.vulName_box)
        self.vuln_search_layout.addWidget(self.vuln_search_box)
        # 连接搜索功能
        self.vuln_search_box.returnPressed.connect(self.search_vulnerability)

        # 创建单位类型下拉框
        self.unitType_box = QComboBox(self)
        self.unitType_box.addItems(self.push_config["unitType"])
        self.setup_combobox_style(self.unitType_box, 100)

        # 创建所属行业下拉框
        self.industry_box = QComboBox(self)
        self.industry_box.addItems(self.push_config["industry"])
        self.setup_combobox_style(self.industry_box, 100)

        # 创建文本框用于发现时间
        self.discovery_date_edit = self.text_edits[14]
        # 设置文本框的初始文本为当前日期
        self.discovery_date_edit.setText(datetime.now().strftime('%Y.%m.%d'))

        # 创建用于显示工信备案截图的标签和按钮
        self.image_label_asset = QLabel(self)
        self.paste_button_asset = QPushButton('点击读取截图', self)
        self.delete_button_asset = QPushButton('删除图片', self)
        self.paste_button_asset.clicked.connect(self.paste_asset_image)
        self.delete_button_asset.clicked.connect(self.delete_asset_image)

        # 添加按钮用于在界面上添加新的漏洞复现描述和漏洞证明图片的功能
        self.add_vuln_button = QPushButton('添加证明', self)
        self.generate_button = QPushButton('生成报告', self)
        self.reset_button = QPushButton('一键重置', self)
        self.clear_all_button = QPushButton('一键清除', self)
        self.add_vuln_button.clicked.connect(self.add_vulnerability_section)
        self.generate_button.clicked.connect(self.generate_report)
        self.reset_button.clicked.connect(self.reset_all)
        self.clear_all_button.clicked.connect(self.clear_all_sections)

        '''设置 GUI 组件表单布局'''
        self.form_layout = QFormLayout()
        self.setup_formlayout()
        self.setup_main_layout()

    def setup_combobox_style(self, combobox, width):
        '''设置下拉框样式'''
        combobox.setFixedSize(width, 20)
        combobox.setView(QListView())   ##todo 下拉框样式
        combobox.setStyleSheet("QComboBox QAbstractItemView {font-size:14px;}"     # 下拉文字大小
                               "QComboBox QAbstractItemView::item {height:30px;padding-left:10px;}"  # 下拉文字宽高
                               "QScrollBar:vertical {border:2px solid grey;width:20px;}")    # 下拉侧边栏宽高

    def search_vulnerability(self):
        """搜索漏洞名称"""
        search_text = self.vuln_search_box.text().lower()
        if not search_text:
            # 如果搜索框为空，显示所有漏洞
            self.vulName_box.clear()
            self.vulName_box.addItems(self.vulnerability_names)
            return
            
        # 过滤匹配的漏洞名称
        filtered_names = [name for name in self.vulnerability_names if search_text in name.lower()]
        
        # 更新下拉框内容
        self.vulName_box.clear()
        if filtered_names:
            self.vulName_box.addItems(filtered_names)
        else:
            # 如果没有匹配项，显示提示信息
            self.vulName_box.addItem("")

    def handle_custom_vulnerability(self):
        """处理自定义漏洞信息，并更新到数据库"""
        current_text = self.vulName_box.currentText().strip()
        if current_text == "入侵痕迹" or current_text == "页面篡改":
            # 如果当前文本为空，说明用户正在输入新的漏洞名称
            return
        # 获取当前漏洞相关信息
        vuln_info = {
            "漏洞名称": current_text,
            "风险级别": self.hazardLevel_box.currentText(),
            "漏洞描述": self.text_edits[11].text(),
            "加固建议": self.text_edits[13].text()
        }
        # 如果是手动输入的新漏洞名称
        if current_text not in self.vulnerability_names:
            if not self.update_vul_checkbox.isChecked():
                return  # 如果未勾选，则不更新漏洞库
            try:
                conn = sqlite3.connect(self.push_config["vul_or_icp"])
                cursor = conn.cursor()
                
                # 插入新的漏洞信息
                cursor.execute("""
                    INSERT INTO vulnerabilities_Sheet1 (漏洞名称, 风险级别, 漏洞描述, 加固建议)
                    VALUES (?, ?, ?, ?)
                """, (
                    vuln_info["漏洞名称"],
                    vuln_info["风险级别"],
                    vuln_info["漏洞描述"],
                    vuln_info["加固建议"]
                ))
                
                conn.commit()
                conn.close()
                
                # 更新漏洞名称列表和内存中的数据
                self.vulnerability_names.append(current_text)
                self.vulnerabilities[current_text] = vuln_info
                
                # 显示成功消息
                QMessageBox.information(self, "成功", "新漏洞信息已成功保存到数据库")
                
            except Exception as e:
                QMessageBox.warning(self, "错误", f"保存漏洞信息时出错：{str(e)}")
                # print(f"错误详情：{str(e)}")
 
    def setup_formlayout(self):
        """设置表单布局"""
        # 添加用于隐患编号的文本框到布局
        self.form_layout.addRow(QLabel(self.labels[0]), self.vulnerability_id_text_edit)

        # 创建一个水平布局用于放置隐患类型、漏洞等级和预警级别
        hazard_layout = QHBoxLayout()
        # 添加隐患类型下拉框
        # hazard_layout.addWidget(QLabel(self.labels[3]))  # 使用隐患类型标签
        hazard_layout.addWidget(self.hazard_type_box)
        # 添加漏洞等级下拉框到表单布局
        hazard_layout.addWidget(QLabel(self.labels[5]))
        hazard_layout.addWidget(self.hazardLevel_box)
        # 添加自动更新预警级别到表单布局
        hazard_layout.addWidget(QLabel(self.labels[6]))
        hazard_layout.addWidget(self.alert_level_text_edit)
        self.form_layout.addRow(QLabel(self.labels[3]), hazard_layout)

        # 添加漏洞名称下拉框和搜索框
        self.form_layout.addRow(QLabel(self.labels[4]), self.vuln_search_layout)
        
        # 添加隐患URL到表单布局
        # 创建一个水平布局来放置隐患URL输入框和注释
        url_layout = QHBoxLayout()
        url_layout.addWidget(self.text_edits[6])
        # 添加注释标签
        url_note = QLabel("(支持URL或IP地址,建议通过COPY输入)")
        url_note.setStyleSheet("color: gray;")  # 将注释文字设置为灰色
        url_layout.addWidget(url_note)
        # 将整个布局添加到表单中
        self.form_layout.addRow(QLabel(self.labels[2]), url_layout)
       
        # 创建一个水平布局用于放置域名信息
        Website_Name_layout = QHBoxLayout()
        # 添加网站名称到表单布局
        Website_Name_layout.addWidget(self.text_edits[7])
        # 添加网站IP到表单布局
        Website_Name_layout.addWidget(QLabel(self.labels[14]))
        Website_Name_layout.addWidget(self.text_edits[9])
        self.form_layout.addRow(QLabel(self.labels[12]), Website_Name_layout)

        # 创建一个水平布局用于放置域名信息
        domain_layout = QHBoxLayout()
        # 添加网站域名到表单布局
        domain_layout.addWidget(self.text_edits[8])
        # 连接信号到处理函数
        self.text_edits[6].textChanged.connect(self.process_url_or_ip)  # 添加这行
        self.text_edits[6].textChanged.connect(self.update_icp_info)
        # 添加工信备案号到表单布局
        domain_layout.addWidget(QLabel(self.labels[15]))
        domain_layout.addWidget(self.text_edits[10])
        self.form_layout.addRow(QLabel(self.labels[13]), domain_layout)

        # 添加单位名称到表单布局
        self.form_layout.addRow(QLabel(self.labels[11]), self.text_edits[3])

        # 在init_ui方法中，为单位名称、网站名称和隐患类型添加信号，根据其中变化自动调整其他参数数据
        self.text_edits[3].textChanged.connect(self.update_hazard_name)
        self.text_edits[7].textChanged.connect(self.update_hazard_name)
        # 添加隐患类型下拉框的信号连接
        self.hazard_type_box.currentTextChanged.connect(self.update_hazard_name)

        # 创建一个水平布局用于放置公司信息
        unit_layout = QHBoxLayout()
        # 添加归属城市到表单布局
        self.text_edits[4].setText(self.push_config["city"])  # 设置默认值
        unit_layout.addWidget(self.text_edits[4])
        # 添加地区到表单布局
        unit_layout.addWidget(QLabel(self.labels[8]))
        self.text_edits[5].setText(self.push_config["region"])  # 设置默认值
        unit_layout.addWidget(self.text_edits[5])
        # 添加单位类型到表单布局
        unit_layout.addWidget(QLabel(self.labels[9]))
        unit_layout.addWidget(self.unitType_box)
        # 添加所属行业到表单布局
        unit_layout.addWidget(QLabel(self.labels[10]))
        unit_layout.addWidget(self.industry_box)
        self.form_layout.addRow(QLabel(self.labels[7]), unit_layout)

        # 添加隐患名称到表单布局
        self.form_layout.addRow(QLabel(self.labels[1]), self.text_edits[2])

        # 添加发现时间到表单布局
        self.form_layout.addRow(QLabel(self.labels[16]), self.discovery_date_edit)

        # 添加漏洞描述到表单布局
        self.form_layout.addRow(QLabel(self.labels[17]), self.text_edits[11])
        self.text_edits[11].setFixedHeight(60)  # 漏洞描述可能较长，增加文本框高度
        # 添加漏洞危害到表单布局
        self.form_layout.addRow(QLabel(self.labels[18]), self.text_edits[12])
        self.text_edits[12].setFixedHeight(60)  # 漏洞危害可能较长，增加文本框高度
        self.text_edits[12].textChanged.connect(self.update_hazard_name)
        # 添加修复建议到表单布局
        self.form_layout.addRow(QLabel(self.labels[19]), self.text_edits[13])
        self.text_edits[13].setFixedHeight(60)  # 整改建议可能较长，增加文本框高度

        # 添加备注到表单布局
        self.form_layout.addRow(QLabel(self.labels[-1]), self.text_edits[15])
        
        # 是否更新漏洞库
        self.update_vul_checkbox = QCheckBox("漏洞库中无此漏洞时自动更新", self)
        self.update_vul_checkbox.setChecked(True)  # 默认勾选
        self.form_layout.addRow(self.update_vul_checkbox)

        # 创建按钮布局用于放置生成报告
        button_layout = QHBoxLayout()
        button_layout.addWidget(self.generate_button)
        button_layout.addWidget(self.reset_button)  # 一键重置
        self.form_layout.addRow(button_layout)

        # 添加新的漏洞复现描述和图片按钮
        vuln_button_layout = QHBoxLayout()
        vuln_button_layout.addWidget(self.add_vuln_button)
        vuln_button_layout.addWidget(self.clear_all_button)
        self.form_layout.addRow(vuln_button_layout)

        # 添加工信备案截图到表单布局
        asset_layout = QHBoxLayout()
        asset_layout.addWidget(self.image_label_asset)
        asset_layout.addWidget(self.paste_button_asset)
        asset_layout.addWidget(self.delete_button_asset)
        self.form_layout.addRow(QLabel(self.labels[20]), asset_layout)

        # 设置默认值
        self.update_hazard_name()
        self.add_vulnerability_section()

    def setup_main_layout(self):
        '''把表单布局添加到主布局中'''        
        # 创建一个垂直布局，用于管理其他小部件和布局
        v_layout = QVBoxLayout()
        # 创建一个滚动区域，用于容纳可能超出屏幕显示范围的内容
        v_scroll = QScrollArea()
        # 将表单布局添加到垂直布局中
        v_layout.addLayout(self.form_layout)
        # 创建一个QWidget作为滚动区域的子部件
        widget = QWidget()
        # 将垂直布局设置为widget的布局
        widget.setLayout(v_layout)
        # 将widget设置为滚动区域的子部件
        v_scroll.setWidget(widget)
        # 设置滚动区域可以自动调整大小以适应其内容
        v_scroll.setWidgetResizable(True)
        # 设置滚动区域的水平滚动条策略为按需显示
        v_scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAsNeeded)
        # 设置滚动区域的最小宽度，而不是固定宽度
        v_scroll.setMinimumWidth(630)
        # 创建主布局，用于管理整个窗口的内容
        main_layout = QVBoxLayout()
        # 将滚动区域添加到主布局中
        main_layout.addWidget(v_scroll)
        # 将主布局设置为QMainWindow的布局
        self.setLayout(main_layout)
        # 显示窗口
        self.show()

    '''根据系统时间生成隐患编号'''
    def generate_vulnerability_id(self):
        current_time = datetime.now().strftime('%Y-%m-%d-%H%M%S')
        return f"HN-XX-XX-{current_time}"
    
    '''重置所有数据'''
    def reset_all(self):
        self.vulnerability_id_text_edit.setText(self.generate_vulnerability_id())
        self.vulName_box.setCurrentIndex(0)
        self.hazard_type_box.setCurrentIndex(0)
        self.hazardLevel_box.setCurrentIndex(0)
        # self.alert_level_text_edit.clear()    # 等级不需要清除
        self.unitType_box.setCurrentIndex(0)
        self.industry_box.setCurrentIndex(0)
        self.text_edits[2].clear()
        self.text_edits[3].clear()
        # self.text_edits[4].clear()    # 城市不需要清除
        # self.text_edits[5].clear()    # 地区不需要清除
        self.text_edits[6].clear()
        self.text_edits[7].clear()
        self.text_edits[8].clear()
        self.text_edits[9].clear()
        self.text_edits[10].clear()
        self.text_edits[11].clear()
        self.text_edits[12].clear()
        self.text_edits[13].clear()
        self.text_edits[14].setText(datetime.now().strftime('%Y.%m.%d'))
        self.text_edits[15].clear()
        self.delete_asset_image()
        self.clear_all_sections()

    '''仅清除漏洞复现数据'''
    def clear_all_sections(self):
        for section in self.vuln_sections:
            layout, edit, image_label = section
            layout.deleteLater()
            edit.deleteLater()
            image_label.deleteLater()
            self.form_layout.removeRow(layout)
        self.vuln_sections.clear()

        # 设置默认值
        self.vulnerability_id_text_edit.setText(self.generate_vulnerability_id())
        self.update_hazard_name()
        self.add_vulnerability_section()

    def process_url_or_ip(self):
        """处理URL或IP地址输入"""
        # 如果已有定时器在运行，取消它
        if self.url_timer is not None:
            self.url_timer.cancel()
        # 创建新的定时器，延迟500毫秒执行
        self.url_timer = threading.Timer(0.5, self._process_url_or_ip_async)
        self.url_timer.start()

    def _process_url_or_ip_async(self):
        """异步处理URL或IP"""
        try:
            # 获取输入值并去除空格
            input_text = self.text_edits[6].text().strip()
            
            # 如果输入为空，清空相关字段
            if not input_text:
                self.text_edits[7].clear()  # 清空网站名称
                self.text_edits[8].clear()  # 清空网站域名
                self.text_edits[9].clear()  # 清空网站IP
                self.text_edits[10].clear()  # 清空备案号
                return
            
            # 如果输入的是不完整的URL，添加协议头以便解析
            if not input_text.startswith(('http://', 'https://')):
                input_text = 'http://' + input_text

            # 解析URL
            parsed = urlparse(input_text)
            
            # 获取主机名（去除端口）
            hostname = parsed.netloc.split(':')[0]
            
            if re.match(self.ip_pattern, hostname):
                # 如果是IP地址，直接更新
                self._update_ip(hostname)
            else:
                # 如果是域名，在线程池中解析
                self.thread_pool.submit(self._resolve_domain, hostname)

        except Exception as e:
            self._update_ip('')

    def _resolve_domain(self, hostname):
        """在线程池中解析域名"""
        try:
            ip = socket.gethostbyname(hostname)
            self._update_ip(ip)
        except socket.gaierror:
            self._update_ip('')

    def _update_ip(self, ip):
        """更新IP地址到界面"""
        # PyQt6: 使用QMetaObject在主线程中更新UI
        QMetaObject.invokeMethod(self.text_edits[9], "setText", Qt.ConnectionType.QueuedConnection, Q_ARG(str, ip))

    def closeEvent(self, event):
        """窗口关闭时的处理"""
        # 关闭线程池
        if hasattr(self, 'thread_pool'):
            self.thread_pool.shutdown(wait=False)
        # 取消定时器
        if self.url_timer:
            self.url_timer.cancel()
        super().closeEvent(event)

    def update_icp_info_with_domain(self, domain):
        """更新与域名相关的ICP信息"""
        unit_name, service_licence = self.db_reader.get_icp_info(domain)
        if unit_name and service_licence:
            self.text_edits[3].setText(unit_name)  # 设置单位名称
            self.text_edits[10].setText(service_licence)  # 设置备案号
            self.text_edits[8].setText(domain)  # 设置域名
            # self.update_unit_type(domain)
            return domain
        return False

    def open_icp(self):
        '''
        打开工信部备案网站，先弹出确认对话框
        '''
        # 弹出确认对话框
        reply = QMessageBox.question(self, '确认', '是否打开工信部备案网站？',
                                    QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
                                    QMessageBox.StandardButton.No)
        
        # 如果用户点击"是"，则打开网站
        if reply == QMessageBox.StandardButton.Yes:
            # 工信部查询备案
            mi_url = f"https://beian.miit.gov.cn/"
            # 打开URL
            webbrowser.open(mi_url)

    def update_icp_info(self):
        """根据域名自动更新ICP备案信息"""
        try:
            # 获取原始URL（可能包含多级子域名）
            original_url = self.text_edits[6].text().strip().lower()
            if not original_url:
                return

            # 如果输入的是IP地址，则跳过ICP查询
            if re.match(self.ip_pattern, original_url):
                self.text_edits[8].clear()  # 清空网站域名
                self.text_edits[10].clear()  # 清空备案号
                return

            # 提取原始URL中的所有部分
            extracted = tldextract.extract(original_url)

            # 获取根域名
            root_domain = extracted.registered_domain
            # 默认设置域名为根域名
            self.text_edits[8].setText(root_domain)
            self.open_icp()
            # 检查是否有子域名
            if root_domain and extracted.subdomain:
                # 处理多级子域名情况
                subdomains = extracted.subdomain.split('.')
                # 拼接完整的域名
                extracted_domain = f"{extracted.subdomain}.{extracted.domain}.{extracted.suffix}".lower()
                # 尝试使用子域名的不同部分查询ICP备案信息
                parts = extracted_domain.split('.')
                for i in range(len(parts) - 2):
                    partial_subdomain = '.'.join(parts[i:])
                    if self.update_icp_info_with_domain(partial_subdomain):
                        self.update_unit_type(partial_subdomain)
                        return
                
            # 如果所有子域名都没有备案信息，则使用根域名的备案信息
            if root_domain and self.update_icp_info_with_domain(root_domain):
                self.update_unit_type(root_domain)
                return
        except Exception as e:
            QMessageBox.warning(self, "错误", f"更新ICP信息时发生错误: {str(e)}")
            # 发生错误时不影响用户体验，静默处理
            # print(f"更新ICP信息时发生错误: {str(e)}")
    def update_unit_type(self, domain):
        """根据ICP信息中的单位性质更新单位类型"""
        try:
            # 从数据库中获取natureName
            if domain in self.Icp_infos:
                nature_name = self.Icp_infos[domain].get('natureName', '')
                if nature_name:
                    # 获取所有可选的单位类型
                    unit_types = [self.unitType_box.itemText(i) for i in range(self.unitType_box.count())]
                    
                    # 如果是企业，则选择民营企业
                    if nature_name == '企业':
                        target_type = '民营企业'
                    else:
                        # 否则查找完全匹配的类型
                        target_type = next((ut for ut in unit_types if ut == nature_name), None)
                    
                    # 如果找到匹配的类型，则设置下拉框
                    if target_type:
                        index = self.unitType_box.findText(target_type)
                        if index >= 0:
                            self.unitType_box.setCurrentIndex(index)
        except Exception as e:
            QMessageBox.warning(self, "错误", f"更新单位类型时出错：{str(e)}")
            # print(f"更新单位类型时出错：{str(e)}")

    def update_hazard_name(self):
        """根据漏洞名称更新隐患名称、漏洞描述和修复建议"""
        unit_name = self.text_edits[3].text().strip()
        website_name = self.text_edits[7].text().strip()
        Vulnerability_Hazard = self.text_edits[12].text().strip()
        vul_Name = self.vulName_box.currentText()

        '''构建隐患名称'''
        # 判断隐患类型
        selected_hazard_type = self.hazard_type_box.currentText()
        if selected_hazard_type == "漏洞报告":
            hazard_name = f"{unit_name}{website_name}存在{vul_Name}漏洞隐患"
            # 检查并修正重复的"漏洞漏洞隐患"
            if "漏洞漏洞隐患" in hazard_name:
                hazard_name = hazard_name.replace("漏洞漏洞隐患", "漏洞隐患")
        else:
            hazard_name = f"{unit_name}{website_name}存在{selected_hazard_type}安全事件"
            self.vulName_box.setCurrentText(selected_hazard_type)  # 设置漏洞名称
            
        self.text_edits[2].setText(hazard_name)  # 设置隐患名称
		
        '''构建漏洞描述和加固建议'''
        # 根据漏洞名称获取漏洞描述和加固建议
        description, solution = self.db_reader.get_vulnerability_info(vul_Name)
        
        # 检查并打印出哪些变量是 NaN, 也就是列表内存在空值, 如果为NaN将其替换为空字符串
        description = "" if pd.isna(description) else description
        solution = "" if pd.isna(solution) else solution

        # 设置漏洞描述
        if description:
            description_text = f"{description}{Vulnerability_Hazard}" if len(Vulnerability_Hazard) > 0 else description
        else:
            description_text = f"{hazard_name}{Vulnerability_Hazard}" if len(Vulnerability_Hazard) > 0 else hazard_name

        self.text_edits[11].setText(description_text)  # 设置漏洞描述
        self.text_edits[13].setText(solution)  # 设置整改建议

        if selected_hazard_type == "入侵痕迹" or selected_hazard_type == "页面篡改":
            # 因为这两种类型的的漏洞描述无法固定，所以清空漏洞描述和漏洞危害
            self.text_edits[11].clear()
            self.text_edits[13].clear()
            return
    '''更新预警级别'''
    def update_alert_level(self):
        hazard_level = self.hazardLevel_box.currentText()
        alert_level_map = {
            '高危': '3级',
            '中危': '4级',
            '低危': '4级'
        }
        alert_level = alert_level_map.get(hazard_level, '')
        self.alert_level_text_edit.setText(alert_level)

    def add_vulnerability_section(self):
        # 创建一个新的水平布局用于漏洞复现描述和相关操作按钮
        new_vuln_layout = QHBoxLayout()

        # 创建编辑框、标签和按钮
        new_vuln_edit = QLineEdit(self)
        new_vuln_image_label = QLabel(self)
        new_paste_button = QPushButton('点击读取截图', self)
        new_paste_button.clicked.connect(lambda: self.paste_new_vuln_image(new_vuln_image_label))
        new_delete_button = QPushButton('删除图片', self)
        new_delete_button.clicked.connect(lambda: self.delete_new_vuln_image(new_vuln_image_label))
        delete_section_button = QPushButton('删除该段', self)
        delete_section_button.clicked.connect(lambda: self.delete_vulnerability_section(new_vuln_layout, new_vuln_edit, new_vuln_image_label))

        # 将部件添加到新的水平布局中
        new_vuln_layout.addWidget(QLabel("漏洞复现描述:"))
        new_vuln_layout.addWidget(new_vuln_edit)
        new_vuln_layout.addWidget(new_vuln_image_label)
        new_vuln_layout.addWidget(new_paste_button)
        new_vuln_layout.addWidget(new_delete_button)
        new_vuln_layout.addWidget(delete_section_button)
        self.form_layout.addRow(new_vuln_layout)

        # 保存漏洞复现描述和图片路径
        self.vuln_sections.append((new_vuln_layout, new_vuln_edit, new_vuln_image_label))

    def get_screenshot_from_clipboard(self):
        """从剪贴板获取截图"""
        clipboard = QApplication.clipboard()
        mime_data = clipboard.mimeData()
        
        # 检查剪贴板中是否有图片数据
        if mime_data.hasImage():
            # 从剪贴板获取图片
            image = clipboard.image()
            if not image.isNull():
                return image
                
        # 检查剪贴板中是否有文件路径
        elif mime_data.hasUrls():
            for url in mime_data.urls():
                file_path = url.toLocalFile()
                # 检查是否是图片文件
                if file_path.lower().endswith(('.png', '.jpg', '.jpeg', '.bmp', '.gif')):
                    # 从文件加载图片
                    image = QPixmap(file_path)
                    if not image.isNull():
                        return image.toImage()

        # 如果剪贴板中没有图片数据或文件路径，则提示用户
        else:
            QMessageBox.warning(self, '错误', '剪贴板中没有图片数据或文件路径！')
            return None
    
    '''处理备案截图'''
    def paste_asset_image(self):
        """粘贴图像到 QLabel 并保存图像路径"""
        screenshot = self.get_screenshot_from_clipboard()
        if screenshot:
            self.asset_image = screenshot
            # pyqt6: 在 GUI 中显示缩放后的图片
            self.image_label_asset.setPixmap(QPixmap.fromImage(screenshot).scaled(50, 50, Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation))
            # 保存原始大小图片的引用
            self.image_label_asset.original_pixmap = QPixmap.fromImage(screenshot)

    '''处理漏洞复现截图'''
    def paste_new_vuln_image(self, image_label):
        screenshot = self.get_screenshot_from_clipboard()
        if screenshot:
            # pyqt6: 在 GUI 中显示缩放后的图片
            image_label.setPixmap(QPixmap.fromImage(screenshot).scaled(50, 50, Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation))
            # 保存原始大小图片的引用
            image_label.original_pixmap = QPixmap.fromImage(screenshot)
    
    '''删除备案图片'''
    def delete_asset_image(self):
        self.image_label_asset.clear()

    '''删除复现图片'''
    def delete_new_vuln_image(self, image_label):
        image_label.clear()
        
    '''删除该段'''
    def delete_vulnerability_section(self, layout, edit, label):
        for i in reversed(range(layout.count())):
            widget = layout.itemAt(i).widget()
            if widget is not None:
                widget.setParent(None)
        self.form_layout.removeRow(layout)
        self.vuln_sections.remove((layout, edit, label))

    '''生成报告'''
    def generate_report(self):
        # 加载模板文件
        self.doc = Document(self.push_config["template_path"])

        # 创建 DocumentEditor 对象，并进行处理
        self.editor = DocumentEditor(self.doc)
        
        # 创建 ScreenshotHandler 实例并调用相应的函数
        # self.handler = ScreenshotHandler(self.doc, self.vuln_sections)

        # 创建 DocumentImageProcessor 对象，并进行处理
        self.image_processor = DocumentImageProcessor(self.doc, self.vuln_sections)

        # 创建 ReportGenerator 对象，并进行处理
        self.report_generator = ReportGenerator(self.doc, self.push_config["output_filepath"], self.push_config["supplierName"])

        # 创建一个字典，包含所有需要替换的字段
        replacements = {
            '#reportId#': self.text_edits[0].text().strip(),
            '#reportName#': self.text_edits[2].text().strip(),
            '#target#': self.text_edits[6].text().strip(),
            '#vulName#': self.vulName_box.currentText(),
            '#hazard_type#': self.hazard_type_box.currentText(), 
            '#hazardLevel#': self.hazardLevel_box.currentText(),
            '#warningLevel#': self.alert_level_text_edit.text().strip(),
            '#city#': self.text_edits[4].text().strip(),
            '#region#': self.text_edits[5].text().strip(),
            '#unitType#': self.unitType_box.currentText(),
            '#industry#': self.industry_box.currentText(),
            '#customerCompanyName#': self.text_edits[3].text().strip(),
            '#websitename#': self.text_edits[7].text().strip(),
            '#domain#': self.text_edits[8].text().strip(),
            '#ipaddress#': self.text_edits[9].text().strip(),
            '#caseNumber#': self.text_edits[10].text().strip(),
            '#reportTime#': self.discovery_date_edit.text().strip(),
            '#problemDescription#': self.text_edits[11].text().strip(),
            '#vul_modify_repair#': self.text_edits[13].text().strip(),
            '#remark#': self.text_edits[15].text().strip(),
        }
        self.editor.replace_report_text(replacements)

        # 添加工信备案截图
        if hasattr(self, 'asset_image') and self.asset_image:
            asset_path = self.image_processor.save_image_temporarily(self.asset_image)
            self.image_processor.text_with_image("#screenshotoffiling#", asset_path)


        # 处理单个或多个漏洞复现描述和图片
        self.image_processor.process_vuln_sections()

        # 保存日志及文件
        report_file_path = self.report_generator.log_save(replacements)

        # 显示一个消息框通知用户报告已生成
        QMessageBox.information(None, '报告生成', f'报告已生成: {report_file_path}')

        self.handle_custom_vulnerability()
        
        # 自动变更隐患编号
        self.vulnerability_id_text_edit.setText(self.generate_vulnerability_id())
        

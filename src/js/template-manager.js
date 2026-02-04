// template-manager.js - 模板管理模块（工具箱中的模板列表展示和管理）

window.AppTemplateManager = {
    templateList: [],
    selectedTemplateIds: [], // 存储选中的模板ID
    currentSearchTerm: '', // 当前搜索关键词
    _eventsInitialized: false, // 防止重复绑定事件
    
    // 列定义常量
    COL_DEFS: [
        { key: 'checkbox', label: '', width: '40px' },
        { key: 'name', label: '模板名称', flex: 1 },
        { key: 'update_time', label: '更新时间', width: '140px' }
    ],
    
    // 样式常量
    STYLES: {
        headerRow: "background: #f8f9fa; font-weight: bold; border-bottom: 2px solid #eee; position: sticky; top: 0; z-index: 10;",
        hoverBg: '#f5f7fa',
        defaultBadge: "background: #67c23a; color: white; font-size: 11px; padding: 2px 6px; border-radius: 10px;",
        versionText: "color: #909399; fontSize: 13px;",
        timeText: "color: #909399; fontSize: 12px;"
    },
    
    init() {
        if (!this._eventsInitialized) {
            this.bindEvents();
            this._eventsInitialized = true;
        }
    },
    
    // 工具函数：创建带样式的 span 元素
    createSpan(col, content = '') {
        const span = document.createElement('span');
        if (col.flex) span.style.flex = col.flex;
        if (col.width) {
            span.style.width = col.width;
            span.style.flex = "none";
        }
        span.style.padding = "0 8px";
        span.style.whiteSpace = "nowrap";
        span.style.overflow = "hidden";
        span.style.textOverflow = "ellipsis";
        if (content) span.textContent = content;
        return span;
    },
    
    // 工具函数：创建复选框
    createCheckbox(checked, onChange) {
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = checked;
        checkbox.onchange = onChange;
        return checkbox;
    },
    
    // 工具函数：创建按钮
    createButton(text, title, onClick, className = 'btn-mini', extraStyles = {}) {
        const btn = document.createElement('button');
        btn.className = className;
        btn.textContent = text;
        btn.title = title;
        btn.onclick = onClick;
        Object.assign(btn.style, extraStyles);
        return btn;
    },
    
    // 工具函数：创建名称单元格
    createNameCell(template, defaultTemplateId) {
        const nameBox = document.createElement('div');
        nameBox.style.display = "flex";
        nameBox.style.alignItems = "center";
        nameBox.style.gap = "8px";
        nameBox.style.minWidth = "0"; // 允许 flex 子元素收缩
        
        const nameText = document.createElement('span');
        nameText.innerText = template.name || template.id;
        nameText.style.fontWeight = "500";
        nameText.style.overflow = "hidden";
        nameText.style.textOverflow = "ellipsis";
        nameText.style.whiteSpace = "nowrap";
        nameText.style.flex = "1";
        nameText.style.minWidth = "0";
        nameText.title = template.name || template.id; // 添加 tooltip
        nameBox.appendChild(nameText);
        
        if (template.id === defaultTemplateId) {
            const badge = document.createElement('span');
            badge.style.cssText = this.STYLES.defaultBadge;
            badge.style.flexShrink = "0"; // 防止标签被压缩
            badge.textContent = '默认';
            nameBox.appendChild(badge);
        }
        
        return nameBox;
    },
    
    // 工具函数：渲染列值
    renderColumnValue(span, col, template) {
        switch(col.key) {
            case 'version':
                span.innerText = 'v' + (template.version || '1.0.0');
                span.style.color = '#909399';
                span.style.fontSize = '13px';
                break;
            case 'field_count':
                span.innerText = template.field_count || '-';
                span.style.textAlign = 'center';
                span.style.justifyContent = 'center';
                break;
            case 'file_size_mb':
                const size = template.file_size_mb || 0;
                span.innerText = typeof size === 'number' ? size.toFixed(2) : '-';
                span.style.textAlign = 'center';
                span.style.justifyContent = 'center';
                break;
            case 'update_time':
                span.innerText = template.update_time || '-';
                span.style.color = '#909399';
                span.style.fontSize = '12px';
                break;
        }
    },
    
    bindEvents() {
        // 刷新按钮
        const btnRefresh = document.getElementById('btn-refresh-template-list');
        if (btnRefresh) {
            btnRefresh.addEventListener('click', async () => {
                await this.loadTemplateListForManagement();
            });
        }
        
        // 搜索框
        const searchInput = document.getElementById('template-search-input');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.currentSearchTerm = e.target.value;
                this.filterTemplates();
            });
        }
        
        // 导入按钮
        const btnImport = document.getElementById('btn-toolbox-import-template');
        const importInput = document.getElementById('toolbox-template-import-input');
        if (btnImport && importInput) {
            btnImport.addEventListener('click', () => importInput.click());
            importInput.addEventListener('change', async (e) => {
                if (e.target.files.length > 0) {
                    await this.importTemplate(e.target.files[0]);
                    e.target.value = ''; // 清空选择
                }
            });
        }
        
        // 批量导入按钮
        const btnBatchImport = document.getElementById('btn-toolbox-batch-import-templates');
        const batchImportInput = document.getElementById('toolbox-template-batch-import-input');
        if (btnBatchImport && batchImportInput) {
            btnBatchImport.addEventListener('click', () => batchImportInput.click());
            batchImportInput.addEventListener('change', async (e) => {
                if (e.target.files.length > 0) {
                    await this.batchImportTemplates(e.target.files);
                    e.target.value = ''; // 清空选择
                }
            });
        }
        
        // 批量导出按钮
        const btnBatchExport = document.getElementById('btn-batch-export-templates');
        if (btnBatchExport) {
            btnBatchExport.addEventListener('click', async () => {
                await this.batchExportTemplates();
            });
        }
        
        // 批量删除按钮
        const btnBatchDelete = document.getElementById('btn-batch-delete-templates');
        if (btnBatchDelete) {
            btnBatchDelete.addEventListener('click', async () => {
                await this.batchDeleteTemplates();
            });
        }
    },
    
    async loadTemplateListForManagement() {
        const container = document.getElementById('template-list-container');
        if (!container) return;
        
        container.innerHTML = '<div style="text-align: center; padding: 40px; color: #999;">加载中...</div>';
        
        try {
            // 一次请求获取详细信息
            const res = await fetch(window.AppAPI.BASE_URL + '/api/templates?include_details=true');
            const data = await res.json();
            
            if (!data.templates || data.templates.length === 0) {
                container.innerHTML = '<div style="text-align: center; padding: 40px; color: #999;">暂无模板</div>';
                return;
            }
            
            this.templateList = data.templates;
            
            // 如果有搜索词，重新应用过滤；否则显示全部
            if (this.currentSearchTerm && this.currentSearchTerm.trim()) {
                this.filterTemplates();
            } else {
                this.renderTemplateList(data.templates, data.default_template);
            }
            
        } catch (e) {
            console.error('Load template list failed:', e);
            container.innerHTML = '<div style="text-align: center; padding: 40px; color: #f56c6c;">加载失败: ' + e.message + '</div>';
        }
    },
    
    renderTemplateList(templates, defaultTemplateId) {
        const container = document.getElementById('template-list-container');
        container.innerHTML = '';
        
        // 渲染表头
        const headerRow = this.createHeaderRow(templates);
        container.appendChild(headerRow);
        
        // 渲染数据行
        templates.forEach(template => {
            const row = this.createTemplateRow(template, defaultTemplateId);
            container.appendChild(row);
        });
    },
    
    createHeaderRow(templates) {
        const headerRow = document.createElement('div');
        headerRow.className = 'report-list-item';
        headerRow.style = this.STYLES.headerRow;
        
        this.COL_DEFS.forEach(col => {
            const span = this.createSpan(col);
            span.style.textAlign = col.key === 'checkbox' ? 'center' : 'left';
            
            if (col.key === 'checkbox') {
                const allSelected = templates.length > 0 && 
                                   templates.every(t => this.selectedTemplateIds.includes(t.id));
                const checkAll = this.createCheckbox(allSelected, (e) => this.toggleSelectAll(e.target.checked, templates));
                checkAll.title = '全选/取消全选';
                span.appendChild(checkAll);
            } else {
                span.innerText = col.label;
            }
            
            headerRow.appendChild(span);
        });
        
        // 操作列表头
        const actionHeader = document.createElement('div');
        actionHeader.style.width = "150px";
        actionHeader.style.flex = "none";
        actionHeader.innerText = "操作";
        actionHeader.style.textAlign = "center";
        headerRow.appendChild(actionHeader);
        
        return headerRow;
    },
    
    createTemplateRow(template, defaultTemplateId) {
        const row = document.createElement('div');
        row.className = 'report-list-item';
        row.style.cursor = 'pointer';
        
        // 点击行显示详情
        row.addEventListener('click', (e) => {
            if (e.target.closest('button') || e.target.type === 'checkbox') return;
            this.showTemplateDetail(template);
        });
        
        // 鼠标悬停效果
        row.addEventListener('mouseenter', () => row.style.background = this.STYLES.hoverBg);
        row.addEventListener('mouseleave', () => row.style.background = '');
        
        // 渲染各列
        this.COL_DEFS.forEach(col => {
            const span = this.createSpan(col);
            span.style.display = "flex";
            span.style.alignItems = "center";
            
            if (col.key === 'checkbox') {
                span.style.justifyContent = "center";
                const checkbox = this.createCheckbox(
                    this.selectedTemplateIds.includes(template.id),
                    (e) => {
                        e.stopPropagation();
                        this.toggleTemplateSelection(template.id, e.target.checked);
                    }
                );
                span.appendChild(checkbox);
            } else if (col.key === 'name') {
                span.appendChild(this.createNameCell(template, defaultTemplateId));
            } else {
                this.renderColumnValue(span, col, template);
            }
            
            row.appendChild(span);
        });
        
        // 操作按钮
        row.appendChild(this.createActionButtons(template));
        
        return row;
    },
    
    createActionButtons(template) {
        const actionDiv = document.createElement('div');
        Object.assign(actionDiv.style, {
            width: "150px",
            flex: "none",
            display: "flex",
            gap: "8px",
            justifyContent: "center",
            padding: "0 8px"
        });
        
        const btnExport = this.createButton('📤', '导出', async (e) => {
            e.stopPropagation();
            await this.exportTemplate(template.id);
        });
        
        const btnDelete = this.createButton('🗑️', '删除', async (e) => {
            e.stopPropagation();
            await this.deleteTemplate(template.id, template.name);
        }, 'btn-mini', { background: '#f56c6c', color: 'white' });
        
        actionDiv.appendChild(btnExport);
        actionDiv.appendChild(btnDelete);
        
        return actionDiv;
    },
    
    async exportTemplate(templateId) {
        try {
            if (window.AppUtils) AppUtils.showToast('正在导出模板...', 'info');
            
            const url = window.AppAPI.BASE_URL + '/api/templates/' + templateId + '/export';
            const a = document.createElement('a');
            a.href = url;
            a.download = templateId + '.zip';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            
            if (window.AppUtils) AppUtils.showToast('模板导出成功', 'success');
        } catch (e) {
            console.error('Export template failed:', e);
            if (window.AppUtils) AppUtils.showToast('导出失败: ' + e.message, 'error');
        }
    },
    
    async deleteTemplate(templateId, templateName) {
        try {
            const confirmed = await AppUtils.safeConfirm(`确定要删除模板 "${templateName}" 吗？\n\n此操作不可恢复！`);
            if (!confirmed) return;
            
            const res = await fetch(window.AppAPI.BASE_URL + '/api/templates/' + templateId, {
                method: 'DELETE'
            });
            
            if (!res.ok) {
                const error = await res.json();
                throw new Error(error.detail || '删除失败');
            }
            
            const result = await res.json();
            
            if (result.success) {
                if (window.AppUtils) AppUtils.showToast('模板已删除', 'success');
                // 重新加载模板列表
                await this.loadTemplateListForManagement();
                // 刷新主界面的模板选择器
                if (window.AppFormRenderer) {
                    await window.AppFormRenderer.reloadTemplates();
                }
            } else {
                throw new Error(result.message || '删除失败');
            }
        } catch (e) {
            console.error('Delete template failed:', e);
            if (window.AppUtils) AppUtils.showToast('删除失败: ' + e.message, 'error');
        }
    },
    
    async showTemplateDetail(template) {
        const modal = document.getElementById('template-detail-modal');
        const content = document.getElementById('template-detail-content');
        
        if (!modal || !content) return;
        
        // 显示加载状态
        content.innerHTML = '<div style="text-align: center; padding: 40px; color: #999;">加载中...</div>';
        modal.style.display = 'block';
        
        try {
            // 获取完整的模板详情（包括字段信息）
            const res = await fetch(window.AppAPI.BASE_URL + '/api/templates/' + template.id + '/schema');
            const schema = await res.json();
            
            // 渲染详情内容
            this.renderTemplateDetail(template, schema);
            
        } catch (e) {
            console.error('Load template detail failed:', e);
            content.innerHTML = '<div style="text-align: center; padding: 40px; color: #f56c6c;">加载失败: ' + e.message + '</div>';
        }
    },
    
    renderTemplateDetail(template, schema) {
        const content = document.getElementById('template-detail-content');
        
        let html = '';
        
        // 基本信息区域
        html += '<div style="margin-bottom: 30px;">';
        html += '<h4 style="margin: 0 0 15px 0; padding-bottom: 10px; border-bottom: 2px solid #409eff; color: #303133;">📋 基本信息</h4>';
        html += '<div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px;">';
        
        html += this.createInfoItem('模板名称', template.name || template.id);
        html += this.createInfoItem('模板ID', template.id);
        html += this.createInfoItem('版本', 'v' + (template.version || '1.0.0'));
        html += this.createInfoItem('作者', template.author || '未知');
        html += this.createInfoItem('字段数量', (template.field_count || 0) + ' 个');
        html += this.createInfoItem('文件大小', (template.file_size_mb || 0).toFixed(2) + ' MB');
        html += this.createInfoItem('更新时间', template.update_time || '-');
        
        html += '</div>';
        
        // 描述
        if (template.description) {
            html += '<div style="margin-top: 15px; padding: 12px; background: #f5f7fa; border-radius: 4px; color: #606266;">';
            html += '<strong>描述：</strong>' + template.description;
            html += '</div>';
        }
        
        html += '</div>';
        
        // 添加字段列表
        html += this.renderFieldsList(schema);
        
        // 操作按钮区域
        html += '<div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; display: flex; gap: 10px; justify-content: flex-end;">';
        html += `<button class="btn btn-secondary" onclick="document.getElementById('template-detail-modal').style.display='none'">关闭</button>`;
        html += `<button class="btn btn-primary" onclick="window.AppTemplateManager.exportTemplate('${template.id}')">📤 导出</button>`;
        html += '</div>';
        
        content.innerHTML = html;
    },
    
    createInfoItem(label, value, fontSize = '14px') {
        return `
            <div style="display: flex; padding: 8px 0;">
                <span style="color: #909399; min-width: 80px;">${label}：</span>
                <span style="color: #303133; font-weight: 500; font-size: ${fontSize};">${value}</span>
            </div>
        `;
    },
    
    renderFieldsList(schema) {
        if (!schema || !schema.fields || schema.fields.length === 0) {
            return '<div style="text-align: center; padding: 20px; color: #999;">暂无字段信息</div>';
        }
        
        let html = '<div style="margin-top: 20px;">';
        html += '<h4 style="margin: 0 0 15px 0; padding-bottom: 10px; border-bottom: 2px solid #67c23a; color: #303133;">📝 字段列表</h4>';
        html += '<div style="max-height: 300px; overflow-y: auto;">';
        
        schema.fields.forEach((field, index) => {
            html += '<div style="padding: 10px; margin-bottom: 8px; background: #f5f7fa; border-radius: 4px; border-left: 3px solid #409eff;">';
            html += `<div style="font-weight: 500; color: #303133; margin-bottom: 5px;">${index + 1}. ${field.label}</div>`;
            html += `<div style="font-size: 12px; color: #909399;">`;
            html += `字段名: ${field.key} | 类型: ${field.type}`;
            if (field.required) html += ' | <span style="color: #f56c6c;">必填</span>';
            html += `</div>`;
            if (field.help_text) {
                html += `<div style="font-size: 12px; color: #606266; margin-top: 5px;">${field.help_text}</div>`;
            }
            html += '</div>';
        });
        
        html += '</div></div>';
        return html;
    },
    
    filterTemplates() {
        const term = this.currentSearchTerm.toLowerCase().trim();
        
        if (!term) {
            // 没有搜索词，显示所有模板
            this.renderTemplateList(this.templateList, this.getDefaultTemplateId());
            return;
        }
        
        // 筛选匹配的模板
        const filtered = this.templateList.filter(template => {
            const name = (template.name || '').toLowerCase();
            const id = (template.id || '').toLowerCase();
            const description = (template.description || '').toLowerCase();
            
            return name.includes(term) || id.includes(term) || description.includes(term);
        });
        
        // 渲染筛选后的列表
        this.renderTemplateList(filtered, this.getDefaultTemplateId());
    },
    
    getDefaultTemplateId() {
        // 从原始列表中获取默认模板ID
        const defaultTemplate = this.templateList.find(t => t.is_default);
        return defaultTemplate ? defaultTemplate.id : null;
    },
    
    toggleTemplateSelection(templateId, checked) {
        if (checked) {
            if (!this.selectedTemplateIds.includes(templateId)) {
                this.selectedTemplateIds.push(templateId);
            }
        } else {
            const index = this.selectedTemplateIds.indexOf(templateId);
            if (index > -1) {
                this.selectedTemplateIds.splice(index, 1);
            }
        }
        
        // 更新批量操作按钮的显示状态
        this.updateBatchButtonsVisibility();
        
        // 更新全选复选框的状态
        this.updateSelectAllCheckbox();
    },
    
    toggleSelectAll(checked, templates) {
        if (checked) {
            // 全选：添加所有模板ID
            this.selectedTemplateIds = templates.map(t => t.id);
        } else {
            // 取消全选
            this.selectedTemplateIds = [];
        }
        
        // 重新渲染列表以更新复选框状态
        this.renderTemplateList(templates, this.getDefaultTemplateId());
        
        // 更新批量操作按钮的显示状态
        this.updateBatchButtonsVisibility();
    },
    
    updateBatchButtonsVisibility() {
        const btnBatchExport = document.getElementById('btn-batch-export-templates');
        const btnBatchDelete = document.getElementById('btn-batch-delete-templates');
        
        const hasSelection = this.selectedTemplateIds.length > 0;
        
        // 按钮始终显示，根据选择状态禁用/启用
        if (btnBatchExport) {
            btnBatchExport.disabled = !hasSelection;
            btnBatchExport.style.opacity = hasSelection ? '1' : '0.5';
            btnBatchExport.style.cursor = hasSelection ? 'pointer' : 'not-allowed';
        }
        
        if (btnBatchDelete) {
            btnBatchDelete.disabled = !hasSelection;
            btnBatchDelete.style.opacity = hasSelection ? '1' : '0.5';
            btnBatchDelete.style.cursor = hasSelection ? 'pointer' : 'not-allowed';
        }
    },
    
    async importTemplate(file) {
        try {
            if (window.AppUtils) {
                AppUtils.showToast('正在导入模板...', 'info');
            }
            
            const formData = new FormData();
            formData.append('file', file);
            formData.append('overwrite', 'false');
            
            const response = await fetch(window.AppAPI.BASE_URL + '/api/templates/import', {
                method: 'POST',
                body: formData
            });
            
            const result = await response.json();
            
            if (result.success) {
                const count = result.imported ? result.imported.length : 1;
                if (window.AppUtils) {
                    AppUtils.showToast(`成功导入 ${count} 个模板`, 'success');
                }
                await this.loadTemplateListForManagement();
                if (window.AppFormRenderer) {
                    await window.AppFormRenderer.reloadTemplates();
                }
            } else {
                throw new Error(result.message || '导入失败');
            }
            
        } catch (e) {
            console.error('Import template failed:', e);
            if (window.AppUtils) AppUtils.showToast('导入失败: ' + e.message, 'error');
        }
    },
    
    async batchImportTemplates(files) {
        try {
            if (window.AppUtils) {
                AppUtils.showToast(`正在导入 ${files.length} 个文件...`, 'info');
            }
            
            const formData = new FormData();
            for (let file of files) {
                formData.append('files', file);
            }
            formData.append('overwrite', 'false');
            
            const response = await fetch(window.AppAPI.BASE_URL + '/api/templates/batch-import', {
                method: 'POST',
                body: formData
            });
            
            const result = await response.json();
            
            if (result.success) {
                if (window.AppUtils) {
                    AppUtils.showToast(`成功导入 ${result.total_imported} 个模板`, 'success');
                }
                await this.loadTemplateListForManagement();
                if (window.AppFormRenderer) {
                    await window.AppFormRenderer.reloadTemplates();
                }
            } else {
                throw new Error('批量导入失败');
            }
            
        } catch (e) {
            console.error('Batch import failed:', e);
            if (window.AppUtils) AppUtils.showToast('批量导入失败: ' + e.message, 'error');
        }
    },
    
    async batchExportTemplates() {
        if (this.selectedTemplateIds.length === 0) {
            if (window.AppUtils) AppUtils.showToast('请先选择要导出的模板', 'warning');
            return;
        }
        
        try {
            if (window.AppUtils) {
                AppUtils.showToast(`正在导出 ${this.selectedTemplateIds.length} 个模板...`, 'info');
            }
            
            // 调用批量导出 API
            const response = await fetch(window.AppAPI.BASE_URL + '/api/templates/batch-export', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(this.selectedTemplateIds)
            });
            
            if (!response.ok) {
                throw new Error('批量导出失败');
            }
            
            // 获取文件名
            const contentDisposition = response.headers.get('Content-Disposition');
            let filename = 'templates_batch.zip';
            if (contentDisposition) {
                const matches = /filename=(.+)/.exec(contentDisposition);
                if (matches && matches[1]) {
                    filename = matches[1];
                }
            }
            
            // 下载文件
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
            
            if (window.AppUtils) {
                AppUtils.showToast('批量导出完成', 'success');
            }
            
        } catch (e) {
            console.error('Batch export failed:', e);
            if (window.AppUtils) AppUtils.showToast('批量导出失败: ' + e.message, 'error');
        }
    },
    
    async batchDeleteTemplates() {
        if (this.selectedTemplateIds.length === 0) {
            if (window.AppUtils) AppUtils.showToast('请先选择要删除的模板', 'warning');
            return;
        }
        
        try {
            const confirmed = await AppUtils.safeConfirm(
                `确定要删除选中的 ${this.selectedTemplateIds.length} 个模板吗？\n\n此操作不可恢复！`
            );
            
            if (!confirmed) return;
            
            if (window.AppUtils) {
                AppUtils.showToast(`正在删除 ${this.selectedTemplateIds.length} 个模板...`, 'info');
            }
            
            let successCount = 0;
            let failCount = 0;
            
            // 逐个删除选中的模板
            for (const templateId of this.selectedTemplateIds) {
                try {
                    const res = await fetch(window.AppAPI.BASE_URL + '/api/templates/' + templateId, {
                        method: 'DELETE'
                    });
                    
                    if (res.ok) {
                        successCount++;
                    } else {
                        failCount++;
                    }
                } catch (e) {
                    failCount++;
                    console.error(`Failed to delete template ${templateId}:`, e);
                }
            }
            
            // 清空选中列表
            this.selectedTemplateIds = [];
            
            // 刷新列表
            await this.loadTemplateListForManagement();
            
            // 刷新主界面的模板选择器
            if (window.AppFormRenderer) {
                await window.AppFormRenderer.reloadTemplates();
            }
            
            // 显示结果
            if (failCount === 0) {
                if (window.AppUtils) {
                    AppUtils.showToast(`成功删除 ${successCount} 个模板`, 'success');
                }
            } else {
                if (window.AppUtils) {
                    AppUtils.showToast(`删除完成：成功 ${successCount} 个，失败 ${failCount} 个`, 'warning');
                }
            }
            
        } catch (e) {
            console.error('Batch delete failed:', e);
            if (window.AppUtils) AppUtils.showToast('批量删除失败: ' + e.message, 'error');
        }
    },
    
    updateSelectAllCheckbox() {
        // 查找全选复选框
        const container = document.getElementById('template-list-container');
        if (!container) return;
        
        const checkAllBox = container.querySelector('input[type="checkbox"][title="全选/取消全选"]');
        if (!checkAllBox) return;
        
        // 检查是否所有模板都被选中
        const allSelected = this.templateList.length > 0 && 
                           this.templateList.every(t => this.selectedTemplateIds.includes(t.id));
        
        checkAllBox.checked = allSelected;
    }
};

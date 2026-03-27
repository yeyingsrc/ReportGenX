// form-renderer.js - 动态表单渲染器
// 支持动态/静态表单切换、数据源缓存、模板热加载

window.AppFormRenderer = {
    currentSchema: null,
    currentTemplateId: null,
    formData: {},
    dataSources: {},
    behaviors: {},
    
    // 数据源缓存配置
    dataSourceCache: {},
    // 使用全局配置的缓存过期时间
    get cacheExpiry() {
        return (window.AppConfig && window.AppConfig.CACHE && window.AppConfig.CACHE.EXPIRY_MS) 
            || 5 * 60 * 1000;
    },
    
    init() {
        this.dynamicFormContainer = document.getElementById('dynamic-form-container');
        this.templateSelector = document.getElementById('template-selector');
        this.reloadButton = document.getElementById('btn-reload-templates');
        this.importButton = document.getElementById('btn-import-template');
        this.bindEvents();
    },

    bindEvents() {
        // 模板选择器事件
        if (this.templateSelector) {
            this.templateSelector.addEventListener('change', async (e) => {
                const templateId = e.target.value;
                if (templateId) await this.loadTemplate(templateId);
            });
        }
        
        // 模板刷新按钮事件
        if (this.reloadButton) {
            this.reloadButton.addEventListener('click', async () => {
                await this.reloadTemplates();
            });
        }
        
        // 导入按钮事件
        if (this.importButton) {
            this.importButton.addEventListener('click', () => {
                this.openImportDialog();
            });
        }
    },
    
    async loadTemplateList(skipAutoLoad = false) {
        try {
            const data = await AppAPI.Templates.list();
            if (this.templateSelector && data.templates) {
                this.templateSelector.innerHTML = '';
                data.templates.forEach(t => {
                    const opt = document.createElement('option');
                    opt.value = t.id;
                    opt.textContent = (t.icon || '') + ' ' + t.name + ' (v' + t.version + ')';
                    if (t.id === data.default_template) opt.selected = true;
                    this.templateSelector.appendChild(opt);
                });
                // 只在非跳过模式下自动加载默认模板
                if (!skipAutoLoad && data.default_template) {
                    await this.loadTemplate(data.default_template);
                }
            }
            return data;
        } catch (e) {
            console.error('Load template list failed:', e);
            this.showError('加载模板列表失败: ' + e.message);
            return null;
        }
    },
    
    // 模板热加载
    async reloadTemplates() {
        try {
            if (window.AppUtils) AppUtils.showToast('正在刷新模板...', 'info');
            
            // 保存当前选中的模板ID
            const currentTemplateId = this.currentTemplateId;
            
            // 调用后端热加载API
            const result = await AppAPI.Templates.reload();
            
            if (result.success) {
                // 清空缓存
                this.clearCache();
                
                // 重新加载模板列表（跳过自动加载默认模板）
                await this.loadTemplateList(true);
                
                // 如果当前有选中的模板，重新加载并更新选择器
                if (currentTemplateId && this.templateSelector) {
                    this.templateSelector.value = currentTemplateId;
                    await this.loadTemplate(currentTemplateId);
                }
                
                if (window.AppUtils) AppUtils.showToast(`模板刷新成功！已加载 ${result.loaded_count} 个模板`, 'success');
            } else {
                throw new Error(result.message || '刷新失败');
            }
        } catch (e) {
            console.error('Reload templates failed:', e);
            if (window.AppUtils) AppUtils.showToast('刷新模板失败: ' + e.message, 'error');
        }
    },
    
    // 缓存管理
    clearCache() {
        this.dataSourceCache = {};
    },
    
    getCachedData(key) {
        const cached = this.dataSourceCache[key];
        if (cached && (Date.now() - cached.timestamp < this.cacheExpiry)) {
            return cached.data;
        }
        return null;
    },
    
    setCachedData(key, data) {
        this.dataSourceCache[key] = {
            data: data,
            timestamp: Date.now()
        };
    },

    async loadTemplate(templateId) {
        try {
            // 动态表单模板 - 完整加载和渲染
            const schema = await AppAPI.Templates.getSchema(templateId);
            
            // 使用缓存加载数据源
            const cacheKey = `datasource_${templateId}`;
            let dataSources = this.getCachedData(cacheKey);
            if (!dataSources) {
                try {
                    dataSources = await AppAPI.Templates.getDataSources(templateId);
                    this.setCachedData(cacheKey, dataSources);
                } catch(e) { /* ignore datasource error */ }
            }
            this.dataSources = dataSources || {};
            
            this.currentSchema = schema;
            this.currentTemplateId = templateId;
            this.formData = {};
            this.behaviors = {};
            
            this.parseBehaviors(schema);
            this.renderForm(schema);
            await this.populateDataSources();
            
            window.dispatchEvent(new CustomEvent('template-loaded', { 
                detail: { templateId, schema, isStatic: false } 
            }));
            return schema;
        } catch (e) {
            console.error('Load template failed:', e);
            this.showError('加载模板失败: ' + e.message);
            return null;
        }
    },
    
    showError(message) {
        if (window.AppUtils) {
            AppUtils.showToast(message, 'error');
        } else {
            alert(message);
        }
    },

    parseBehaviors(schema) {
        if (!schema.behaviors) return;
        schema.behaviors.forEach(beh => {
            if (beh.trigger && beh.trigger.field) {
                const triggerField = beh.trigger.field;
                if (!this.behaviors[triggerField]) {
                    this.behaviors[triggerField] = [];
                }
                this.behaviors[triggerField].push(beh);
            }
        });
    },

    renderForm(schema) {
        if (!this.dynamicFormContainer) return;
        this.dynamicFormContainer.innerHTML = '';
        
        const groups = {};
        (schema.field_groups || []).forEach(g => { groups[g.id] = {...g, fields: []}; });
        if (!groups['default']) groups['default'] = {id:'default',name:'其他',order:999,fields:[]};
        (schema.fields || []).forEach(field => {
            const gid = field.group || 'default';
            if (!groups[gid]) groups[gid] = {id:gid,name:gid,order:100,fields:[]};
            groups[gid].fields.push(field);
        });
        Object.values(groups).filter(g=>g.fields.length>0).sort((a,b)=>(a.order||0)-(b.order||0)).forEach(group => {
            this.dynamicFormContainer.appendChild(this.createGroupCard(group));
        });
        
        // 添加底部操作栏
        const submitSection = document.createElement('div');
        submitSection.className = 'card text-right';
        const zIndex = (window.AppConfig && window.AppConfig.Z_INDEX && window.AppConfig.Z_INDEX.SUBMIT_SECTION) || 100;
        submitSection.style.cssText = `position: sticky; bottom: 0; z-index: ${zIndex}; border-top: 2px solid var(--primary-color);`;
        submitSection.innerHTML = `
            <button type="button" class="btn btn-secondary" id="btn-dynamic-open-folder" style="margin-right: 10px;">打开报告目录</button>
            <button type="button" class="btn btn-secondary" id="btn-dynamic-reset">重置</button>
            <button type="button" class="btn btn-secondary" id="btn-dynamic-preview" style="margin-left: 10px;">预览数据</button>
            <button type="button" class="btn btn-primary" id="btn-dynamic-generate" style="margin-left: 10px; font-size: 16px; padding: 10px 30px;">
                生成报告
            </button>
        `;
        this.dynamicFormContainer.appendChild(submitSection);
        
        // 绑定按钮事件
        const generateBtn = document.getElementById('btn-dynamic-generate');
        const previewBtn = document.getElementById('btn-dynamic-preview');
        const resetBtn = document.getElementById('btn-dynamic-reset');
        const openFolderBtn = document.getElementById('btn-dynamic-open-folder');
        
        if (generateBtn) {
            generateBtn.addEventListener('click', async () => {
                await this.submitReport();
            });
        }
        
        if (previewBtn) {
            previewBtn.addEventListener('click', () => {
                this.previewFormData();
            });
        }
        
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                this.resetForm();
            });
        }
        
        if (openFolderBtn) {
            openFolderBtn.addEventListener('click', () => {
                this.openReportFolder();
            });
        }
        
        this.setDefaultValues(schema);
    },
    
    previewFormData() {
        const data = this.collectFormData();
        const json = JSON.stringify(data, null, 2);
        
        // 尝试使用模态框显示
        const modal = document.getElementById('preview-modal');
        const content = document.getElementById('preview-content');
        
        if (modal && content) {
            content.textContent = json;
            modal.style.display = 'flex';
        } else {
            // 回退到 alert
            alert('表单数据预览:\n\n' + json);
        }
    },

    createGroupCard(group) {
        const card = document.createElement('div');
        card.className = 'card';
        
        // 标题行（包含折叠按钮）
        const titleRow = document.createElement('div');
        titleRow.style.cssText = 'display: flex; justify-content: space-between; align-items: center;';
        
        const title = document.createElement('h2');
        title.style.cssText = 'margin: 0; cursor: pointer;';
        title.innerHTML = (group.icon||'') + ' ' + group.name;
        titleRow.appendChild(title);
        
        // 如果组支持折叠，添加折叠按钮
        let toggleBtn = null;
        if (group.collapsed !== undefined) {
            toggleBtn = document.createElement('button');
            toggleBtn.type = 'button';
            toggleBtn.className = 'btn-mini';
            toggleBtn.style.cssText = 'background: #f0f0f0; border: none; padding: 5px 10px; cursor: pointer; border-radius: 4px; font-size: 12px;';
            toggleBtn.innerHTML = group.collapsed ? '展开 ▼' : '收起 ▲';
            titleRow.appendChild(toggleBtn);
        }
        
        card.appendChild(titleRow);
        
        const grid = document.createElement('div');
        grid.className = 'grid';
        group.fields.sort((a,b)=>(a.order||0)-(b.order||0)).forEach(field => {
            const el = this.createField(field);
            if (el) grid.appendChild(el);
        });
        
        // 如果默认收起，隐藏内容
        if (group.collapsed) {
            grid.style.display = 'none';
        }
        
        card.appendChild(grid);
        
        // 绑定折叠事件
        if (toggleBtn) {
            const toggleFn = () => {
                if (grid.style.display === 'none') {
                    grid.style.display = '';
                    toggleBtn.innerHTML = '收起 ▲';
                } else {
                    grid.style.display = 'none';
                    toggleBtn.innerHTML = '展开 ▼';
                }
            };
            toggleBtn.onclick = toggleFn;
            title.onclick = toggleFn;
        }
        
        return card;
    },

    createField(field) {
        if (!window.AppFormRendererFieldOps) {
            throw new Error('AppFormRendererFieldOps is not loaded');
        }
        return window.AppFormRendererFieldOps.createField(this, field);
    },

    createInput(field, pasteBtn = null) {
        if (!window.AppFormRendererFieldOps) {
            throw new Error('AppFormRendererFieldOps is not loaded');
        }
        return window.AppFormRendererFieldOps.createInput(this, field, pasteBtn);
    },
    
    // 创建可搜索下拉框
    createSearchableSelect(field) {
        const container = document.createElement('div');
        container.className = 'searchable-select-container';
        container.style.cssText = 'display: flex; flex-direction: column; gap: 8px;';
        
        // 搜索输入框
        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.className = 'search-input';
        searchInput.placeholder = field.search_placeholder || '输入关键词搜索...';
        searchInput.style.cssText = 'padding: 8px 12px; border: 1px solid #ddd; border-radius: 4px;';
        
        // 下拉选择框
        const select = document.createElement('select');
        select.id = field.key;
        select.name = field.key;
        const empty = document.createElement('option');
        empty.value = ''; 
        empty.textContent = '-- 请选择 --';
        select.appendChild(empty);
        
        if (field.source) select.dataset.source = field.source;
        
        // 保存所有选项用于过滤
        container._allOptions = [];
        
        // 搜索过滤逻辑
        searchInput.addEventListener('input', (e) => {
            const term = e.target.value.toLowerCase().trim();
            const options = container._allOptions;
            
            // 保存当前选中值
            const currentVal = select.value;
            
            // 清空并重建选项
            select.innerHTML = '';
            const emptyOpt = document.createElement('option');
            emptyOpt.value = ''; 
            emptyOpt.textContent = '-- 请选择 --';
            select.appendChild(emptyOpt);
            
            options.forEach(opt => {
                if (!term || opt.text.toLowerCase().includes(term)) {
                    const option = document.createElement('option');
                    option.value = opt.value;
                    option.textContent = opt.text;
                    option.dataset.name = opt.text;
                    select.appendChild(option);
                }
            });
            
            // 尝试恢复选中值
            if (currentVal) select.value = currentVal;
        });
        
        // 选择变更事件
        select.addEventListener('change', (e) => {
            const selectedOption = e.target.selectedOptions[0];
            this.formData[field.key] = e.target.value;
            
            // 如果有 on_change 处理
            if (field.on_change === 'fill_vuln_details' && selectedOption) {
                this.fillVulnDetails(e.target.value, selectedOption.dataset.name);
            }
            
            this.handleChange(field, e.target.value);
        });
        
        container.appendChild(searchInput);
        container.appendChild(select);
        
        return container;
    },
    
    // 填充漏洞详情
    async fillVulnDetails(vulnId, vulnName) {
        if (!vulnId) return;
        
        try {
            const data = await AppAPI._request(`/api/vulnerability/${encodeURIComponent(vulnId)}`);
            if (data && !data.error) {
                // 填充各个字段 (后端字段名: Vuln_Name, Vuln_Description, Repair_suggestions, Risk_Level)
                if (data.Vuln_Name) {
                    this.setFieldValue('vul_name', data.Vuln_Name);
                }
                if (data.Vuln_Description) {
                    this.setFieldValue('vul_description', data.Vuln_Description);
                }
                if (data.Repair_suggestions) {
                    this.setFieldValue('vul_fix_suggestion', data.Repair_suggestions);
                }
                if (data.Risk_Level) {
                    // Risk_Level 可能是 "高危", "中危" 等
                    this.setFieldValue('hazard_level', data.Risk_Level);
                }
                if (data.Vuln_Hazards) {
                    // 如果有漏洞危害字段
                    this.setFieldValue('vul_hazard', data.Vuln_Hazards);
                }
            }
        } catch (e) {
            console.error('[FormRenderer] Fill vuln details error:', e);
        }
    },
    
    // 创建图片上传组件
    createImageUploader(field, multiple, pasteBtn = null) {
        if (!window.AppFormRendererImageOps) {
            throw new Error('AppFormRendererImageOps is not loaded');
        }
        return window.AppFormRendererImageOps.createImageUploader(this, field, multiple, pasteBtn);
    },
    
    // 绑定图片上传事件
    bindImageUploadEvents(field, uploadArea, previewContainer, multiple, pasteBtn = null) {
        if (!window.AppFormRendererImageOps) {
            throw new Error('AppFormRendererImageOps is not loaded');
        }
        return window.AppFormRendererImageOps.bindImageUploadEvents(this, field, uploadArea, previewContainer, multiple, pasteBtn);
    },
    
    // 上传图片到服务器
    async uploadImage(file) {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const data = await AppAPI.uploadImage(e.target.result, file.name || `screenshot_${Date.now()}.png`);
                    resolve(data.file_path ? data : null);
                } catch (err) {
                    if (window.AppUtils) AppUtils.showToast("上传失败: " + err.message, "error");
                    resolve(null);
                }
            };
            reader.readAsDataURL(file);
        });
    },
    
    // 添加图片项到预览 - 使用 CSS 类替代内联样式
    addImageItem(field, imageInfo, container, multiple) {
        if (!window.AppFormRendererImageOps) {
            throw new Error('AppFormRendererImageOps is not loaded');
        }
        return window.AppFormRendererImageOps.addImageItem(this, field, imageInfo, container, multiple);
    },
    
    // 确保预览模态框存在 - 使用 CSS 类替代内联样式
    ensurePreviewModal() {
        if (!window.AppFormRendererImageOps) {
            throw new Error('AppFormRendererImageOps is not loaded');
        }
        return window.AppFormRendererImageOps.ensurePreviewModal(this);
    },
    
    openImagePreview(src, text) {
        if (!window.AppFormRendererImageOps) {
            throw new Error('AppFormRendererImageOps is not loaded');
        }
        return window.AppFormRendererImageOps.openImagePreview(this, src, text);
    },
    
    closeImagePreview() {
        if (!window.AppFormRendererImageOps) {
            throw new Error('AppFormRendererImageOps is not loaded');
        }
        return window.AppFormRendererImageOps.closeImagePreview(this);
    },

    // 创建数据库截图分组组件
    createDbScreenshotGroup(field) {
        const self = this;
        const container = document.createElement('div');
        container.className = 'db-screenshot-group-container';
        container.id = field.key;
        
        // 初始化数据
        if (!this.formData[field.key]) {
            this.formData[field.key] = [];
        }
        
        // 分组列表容器
        const groupList = document.createElement('div');
        groupList.className = 'db-group-list';
        container.appendChild(groupList);
        
        // 添加数据库按钮
        const addDbBtn = document.createElement('button');
        addDbBtn.type = 'button';
        addDbBtn.className = 'btn-add-db-group';
        addDbBtn.innerHTML = '+ 添加数据库';
        addDbBtn.onclick = () => this.addDbGroup(field, groupList);
        container.appendChild(addDbBtn);
        
        return container;
    },

    // 添加数据库分组
    addDbGroup(field, groupList, groupData = null) {
        const self = this;
        const fieldKey = field.key;
        
        // 创建分组数据
        const group = groupData || { db_title: '', items: [] };
        if (!groupData) {
            this.formData[fieldKey].push(group);
        }
        
        // 分组容器
        const groupDiv = document.createElement('div');
        groupDiv.className = 'db-group-item';
        
        // 分组头部
        const header = document.createElement('div');
        header.className = 'db-group-header';
        
        const titleInput = document.createElement('input');
        titleInput.type = 'text';
        titleInput.className = 'db-group-title-input';
        titleInput.placeholder = '数据库标题，如：Oracle数据库172.31.0.196:1521';
        titleInput.value = group.db_title || '';
        titleInput.addEventListener('input', (e) => { group.db_title = e.target.value; });
        
        // 粘贴截图按钮
        const pasteBtn = document.createElement('button');
        pasteBtn.type = 'button';
        pasteBtn.className = 'btn-paste-screenshot';
        pasteBtn.innerHTML = '粘贴截图';
        
        // 删除数据库按钮
        const delGroupBtn = document.createElement('button');
        delGroupBtn.type = 'button';
        delGroupBtn.className = 'btn-delete-group';
        delGroupBtn.innerHTML = '删除数据库';
        delGroupBtn.onclick = () => {
            const idx = this.formData[fieldKey].indexOf(group);
            if (idx > -1) this.formData[fieldKey].splice(idx, 1);
            groupDiv.remove();
        };
        
        header.appendChild(titleInput);
        header.appendChild(pasteBtn);
        header.appendChild(delGroupBtn);
        groupDiv.appendChild(header);
        
        // 创建 image_list 风格的上传区域
        const uploadArea = document.createElement('div');
        uploadArea.className = 'upload-area';
        uploadArea.innerHTML = `
            <span class="upload-icon">📷</span>
            <p>点击上传或粘贴截图</p>
        `;
        groupDiv.appendChild(uploadArea);
        
        // 图片列表容器
        const previewContainer = document.createElement('div');
        previewContainer.className = 'image-list-container';
        groupDiv.appendChild(previewContainer);
        
        // 绑定上传和粘贴事件
        this.bindDbGroupImageEvents(field, group, uploadArea, previewContainer, pasteBtn);
        
        groupList.appendChild(groupDiv);
        
        // 如果有预存数据，渲染已有图片
        if (group.items && group.items.length > 0) {
            group.items.forEach(item => {
                this.addDbGroupImageItem(field, group, item, previewContainer);
            });
        }
    },

    // 绑定数据库分组的图片上传事件
    bindDbGroupImageEvents(field, group, uploadArea, previewContainer, pasteBtn) {
        const self = this;
        
        // 点击上传
        uploadArea.addEventListener('click', () => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = field.accept || 'image/*';
            input.onchange = async (ev) => {
                const file = ev.target.files[0];
                if (file) {
                    const result = await self.uploadImage(file);
                    if (result) {
                        const newItem = { path: result.file_path, description: '' };
                        group.items.push(newItem);
                        self.addDbGroupImageItem(field, group, newItem, previewContainer, result);
                    }
                }
            };
            input.click();
        });
        
        // 粘贴按钮事件
        pasteBtn.onclick = async (e) => {
            e.preventDefault();
            e.stopPropagation();
            try {
                const items = await navigator.clipboard.read();
                let found = false;
                for (const item of items) {
                    const imgType = item.types.find(t => t.startsWith('image/'));
                    if (imgType) {
                        found = true;
                        const blob = await item.getType(imgType);
                        const result = await self.uploadImage(blob);
                        if (result) {
                            const newItem = { path: result.file_path, description: '' };
                            group.items.push(newItem);
                            self.addDbGroupImageItem(field, group, newItem, previewContainer, result);
                        }
                    }
                }
                if (!found && window.AppUtils) {
                    AppUtils.showToast("剪贴板中未发现图片", "info");
                }
            } catch (err) {
                if (window.AppUtils) AppUtils.showToast("无法读取剪贴板", "error");
            }
        };
    },

    // 添加数据库分组中的图片项（复用 image_list 风格）
    addDbGroupImageItem(field, group, item, container, imageInfo = null) {
        const self = this;
        const fullUrl = imageInfo 
            ? `${window.AppAPI.BASE_URL}${imageInfo.url}`
            : `${window.AppAPI.BASE_URL}/temp/${item.path.split(/[/\\]/).pop()}`;
        
        const wrapper = document.createElement('div');
        wrapper.className = 'evidence-item';
        
        const imgBox = document.createElement('div');
        const img = document.createElement('img');
        img.src = fullUrl;
        img.onclick = () => this.openImagePreview(img.src, item.description || '截图预览');
        imgBox.appendChild(img);
        
        const infoBox = document.createElement('div');
        infoBox.className = 'evidence-info-box';
        
        const label = document.createElement('label');
        label.innerText = '图片说明:';
        label.style.marginBottom = '5px';
        
        const textarea = document.createElement('textarea');
        textarea.rows = 4;
        textarea.className = 'evidence-textarea';
        textarea.placeholder = '如：cms_core库t_acct_transinfo表，获取到38453条交易信息';
        textarea.value = item.description || '';
        textarea.addEventListener('input', (e) => { item.description = e.target.value; });
        
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.innerText = '删除';
        delBtn.className = 'btn-delete';
        delBtn.style.marginTop = '25px';
        delBtn.style.alignSelf = 'flex-start';
        delBtn.onclick = () => {
            const idx = group.items.indexOf(item);
            if (idx > -1) group.items.splice(idx, 1);
            wrapper.remove();
        };
        
        infoBox.appendChild(label);
        infoBox.appendChild(textarea);
        
        wrapper.appendChild(imgBox);
        wrapper.appendChild(infoBox);
        wrapper.appendChild(delBtn);
        container.appendChild(wrapper);
    },

    // 创建服务器类型分组组件
    createServerTypeGroup(field) {
        const self = this;
        const container = document.createElement('div');
        container.className = 'server-type-group-container';
        container.id = field.key;
        
        // 初始化数据
        if (!this.formData[field.key]) {
            this.formData[field.key] = [];
        }
        
        // 分组列表容器
        const groupList = document.createElement('div');
        groupList.className = 'server-type-group-list';
        container.appendChild(groupList);
        
        // 添加服务器类型按钮
        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'btn-add-server-type';
        addBtn.innerHTML = '+ 添加服务器类型';
        addBtn.onclick = () => this.addServerTypeGroup(field, groupList);
        container.appendChild(addBtn);
        
        return container;
    },

    // 添加服务器类型分组
    addServerTypeGroup(field, groupList, groupData = null) {
        const self = this;
        const fieldKey = field.key;
        
        // 创建分组数据
        const group = groupData || { type_name: 'SSH', items: [] };
        if (!groupData) {
            this.formData[fieldKey].push(group);
        }
        
        // 分组容器
        const groupDiv = document.createElement('div');
        groupDiv.className = 'server-type-group-item';
        
        // 分组头部
        const header = document.createElement('div');
        header.className = 'server-type-group-header';
        
        // 类型选择下拉框
        const typeSelect = document.createElement('select');
        typeSelect.className = 'server-type-select';
        const typeOptions = field.type_options || [
            {value: 'SSH', label: 'SSH'},
            {value: 'RDP', label: 'RDP'},
            {value: 'FTP', label: 'FTP'},
            {value: 'Telnet', label: 'Telnet'},
            {value: '其他', label: '其他'}
        ];
        typeOptions.forEach(opt => {
            const option = document.createElement('option');
            option.value = opt.value;
            option.textContent = opt.label;
            if (opt.value === group.type_name) option.selected = true;
            typeSelect.appendChild(option);
        });
        typeSelect.addEventListener('change', (e) => { group.type_name = e.target.value; });
        
        // 粘贴截图按钮
        const pasteBtn = document.createElement('button');
        pasteBtn.type = 'button';
        pasteBtn.className = 'btn-paste-screenshot';
        pasteBtn.innerHTML = '粘贴截图';
        
        // 删除类型按钮
        const delGroupBtn = document.createElement('button');
        delGroupBtn.type = 'button';
        delGroupBtn.className = 'btn-delete-group';
        delGroupBtn.innerHTML = '删除类型';
        delGroupBtn.onclick = () => {
            const idx = this.formData[fieldKey].indexOf(group);
            if (idx > -1) this.formData[fieldKey].splice(idx, 1);
            groupDiv.remove();
        };
        
        header.appendChild(typeSelect);
        header.appendChild(pasteBtn);
        header.appendChild(delGroupBtn);
        groupDiv.appendChild(header);
        
        // 创建上传区域
        const uploadArea = document.createElement('div');
        uploadArea.className = 'upload-area';
        uploadArea.innerHTML = `
            <span class="upload-icon">📷</span>
            <p>点击上传或粘贴截图</p>
        `;
        groupDiv.appendChild(uploadArea);
        
        // 图片列表容器
        const previewContainer = document.createElement('div');
        previewContainer.className = 'image-list-container';
        groupDiv.appendChild(previewContainer);
        
        // 绑定上传和粘贴事件
        this.bindServerTypeImageEvents(field, group, uploadArea, previewContainer, pasteBtn);
        
        groupList.appendChild(groupDiv);
        
        // 如果有预存数据，渲染已有图片
        if (group.items && group.items.length > 0) {
            group.items.forEach(item => {
                this.addServerTypeImageItem(field, group, item, previewContainer);
            });
        }
    },

    // 绑定服务器类型分组的图片上传事件
    bindServerTypeImageEvents(field, group, uploadArea, previewContainer, pasteBtn) {
        const self = this;
        
        // 点击上传
        uploadArea.addEventListener('click', () => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = field.accept || 'image/*';
            input.onchange = async (ev) => {
                const file = ev.target.files[0];
                if (file) {
                    const result = await self.uploadImage(file);
                    if (result) {
                        const newItem = { server_desc: '', server_screenshot: result.file_path };
                        group.items.push(newItem);
                        self.addServerTypeImageItem(field, group, newItem, previewContainer, result);
                    }
                }
            };
            input.click();
        });
        
        // 粘贴按钮事件
        pasteBtn.onclick = async (e) => {
            e.preventDefault();
            e.stopPropagation();
            try {
                const items = await navigator.clipboard.read();
                let found = false;
                for (const item of items) {
                    const imgType = item.types.find(t => t.startsWith('image/'));
                    if (imgType) {
                        found = true;
                        const blob = await item.getType(imgType);
                        const result = await self.uploadImage(blob);
                        if (result) {
                            const newItem = { server_desc: '', server_screenshot: result.file_path };
                            group.items.push(newItem);
                            self.addServerTypeImageItem(field, group, newItem, previewContainer, result);
                        }
                    }
                }
                if (!found && window.AppUtils) {
                    AppUtils.showToast("剪贴板中未发现图片", "info");
                }
            } catch (err) {
                if (window.AppUtils) AppUtils.showToast("无法读取剪贴板", "error");
            }
        };
    },

    // 添加服务器类型分组中的图片项
    addServerTypeImageItem(field, group, item, container, imageInfo = null) {
        const self = this;
        const fullUrl = imageInfo 
            ? `${window.AppAPI.BASE_URL}${imageInfo.url}`
            : `${window.AppAPI.BASE_URL}/temp/${item.server_screenshot.split(/[/\\]/).pop()}`;
        
        const wrapper = document.createElement('div');
        wrapper.className = 'evidence-item';
        
        const imgBox = document.createElement('div');
        const img = document.createElement('img');
        img.src = fullUrl;
        img.onclick = () => this.openImagePreview(img.src, item.server_desc || '截图预览');
        imgBox.appendChild(img);
        
        const infoBox = document.createElement('div');
        infoBox.className = 'evidence-info-box';
        
        const label = document.createElement('label');
        label.innerText = '服务器描述:';
        label.style.marginBottom = '5px';
        
        const textarea = document.createElement('textarea');
        textarea.rows = 4;
        textarea.className = 'evidence-textarea';
        textarea.placeholder = '如：172.28.250.4 教师工作平台';
        textarea.value = item.server_desc || '';
        textarea.addEventListener('input', (e) => { item.server_desc = e.target.value; });
        
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.innerText = '删除';
        delBtn.className = 'btn-delete';
        delBtn.style.marginTop = '25px';
        delBtn.style.alignSelf = 'flex-start';
        delBtn.onclick = () => {
            const idx = group.items.indexOf(item);
            if (idx > -1) group.items.splice(idx, 1);
            wrapper.remove();
        };
        
        infoBox.appendChild(label);
        infoBox.appendChild(textarea);
        
        wrapper.appendChild(imgBox);
        wrapper.appendChild(infoBox);
        wrapper.appendChild(delBtn);
        container.appendChild(wrapper);
    },

    // 处理 URL 自动解析（ICP 查询）
    async handleUrlProcess(url) {
        try {
            const data = await AppAPI.processUrl(url);
            
            // 填充解析结果
            if (data.ip) this.setFieldValue('ip', data.ip);
            if (data.domain) this.setFieldValue('domain', data.domain);
            
            // 填充 ICP 信息
            if (data.icp_info) {
                if (data.icp_info.unitName) {
                    this.setFieldValue('unit_name', data.icp_info.unitName);
                }
                if (data.icp_info.mainLicence) {
                    this.setFieldValue('icp_number', data.icp_info.mainLicence);
                }
                if (data.icp_info.serviceName) {
                    this.setFieldValue('website_name', data.icp_info.serviceName);
                }
            }
        } catch (e) {
            console.error('[FormRenderer] URL Process error:', e);
        }
    },

    handleChange(field, value, triggerEvent = 'change') {
        if (this.currentSchema) {
            this.currentSchema.fields.forEach(f => {
                if (f.computed && f.compute_from === field.key && f.compute_rule) {
                    this.setFieldValue(f.key, f.compute_rule[value] || '');
                }
            });
        }

        const trigger = String(triggerEvent || 'change').toLowerCase();
        const fieldBehaviors = this.behaviors[field.key];
        if (fieldBehaviors) {
            const behaviorList = Array.isArray(fieldBehaviors) ? fieldBehaviors : [fieldBehaviors];
            behaviorList.forEach((beh) => {
                const expectedEvent = String(
                    (beh && beh.trigger && beh.trigger.event)
                    || beh?.trigger_event
                    || 'change'
                ).toLowerCase();
                if (expectedEvent === trigger && beh.actions) {
                    this.runActions(beh.actions, value);
                }
            });
        }
        
        // 漏洞数量变化时自动计算漏洞总数和风险评级
        const vulnCountFields = ['vuln_count_critical', 'vuln_count_high', 'vuln_count_medium', 'vuln_count_low', 'vuln_count_info'];
        if (vulnCountFields.includes(field.key)) {
            this.autoCalculateRiskLevel();
        }

        // 系统名称变化时，重新应用风险等级的预设值（更新摘要中的系统名称）
        if (field.key === 'system_full_name') {
            const riskLevel = this.formData['overall_risk_level'];
            if (riskLevel) {
                const riskField = this.currentSchema?.fields?.find(f => f.key === 'overall_risk_level');
                if (riskField && riskField.presets && riskField.presets[riskLevel]) {
                    this.applyPresets(riskField.presets[riskLevel]);
                }
            }
        }
        
        // 配置驱动的字段联动 - 替代硬编码的模板判断
        this.handleDependentFieldUpdate(field.key, value);
    },

    resolveBehaviorTemplate(value) {
        if (typeof value === 'string') {
            return value.replace(/\$\{(\w+)\}/g, (_, key) => this.formData[key] || '');
        }
        if (Array.isArray(value)) {
            return value.map((item) => this.resolveBehaviorTemplate(item));
        }
        if (value && typeof value === 'object') {
            const resolved = {};
            Object.entries(value).forEach(([k, v]) => {
                resolved[k] = this.resolveBehaviorTemplate(v);
            });
            return resolved;
        }
        return value;
    },
    
    // 配置驱动的字段联动更新
    handleDependentFieldUpdate(triggerKey, value) {
        const dependentFields = this.currentSchema?.dependent_fields;
        if (!dependentFields) return;
        
        // 遍历所有依赖字段配置
        for (const [targetKey, config] of Object.entries(dependentFields)) {
            // 检查是否由当前字段触发
            const triggers = config.trigger_fields || [config.trigger_field];
            if (!triggers.includes(triggerKey)) continue;
            
            // 如果是自动生成类型，调用对应的生成方法
            if (config.auto_generate) {
                this.updateAutoGeneratedField(targetKey, config);
            } else if (config.template) {
                // 模板替换类型
                this.updateTemplateField(targetKey, config.template);
            }
        }
    },
    
    // 更新模板字段（替换占位符）
    updateTemplateField(targetKey, template) {
        const el = document.getElementById(targetKey);
        if (!el) return;
        
        const rendered = template.replace(/\$\{(\w+)\}/g, (_, key) => this.formData[key] || '');
        el.value = rendered;
        this.formData[targetKey] = rendered;
    },
    
    // 更新自动生成字段（如报告总结）
    updateAutoGeneratedField(targetKey, config) {
        if (targetKey === 'report_conclusion') {
            this.updateReportConclusion();
        }
    },
    
    // 更新指定字段中的占位符
    updatePlaceholderInField(fieldKey, placeholder, newValue) {
        const el = document.getElementById(fieldKey);
        if (el && el.value && el.value.includes(placeholder)) {
            el.value = el.value.replace(new RegExp(placeholder, 'g'), newValue || '');
            this.formData[fieldKey] = el.value;
        }
    },

    // 自动计算风险评级
    autoCalculateRiskLevel() {
        const critical = parseInt(this.formData['vuln_count_critical'] || '0', 10);
        const high = parseInt(this.formData['vuln_count_high'] || '0', 10);
        const medium = parseInt(this.formData['vuln_count_medium'] || '0', 10);
        const low = parseInt(this.formData['vuln_count_low'] || '0', 10);
        const info = parseInt(this.formData['vuln_count_info'] || '0', 10);
        
        // 自动计算漏洞总数
        const total = critical + high + medium + low + info;
        this.setFieldValue('vuln_count_total', String(total));
        
        let riskLevel = '低风险';
        
        // 高风险：超危≥1 或 高危≥1 或 中危>6
        if (critical >= 1 || high >= 1 || medium > 6) {
            riskLevel = '高风险';
        }
        // 中风险：中危1-6 或 低危>8
        else if ((medium >= 1 && medium <= 6) || low > 8) {
            riskLevel = '中风险';
        }
        // 低风险：低危≤5 或 无漏洞
        else if (low <= 5) {
            riskLevel = '低风险';
        }
        
        // 设置风险评级并触发 presets 填充
        const riskField = this.currentSchema?.fields?.find(f => f.key === 'overall_risk_level');
        if (riskField) {
            this.setFieldValue('overall_risk_level', riskLevel);
            // 触发 presets 自动填充
            if (riskField.presets && riskField.presets[riskLevel]) {
                this.applyPresets(riskField.presets[riskLevel]);
            }
        }
    },

    async runActions(actions, value) {
        for (const a of actions) {
            if (a.type === 'compute' && a.target) {
                if (a.rules) {
                    this.setFieldValue(a.target, a.rules[value] || '');
                } else if (a.expression) {
                    // Support ${field_key} replacement
                    const computed = a.expression.replace(/\${(\w+)}/g, (_, k) => this.formData[k] || '');
                    this.setFieldValue(a.target, computed);
                }
            } else if (a.type === 'api_call' && a.endpoint) {
                try {
                    let ep = this.resolveBehaviorTemplate(a.endpoint);
                    const hasParams = a.params && typeof a.params === 'object' && Object.keys(a.params).length > 0;
                    const payload = hasParams ? this.resolveBehaviorTemplate(a.params) : null;
                    const method = String(a.method || (payload ? 'POST' : 'GET')).toUpperCase();

                    if (method === 'GET' && payload) {
                        const search = new URLSearchParams();
                        Object.entries(payload).forEach(([key, raw]) => {
                            if (raw === undefined || raw === null) {
                                return;
                            }
                            if (Array.isArray(raw) || (raw && typeof raw === 'object')) {
                                search.append(key, JSON.stringify(raw));
                                return;
                            }
                            search.append(key, String(raw));
                        });
                        const query = search.toString();
                        if (query) {
                            ep += (ep.includes('?') ? '&' : '?') + query;
                        }
                    }

                    const data = await AppAPI._request(ep, method, method === 'GET' ? null : payload);
                    if (a.result_mapping) {
                        Object.entries(a.result_mapping).forEach(([src, tgt]) => {
                            const v = src.split('.').reduce((o, p) => o && o[p], data);
                            if (v != null) this.setFieldValue(tgt, v);
                        });
                    }
                } catch (e) {
                    console.error('[FormRenderer] API call failed:', e);
                }
            }
        }
    },

    setDefaultValues(schema) {
        // 1. 先设置所有默认值和自动生成值
        (schema.fields || []).forEach(f => {
            let v = f.default;
            if (v === 'today') v = new Date().toISOString().split('T')[0];
            
            // 处理自动生成字段 (兼容布尔值和字符串 "true")
            const shouldAutoGenerate = f.auto_generate === true || f.auto_generate === 'true';
            if (shouldAutoGenerate && f.auto_generate_rule) {
                v = this.generateAutoValue(f.auto_generate_rule);
            }
            
            if (v) { this.formData[f.key] = v; const el = document.getElementById(f.key); if (el) el.value = v; }
        });
        
        // 2. 再处理计算字段（根据已设置的默认值计算）
        (schema.fields || []).forEach(f => {
            if (f.computed && f.compute_from && f.compute_rule) {
                const sourceValue = this.formData[f.compute_from];
                if (sourceValue && f.compute_rule[sourceValue]) {
                    const computedValue = f.compute_rule[sourceValue];
                    this.formData[f.key] = computedValue;
                    const el = document.getElementById(f.key);
                    if (el) el.value = computedValue;
                }
            }
        });
        
        // 3. 处理 presets（根据默认值应用预设）
        (schema.fields || []).forEach(f => {
            if (f.presets && f.default && f.presets[f.default]) {
                this.applyPresets(f.presets[f.default]);
            }
        });
    },
    
    // 根据规则自动生成值
    generateAutoValue(rule) {
        let result = rule;
        
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        
        // 替换 {date:YYYYMMDD} 格式
        result = result.replace('{date:YYYYMMDD}', `${year}${month}${day}`);
        
        // 替换 {date:YYYY-MM-DD} 格式
        result = result.replace('{date:YYYY-MM-DD}', `${year}-${month}-${day}`);
        
        // 替换 {date} 为当前日期 YYYYMMDD
        result = result.replace('{date}', `${year}${month}${day}`);
        
        // 替换 {seq:N} 为 N 位序号（使用随机数模拟）
        result = result.replace(/\{seq:(\d+)\}/g, (match, digits) => {
            const n = parseInt(digits);
            const rand = Math.floor(Math.random() * Math.pow(10, n));
            return String(rand).padStart(n, '0');
        });
        
        // 替换 {random:N} 为 N 位随机数字
        result = result.replace(/\{random:(\d+)\}/g, (match, digits) => {
            const n = parseInt(digits);
            let rand = '';
            for (let i = 0; i < n; i++) {
                rand += Math.floor(Math.random() * 10);
            }
            return rand;
        });
        
        // 替换 {timestamp} 为时间戳
        result = result.replace('{timestamp}', Date.now().toString());
        
        // 替换 {uuid} 为简短 UUID
        result = result.replace('{uuid}', this.generateShortUUID());
        
        return result;
    },
    
    // 生成简短 UUID
    generateShortUUID() {
        return 'xxxx-xxxx'.replace(/x/g, () => {
            return Math.floor(Math.random() * 16).toString(16);
        });
    },

    async populateDataSources() {
        if (!this.currentSchema || !this.dynamicFormContainer) return;
        
        // 处理普通 select
        const selects = this.dynamicFormContainer.querySelectorAll('select[data-source]');
        for (const sel of selects) {
            const src = sel.dataset.source;
            
            // 只有当数据源存在且有数据时才覆盖选项
            if (this.dataSources[src] && Array.isArray(this.dataSources[src]) && this.dataSources[src].length > 0) {
                // 处理 risk_levels 格式的数据源 (带 value/label/color)
                let opts = this.dataSources[src].map(i => {
                    if (typeof i === 'object') {
                        // 支持 {value, label, color} 格式 (risk_levels)
                        if (i.value !== undefined) {
                            return { v: i.value, t: i.label || i.value, color: i.color };
                        }
                        // 支持 {id, name} 格式 (漏洞库等)
                        return { v: i.id || i.name, t: i.name || i.id };
                    }
                    return { v: i, t: i };
                });
                
                const ph = sel.querySelector('option[value=""]');
                sel.innerHTML = '';
                if (ph) sel.appendChild(ph);
                else { const e = document.createElement('option'); e.value=''; e.textContent='-- 请选择 --'; sel.appendChild(e); }
                opts.forEach(o => { 
                    const op = document.createElement('option'); 
                    op.value = o.v; 
                    op.textContent = o.t;
                    // 如果有颜色，设置选项样式
                    if (o.color) {
                        op.style.color = o.color;
                        op.dataset.color = o.color;
                    }
                    sel.appendChild(op); 
                });
                
                // 如果是 searchable_select 容器内的 select，保存选项到容器
                const container = sel.closest('.searchable-select-container');
                if (container) {
                    container._allOptions = opts.map(o => ({ value: o.v, text: o.t, color: o.color }));
                }
            }
            // 如果数据源不存在或为空，保留 schema 中定义的静态 options
        }
    },

    collectFormData() {
        const data = {...this.formData};
        if (this.currentSchema) {
            this.currentSchema.fields.forEach(f => {
                // 图片类型字段数据已在 formData 中，不需要从 DOM 获取
                if (f.type === 'image' || f.type === 'image_list') {
                    return;
                }
                // target_list 类型：数据已在 formData 中
                if (f.type === 'target_list') {
                    return;
                }
                // tester_info_list 类型：数据已在 formData 中
                if (f.type === 'tester_info_list') {
                    return;
                }
                // vuln_list 类型：数据已在 formData 中
                if (f.type === 'vuln_list') {
                    return;
                }
                // array 类型：数据已在 formData 中
                if (f.type === 'array') {
                    return;
                }
                // checkbox_group 类型：将选中的 ID 转换为描述文本
                if (f.type === 'checkbox_group') {
                    // 直接从文本框获取数据
                    const textarea = document.getElementById(f.key);
                    data[f.key] = textarea ? textarea.value : '';
                    return;
                }
                // checkbox 类型：数据已在 formData 中（通过 change 事件更新）
                if (f.type === 'checkbox') {
                    // 不需要从 DOM 获取，formData 中已有正确值
                    return;
                }
                const el = document.getElementById(f.key);
                if (el && el.value !== undefined) {
                    data[f.key] = el.value || '';
                }
            });
        }
        return data;
    },

    // 创建单个复选框（开关）
    createCheckbox(field) {
        const wrapper = document.createElement('div');
        wrapper.className = 'checkbox-single-wrapper';
        wrapper.style.cssText = 'display: flex; align-items: center; gap: 10px;';
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = field.key;
        checkbox.name = field.key;
        
        // 设置默认值
        const defaultVal = field.default === true || field.default === 'true';
        checkbox.checked = defaultVal;
        this.formData[field.key] = defaultVal;
        
        checkbox.addEventListener('change', (e) => {
            this.formData[field.key] = e.target.checked;
            this.handleChange(field, e.target.checked);
        });
        
        const label = document.createElement('span');
        label.textContent = field.help_text || '';
        label.style.cssText = 'color: #666; font-size: 13px;';
        
        wrapper.appendChild(checkbox);
        wrapper.appendChild(label);
        
        return wrapper;
    },

    // 创建测试目标列表
    createTargetList(field) {
        const self = this;
        const container = document.createElement('div');
        container.className = 'target-list-container';
        container.id = field.key;
        
        // 初始化数据
        if (!this.formData[field.key]) {
            this.formData[field.key] = [];
        }
        
        // 表格容器
        const tableWrapper = document.createElement('div');
        tableWrapper.className = 'target-table-wrapper';
        tableWrapper.style.cssText = 'overflow-x: auto; margin-bottom: 10px;';
        
        // 创建表格
        const table = document.createElement('table');
        table.className = 'target-list-table';
        table.style.cssText = 'width: 100%; border-collapse: collapse; font-size: 14px;';
        
        // 表头
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        headerRow.innerHTML = `
            <th style="width: 50px; padding: 8px; border: 1px solid #ddd; background: #f5f5f5;">编号</th>
            <th style="padding: 8px; border: 1px solid #ddd; background: #f5f5f5;">应用系统名称</th>
            <th style="padding: 8px; border: 1px solid #ddd; background: #f5f5f5;">应用系统URL/IP</th>
            <th style="width: 80px; padding: 8px; border: 1px solid #ddd; background: #f5f5f5;">端口</th>
            <th style="width: 100px; padding: 8px; border: 1px solid #ddd; background: #f5f5f5;">测试账号</th>
            <th style="width: 60px; padding: 8px; border: 1px solid #ddd; background: #f5f5f5;">操作</th>
        `;
        thead.appendChild(headerRow);
        table.appendChild(thead);
        
        // 表体
        const tbody = document.createElement('tbody');
        tbody.id = `${field.key}_tbody`;
        table.appendChild(tbody);
        
        tableWrapper.appendChild(table);
        container.appendChild(tableWrapper);
        
        // 添加按钮
        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'btn btn-secondary';
        addBtn.style.cssText = 'padding: 6px 15px; font-size: 13px;';
        addBtn.innerHTML = '+ 添加测试目标';
        addBtn.onclick = () => this.addTargetRow(field.key, field);
        container.appendChild(addBtn);
        
        // 默认添加一行
        setTimeout(() => this.addTargetRow(field.key, field), 0);
        
        return container;
    },

    // 添加测试目标行
    addTargetRow(fieldKey, field) {
        const tbody = document.getElementById(`${fieldKey}_tbody`);
        if (!tbody) return;
        
        const rowIndex = this.formData[fieldKey].length;
        const rowData = {
            system_name: '',
            system_url: '',
            system_port: '80',
            test_account: '无'
        };
        this.formData[fieldKey].push(rowData);
        
        const tr = document.createElement('tr');
        tr.dataset.index = rowIndex;
        
        // 编号列
        const tdNum = document.createElement('td');
        tdNum.style.cssText = 'padding: 6px; border: 1px solid #ddd; text-align: center;';
        tdNum.textContent = rowIndex + 1;
        tr.appendChild(tdNum);
        
        // 应用系统名称
        tr.appendChild(this.createTargetCell(fieldKey, rowIndex, 'system_name', '如：XX业务系统', rowData));
        
        // URL/IP
        tr.appendChild(this.createTargetCell(fieldKey, rowIndex, 'system_url', 'http://example.com', rowData));
        
        // 端口
        tr.appendChild(this.createTargetCell(fieldKey, rowIndex, 'system_port', '80', rowData));
        
        // 测试账号
        tr.appendChild(this.createTargetCell(fieldKey, rowIndex, 'test_account', '无', rowData));
        
        // 删除按钮
        const tdDel = document.createElement('td');
        tdDel.style.cssText = 'padding: 6px; border: 1px solid #ddd; text-align: center;';
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'btn-mini';
        delBtn.style.cssText = 'background: #ff4d4f; color: white; border: none; padding: 4px 8px; cursor: pointer; border-radius: 3px;';
        delBtn.textContent = '删除';
        delBtn.onclick = () => {
            const currentIdx = parseInt(tr.dataset.index);
            this.removeTargetRow(fieldKey, tr, currentIdx);
        };
        tdDel.appendChild(delBtn);
        tr.appendChild(tdDel);
        
        tbody.appendChild(tr);
    },

    // 创建测试目标单元格
    createTargetCell(fieldKey, rowIndex, colKey, placeholder, rowData) {
        const td = document.createElement('td');
        td.style.cssText = 'padding: 4px; border: 1px solid #ddd;';
        
        const input = document.createElement('input');
        input.type = 'text';
        input.style.cssText = 'width: 100%; padding: 6px; border: 1px solid #ccc; border-radius: 3px; box-sizing: border-box;';
        input.placeholder = placeholder;
        input.value = rowData[colKey] || '';
        
        input.addEventListener('input', (e) => {
            rowData[colKey] = e.target.value;
        });
        
        td.appendChild(input);
        return td;
    },

    // 删除测试目标行
    removeTargetRow(fieldKey, tr, rowIndex) {
        const tbody = tr.parentElement;
        
        // 从数据中移除
        this.formData[fieldKey].splice(rowIndex, 1);
        
        // 从 DOM 中移除
        tr.remove();
        
        // 重新编号
        const rows = tbody.querySelectorAll('tr');
        rows.forEach((row, idx) => {
            row.dataset.index = idx;
            row.cells[0].textContent = idx + 1;
        });
        
        // 更新数据索引引用
        this.formData[fieldKey].forEach((data, idx) => {
            // 数据已经通过 splice 正确更新
        });
    },

    // 创建通用数组字段
    createArrayField(field) {
        const container = document.createElement('div');
        container.className = 'array-field-container';
        container.id = field.key;
        
        // 初始化数据
        if (!this.formData[field.key]) {
            this.formData[field.key] = [];
        }
        
        // 表格容器
        const tableWrapper = document.createElement('div');
        tableWrapper.className = 'array-table-wrapper';
        tableWrapper.style.cssText = 'overflow-x: auto; margin-bottom: 10px;';
        
        // 创建表格
        const table = document.createElement('table');
        table.className = 'array-field-table';
        table.style.cssText = 'width: 100%; border-collapse: collapse; font-size: 14px;';
        
        // 表头
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        
        // 编号列
        const thNum = document.createElement('th');
        thNum.style.cssText = 'width: 50px; padding: 8px; border: 1px solid #ddd; background: #f5f5f5;';
        thNum.textContent = '编号';
        headerRow.appendChild(thNum);
        
        // 根据 columns 配置生成表头
        if (field.columns && Array.isArray(field.columns)) {
            field.columns.forEach(col => {
                const th = document.createElement('th');
                const width = col.width || 'auto';
                th.style.cssText = `width: ${width}; padding: 8px; border: 1px solid #ddd; background: #f5f5f5;`;
                th.textContent = col.label || col.key;
                headerRow.appendChild(th);
            });
        }
        
        // 操作列
        const thAction = document.createElement('th');
        thAction.style.cssText = 'width: 60px; padding: 8px; border: 1px solid #ddd; background: #f5f5f5;';
        thAction.textContent = '操作';
        headerRow.appendChild(thAction);
        
        thead.appendChild(headerRow);
        table.appendChild(thead);
        
        // 表体
        const tbody = document.createElement('tbody');
        tbody.id = `${field.key}_tbody`;
        table.appendChild(tbody);
        
        tableWrapper.appendChild(table);
        container.appendChild(tableWrapper);
        
        // 按钮容器
        const btnContainer = document.createElement('div');
        btnContainer.style.cssText = 'display: flex; gap: 10px;';
        
        // 添加按钮
        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'btn btn-secondary';
        addBtn.style.cssText = 'padding: 6px 15px; font-size: 13px;';
        addBtn.innerHTML = `+ 添加${field.label || '记录'}`;
        addBtn.onclick = () => this.addArrayRow(field.key, field);
        btnContainer.appendChild(addBtn);
        
        // 批量导入按钮
        const batchBtn = document.createElement('button');
        batchBtn.type = 'button';
        batchBtn.className = 'btn btn-secondary';
        batchBtn.style.cssText = 'padding: 6px 15px; font-size: 13px; background: #52c41a; color: white;';
        batchBtn.innerHTML = '📋 批量导入';
        batchBtn.onclick = () => this.openBatchImportModal(field);
        btnContainer.appendChild(batchBtn);
        
        container.appendChild(btnContainer);
        
        // 默认添加一行
        setTimeout(() => this.addArrayRow(field.key, field), 0);
        
        return container;
    },

    // 添加数组字段行
    addArrayRow(fieldKey, field) {
        const tbody = document.getElementById(`${fieldKey}_tbody`);
        if (!tbody) return;
        
        const rowIndex = this.formData[fieldKey].length;
        const rowData = {};
        
        // 初始化行数据
        if (field.columns && Array.isArray(field.columns)) {
            field.columns.forEach(col => {
                rowData[col.key] = col.default || '';
            });
        }
        
        this.formData[fieldKey].push(rowData);
        
        const tr = document.createElement('tr');
        tr.dataset.index = rowIndex;
        
        // 编号列
        const tdNum = document.createElement('td');
        tdNum.style.cssText = 'padding: 6px; border: 1px solid #ddd; text-align: center;';
        tdNum.textContent = rowIndex + 1;
        tr.appendChild(tdNum);
        
        // 根据 columns 配置生成单元格
        if (field.columns && Array.isArray(field.columns)) {
            field.columns.forEach(col => {
                tr.appendChild(this.createArrayCell(fieldKey, rowIndex, col, rowData));
            });
        }
        
        // 删除按钮
        const tdDel = document.createElement('td');
        tdDel.style.cssText = 'padding: 6px; border: 1px solid #ddd; text-align: center;';
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'btn-mini';
        delBtn.style.cssText = 'background: #ff4d4f; color: white; border: none; padding: 4px 8px; cursor: pointer; border-radius: 3px;';
        delBtn.textContent = '删除';
        delBtn.onclick = () => {
            const currentIdx = parseInt(tr.dataset.index);
            this.removeArrayRow(fieldKey, tr, currentIdx);
        };
        tdDel.appendChild(delBtn);
        tr.appendChild(tdDel);
        
        tbody.appendChild(tr);
        
        // 触发汇总更新
        this.updateControlledServersSummary(fieldKey);
        this.updateDbConnectionSummary(fieldKey);
        this.updateDataStatisticsSummary(fieldKey);
        this.updateReportConclusion();
    },

    // 创建数组字段单元格
    createArrayCell(fieldKey, rowIndex, col, rowData) {
        const td = document.createElement('td');
        td.style.cssText = 'padding: 4px; border: 1px solid #ddd;';
        
        if (col.type === 'select') {
            // 下拉框
            const select = document.createElement('select');
            select.style.cssText = 'width: 100%; padding: 6px; border: 1px solid #ccc; border-radius: 3px; box-sizing: border-box;';
            
            // 添加选项
            if (col.options && Array.isArray(col.options)) {
                col.options.forEach(opt => {
                    const option = document.createElement('option');
                    option.value = typeof opt === 'object' ? opt.value : opt;
                    option.textContent = typeof opt === 'object' ? (opt.label || opt.value) : opt;
                    if (option.value === rowData[col.key]) {
                        option.selected = true;
                    }
                    select.appendChild(option);
                });
            }
            
            select.addEventListener('change', (e) => {
                rowData[col.key] = e.target.value;
                // 类型变更时触发汇总更新
                if (col.key === 'server_type') {
                    this.updateControlledServersSummary(fieldKey);
                }
                if (col.key === 'db_type') {
                    this.updateDbConnectionSummary(fieldKey);
                }
            });
            
            td.appendChild(select);
        } else if (col.type === 'textarea') {
            // 多行文本框
            const textarea = document.createElement('textarea');
            textarea.style.cssText = 'width: 100%; padding: 6px; border: 1px solid #ccc; border-radius: 3px; box-sizing: border-box; resize: vertical; min-height: 60px;';
            textarea.placeholder = col.placeholder || '';
            textarea.value = rowData[col.key] || '';
            textarea.rows = col.rows || 3;
            
            textarea.addEventListener('input', (e) => {
                rowData[col.key] = e.target.value;
            });
            
            td.appendChild(textarea);
        } else if (col.type === 'image') {
            // 图片上传
            td.appendChild(this.createArrayImageCell(fieldKey, rowIndex, col, rowData));
        } else {
            // 文本输入框（默认）
            const input = document.createElement('input');
            input.type = 'text';
            input.style.cssText = 'width: 100%; padding: 6px; border: 1px solid #ccc; border-radius: 3px; box-sizing: border-box;';
            input.placeholder = col.placeholder || '';
            input.value = rowData[col.key] || '';
            
            input.addEventListener('input', (e) => {
                rowData[col.key] = e.target.value;
                // 数据统计字段变更时触发汇总更新
                if (col.key === 'data_type' || col.key === 'data_count') {
                    this.updateDataStatisticsSummary(fieldKey);
                    this.updateReportConclusion();
                }
            });
            
            td.appendChild(input);
        }
        
        return td;
    },
    
    // 创建数组字段中的图片上传单元格
    createArrayImageCell(fieldKey, rowIndex, col, rowData) {
        const self = this;
        const container = document.createElement('div');
        container.className = 'array-image-cell';
        container.style.cssText = 'display: flex; flex-direction: column; gap: 5px; min-width: 120px;';
        
        // 预览区域
        const preview = document.createElement('div');
        preview.className = 'array-image-preview';
        preview.style.cssText = 'width: 100%; min-height: 60px; border: 1px dashed #ccc; border-radius: 4px; display: flex; align-items: center; justify-content: center; cursor: pointer; background: #fafafa;';
        
        // 如果已有图片，显示预览
        if (rowData[col.key]) {
            const img = document.createElement('img');
            img.src = `${window.AppAPI.BASE_URL}/temp/${rowData[col.key].split('/').pop()}`;
            img.style.cssText = 'max-width: 100%; max-height: 80px; object-fit: contain;';
            img.onclick = () => this.openImagePreview(img.src, col.label || '图片预览');
            preview.appendChild(img);
        } else {
            preview.innerHTML = '<span style="color: #999; font-size: 12px;">点击上传</span>';
        }
        
        // 按钮区域
        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display: flex; gap: 5px;';
        
        // 上传按钮
        const uploadBtn = document.createElement('button');
        uploadBtn.type = 'button';
        uploadBtn.className = 'btn-mini';
        uploadBtn.style.cssText = 'flex: 1; padding: 4px 8px; font-size: 11px; background: #1890ff; color: white; border: none; border-radius: 3px; cursor: pointer;';
        uploadBtn.textContent = '上传';
        
        // 粘贴按钮
        const pasteBtn = document.createElement('button');
        pasteBtn.type = 'button';
        pasteBtn.className = 'btn-mini';
        pasteBtn.style.cssText = 'flex: 1; padding: 4px 8px; font-size: 11px; background: #52c41a; color: white; border: none; border-radius: 3px; cursor: pointer;';
        pasteBtn.textContent = '粘贴';
        
        // 上传点击事件
        const handleUpload = () => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = col.accept || 'image/*';
            input.onchange = async (e) => {
                const file = e.target.files[0];
                if (file) {
                    const result = await self.uploadImage(file);
                    if (result) {
                        rowData[col.key] = result.file_path;
                        self.updateArrayImagePreview(preview, result, col);
                    }
                }
            };
            input.click();
        };
        
        preview.onclick = handleUpload;
        uploadBtn.onclick = handleUpload;
        
        // 粘贴点击事件
        pasteBtn.onclick = async () => {
            try {
                const items = await navigator.clipboard.read();
                for (const item of items) {
                    const imgType = item.types.find(t => t.startsWith('image/'));
                    if (imgType) {
                        const blob = await item.getType(imgType);
                        const result = await self.uploadImage(blob);
                        if (result) {
                            rowData[col.key] = result.file_path;
                            self.updateArrayImagePreview(preview, result, col);
                        }
                        break;
                    }
                }
            } catch (err) {
                if (window.AppUtils) AppUtils.showToast('无法读取剪贴板', 'error');
            }
        };
        
        btnRow.appendChild(uploadBtn);
        btnRow.appendChild(pasteBtn);
        
        container.appendChild(preview);
        container.appendChild(btnRow);
        
        return container;
    },
    
    // 更新数组字段中的图片预览
    updateArrayImagePreview(preview, imageInfo, col) {
        const fullUrl = `${window.AppAPI.BASE_URL}${imageInfo.url}`;
        preview.innerHTML = '';
        // 移除预览区域的上传点击事件
        preview.onclick = null;
        preview.style.cursor = 'default';
        
        const img = document.createElement('img');
        img.src = fullUrl;
        img.style.cssText = 'max-width: 100%; max-height: 80px; object-fit: contain; cursor: pointer;';
        img.onclick = (e) => {
            e.stopPropagation(); // 阻止冒泡
            this.openImagePreview(img.src, col.label || '图片预览');
        };
        preview.appendChild(img);
    },
    
    // 打开批量导入弹窗
    openBatchImportModal(field) {
        // 确保弹窗存在
        this.ensureBatchImportModal();
        
        const modal = document.getElementById('batch-import-modal');
        const textarea = document.getElementById('batch-import-textarea');
        const confirmBtn = document.getElementById('batch-import-confirm');
        const formatHint = document.getElementById('batch-import-format');
        
        // 生成格式提示
        const colNames = (field.columns || []).map(c => c.label || c.key).join(' | ');
        formatHint.textContent = `格式：${colNames}（每行一条，支持Tab/逗号/分号分隔）`;
        
        // 清空文本框
        textarea.value = '';
        
        // 绑定确认事件
        confirmBtn.onclick = () => {
            this.processBatchImport(field, textarea.value);
            modal.style.display = 'none';
        };
        
        modal.style.display = 'flex';
        textarea.focus();
    },
    
    // 确保批量导入弹窗存在
    ensureBatchImportModal() {
        if (document.getElementById('batch-import-modal')) return;
        
        const modal = document.createElement('div');
        modal.id = 'batch-import-modal';
        modal.style.cssText = 'display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 10000; align-items: center; justify-content: center;';
        
        modal.innerHTML = `
            <div style="background: white; border-radius: 8px; padding: 20px; width: 600px; max-width: 90%; max-height: 80vh; overflow: auto;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                    <h3 style="margin: 0;">📋 批量导入</h3>
                    <button type="button" id="batch-import-close" style="background: none; border: none; font-size: 20px; cursor: pointer;">&times;</button>
                </div>
                <p id="batch-import-format" style="color: #666; font-size: 13px; margin-bottom: 10px;"></p>
                <textarea id="batch-import-textarea" rows="10" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-family: monospace; font-size: 13px; box-sizing: border-box;" placeholder="粘贴数据，每行一条记录..."></textarea>
                <div style="margin-top: 15px; text-align: right;">
                    <button type="button" id="batch-import-cancel" class="btn btn-secondary" style="margin-right: 10px;">取消</button>
                    <button type="button" id="batch-import-confirm" class="btn btn-primary">导入</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // 绑定关闭事件
        document.getElementById('batch-import-close').onclick = () => modal.style.display = 'none';
        document.getElementById('batch-import-cancel').onclick = () => modal.style.display = 'none';
        modal.onclick = (e) => { if (e.target === modal) modal.style.display = 'none'; };
    },
    
    // 处理批量导入数据
    processBatchImport(field, text) {
        if (!text.trim()) return;
        
        const lines = text.trim().split('\n');
        const columns = field.columns || [];
        let importedCount = 0;
        
        lines.forEach(line => {
            line = line.trim();
            if (!line) return;
            
            // 智能分隔：优先Tab，其次逗号，再次分号，最后多空格
            let values;
            if (line.includes('\t')) {
                values = line.split('\t');
            } else if (line.includes(',')) {
                values = line.split(',');
            } else if (line.includes(';')) {
                values = line.split(';');
            } else {
                values = line.split(/\s{2,}|\s+/);
            }
            
            // 构建行数据
            const rowData = {};
            columns.forEach((col, idx) => {
                let val = (values[idx] || '').trim();
                // 对于 select 类型，尝试匹配选项
                if (col.type === 'select' && col.options && val) {
                    const matched = col.options.find(opt => {
                        const optVal = typeof opt === 'object' ? opt.value : opt;
                        const optLabel = typeof opt === 'object' ? (opt.label || opt.value) : opt;
                        return optVal.toLowerCase() === val.toLowerCase() || 
                               optLabel.toLowerCase() === val.toLowerCase();
                    });
                    if (matched) {
                        val = typeof matched === 'object' ? matched.value : matched;
                    }
                }
                rowData[col.key] = val || col.default || '';
            });
            
            // 添加到表格
            this.addArrayRowWithData(field.key, field, rowData);
            importedCount++;
        });
        
        // 批量导入后触发汇总更新
        this.updateControlledServersSummary(field.key);
        
        if (window.AppUtils) {
            AppUtils.showToast(`成功导入 ${importedCount} 条记录`, 'success');
        }
    },
    
    // 添加带数据的数组行
    addArrayRowWithData(fieldKey, field, rowData) {
        const tbody = document.getElementById(`${fieldKey}_tbody`);
        if (!tbody) return;
        
        const rowIndex = this.formData[fieldKey].length;
        this.formData[fieldKey].push(rowData);
        
        const tr = document.createElement('tr');
        tr.dataset.index = rowIndex;
        
        // 编号列
        const tdNum = document.createElement('td');
        tdNum.style.cssText = 'padding: 6px; border: 1px solid #ddd; text-align: center;';
        tdNum.textContent = rowIndex + 1;
        tr.appendChild(tdNum);
        
        // 根据 columns 配置生成单元格
        if (field.columns && Array.isArray(field.columns)) {
            field.columns.forEach(col => {
                tr.appendChild(this.createArrayCell(fieldKey, rowIndex, col, rowData));
            });
        }
        
        // 删除按钮
        const tdDel = document.createElement('td');
        tdDel.style.cssText = 'padding: 6px; border: 1px solid #ddd; text-align: center;';
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'btn-mini';
        delBtn.style.cssText = 'background: #ff4d4f; color: white; border: none; padding: 4px 8px; cursor: pointer; border-radius: 3px;';
        delBtn.textContent = '删除';
        delBtn.onclick = () => {
            const currentIdx = parseInt(tr.dataset.index);
            this.removeArrayRow(fieldKey, tr, currentIdx);
        };
        tdDel.appendChild(delBtn);
        tr.appendChild(tdDel);
        
        tbody.appendChild(tr);
    },

    // 删除数组字段行
    removeArrayRow(fieldKey, tr, rowIndex) {
        const tbody = tr.parentElement;
        
        // 从数据中移除
        this.formData[fieldKey].splice(rowIndex, 1);
        
        // 从 DOM 中移除
        tr.remove();
        
        // 重新编号
        const rows = tbody.querySelectorAll('tr');
        rows.forEach((row, idx) => {
            row.dataset.index = idx;
            row.cells[0].textContent = idx + 1;
        });
        
        // 触发汇总更新
        this.updateControlledServersSummary(fieldKey);
        this.updateDbConnectionSummary(fieldKey);
        this.updateDataStatisticsSummary(fieldKey);
        this.updateReportConclusion();
    },
    
    // ========== 通用汇总计算器 ==========
    
    /**
     * 通用计数汇总生成器
     * @param {Array} items - 数据列表
     * @param {string} typeKey - 类型字段名
     * @param {Object} config - 汇总配置 {type_names, template_zero, template_with_data, connector, last_connector}
     * @returns {string} 汇总描述
     */
    generateCountSummary(items, typeKey, config) {
        if (!items || items.length === 0) {
            return config.template_zero;
        }
        
        // 统计各类型数量
        const typeCounts = {};
        items.forEach(item => {
            const t = item[typeKey] || '其他';
            typeCounts[t] = (typeCounts[t] || 0) + 1;
        });
        
        // 生成描述部分
        const parts = [];
        for (const [type, count] of Object.entries(typeCounts)) {
            if (count > 0) {
                const name = config.type_names?.[type] || `${type}实例`;
                parts.push(`${count}个${name}`);
            }
        }
        
        if (parts.length === 0) return config.template_zero;
        
        const connector = config.connector || '、';
        const lastConnector = config.last_connector || '以及';
        
        let detail = '';
        if (parts.length === 1) {
            detail = parts[0];
        } else {
            detail = parts.slice(0, -1).join(connector) + lastConnector + parts[parts.length - 1];
        }
        
        return config.template_with_data
            .replace('{total}', items.length)
            .replace('{detail}', detail);
    },
    
    /**
     * 通用数据量汇总生成器
     * @param {Array} items - 数据列表
     * @param {string} typeKey - 类型字段名
     * @param {string} countKey - 数量字段名
     * @param {Object} config - 汇总配置
     * @returns {{summary: string, total: number}}
     */
    generateDataSummary(items, typeKey, countKey, config) {
        if (!items || items.length === 0) {
            return { summary: config.template_zero, total: 0 };
        }
        
        // 按类型汇总数量
        const typeTotals = {};
        let grandTotal = 0;
        
        items.forEach(item => {
            const dataType = item[typeKey] || '未知类型';
            const countStr = String(item[countKey] || '0').replace(/,/g, '');
            const count = parseInt(countStr, 10) || 0;
            typeTotals[dataType] = (typeTotals[dataType] || 0) + count;
            grandTotal += count;
        });
        
        if (grandTotal === 0) {
            return { summary: config.template_zero, total: 0 };
        }
        
        const parts = Object.entries(typeTotals)
            .map(([type, total]) => `${type}共计${total.toLocaleString()}条`);
        
        const detail = parts.join(config.connector || '，');
        const summary = config.template_with_data
            .replace('{total}', grandTotal.toLocaleString())
            .replace('{detail}', detail);
        
        return { summary, total: grandTotal };
    },
    
    /**
     * 配置驱动的汇总更新
     * @param {string} summaryKey - 汇总字段名
     */
    updateSummaryFromConfig(summaryKey) {
        const summaryConfigs = this.currentSchema?.summary_configs;
        if (!summaryConfigs?.[summaryKey]) return;
        
        const config = summaryConfigs[summaryKey];
        const items = this.formData[config.source_field] || [];
        const summaryEl = document.getElementById(summaryKey);
        if (!summaryEl) return;
        
        let summary = '';
        
        if (config.mode === 'count') {
            summary = this.generateCountSummary(items, config.type_key, config);
        } else if (config.mode === 'data') {
            const result = this.generateDataSummary(items, config.type_key, config.count_key, config);
            summary = result.summary;
            if (config.total_field) {
                this.formData[config.total_field] = result.total;
            }
        }
        
        summaryEl.value = summary;
        this.formData[summaryKey] = summary;
    },
    
    // 更新可控服务器汇总描述（前端实时预览）
    updateControlledServersSummary(fieldKey) {
        if (fieldKey !== 'controlled_servers') return;
        
        // 优先使用配置驱动
        if (this.currentSchema?.summary_configs?.controlled_servers_summary) {
            this.updateSummaryFromConfig('controlled_servers_summary');
            return;
        }
        
        // 兼容旧逻辑
        const servers = this.formData['controlled_servers'] || [];
        const summaryEl = document.getElementById('controlled_servers_summary');
        if (!summaryEl) return;
        
        const config = {
            type_names: {
                'SSH': 'SSH服务实例', 'RDP': 'RDP服务实例',
                'FTP': 'FTP服务实例', 'Telnet': 'Telnet服务实例', '其他': '其他服务实例'
            },
            template_zero: '通过对内网已控服务器进行信息收集和敏感文件分析，未发现可控服务连接信息。',
            template_with_data: '通过对内网已控服务器进行信息收集和敏感文件分析，发现了以下服务连接信息：统计结果显示共有{total}个可控主机，其中包括{detail}。'
        };
        
        const summary = this.generateCountSummary(servers, 'server_type', config);
        summaryEl.value = summary;
        this.formData['controlled_servers_summary'] = summary;
    },

    // 更新数据库连接信息汇总描述（前端实时预览）
    updateDbConnectionSummary(fieldKey) {
        if (fieldKey !== 'db_connections') return;
        
        // 优先使用配置驱动
        if (this.currentSchema?.summary_configs?.db_connection_summary) {
            this.updateSummaryFromConfig('db_connection_summary');
            return;
        }
        
        // 兼容旧逻辑
        const connections = this.formData['db_connections'] || [];
        const summaryEl = document.getElementById('db_connection_summary');
        if (!summaryEl) return;
        
        const config = {
            type_names: {
                'MySQL': 'MySQL服务实例', 'SqlServer': 'SqlServer服务实例',
                'PostgreSQL': 'PostgreSQL服务实例', 'Oracle': 'Oracle服务实例',
                'Redis': 'Redis服务实例', 'MongoDB': 'MongoDB服务实例', '其他': '其他数据库实例'
            },
            template_zero: '通过对内网已控服务器的信息收集和敏感文件收集，未发现数据库服务连接信息。',
            template_with_data: '通过对内网已控服务器的信息收集和敏感文件收集，发现了以下数据库服务连接信息：统计结果显示共有{total}个数据库服务实例，其中包括{detail}。',
            connector: '、',
            last_connector: '和'
        };
        
        const summary = this.generateCountSummary(connections, 'db_type', config);
        summaryEl.value = summary;
        this.formData['db_connection_summary'] = summary;
    },

    // 更新数据统计汇总描述（前端实时预览）
    updateDataStatisticsSummary(fieldKey) {
        if (fieldKey !== 'data_statistics') return;
        
        // 优先使用配置驱动
        if (this.currentSchema?.summary_configs?.data_statistics_summary) {
            this.updateSummaryFromConfig('data_statistics_summary');
            return;
        }
        
        // 兼容旧逻辑
        const statistics = this.formData['data_statistics'] || [];
        const summaryEl = document.getElementById('data_statistics_summary');
        if (!summaryEl) return;
        
        const config = {
            template_zero: '未发现敏感数据泄露。',
            template_with_data: '根据统计，共泄露{total}条数据，其中{detail}。',
            connector: '，'
        };
        
        const result = this.generateDataSummary(statistics, 'data_type', 'data_count', config);
        summaryEl.value = result.summary;
        this.formData['data_statistics_summary'] = result.summary;
        this.formData['total_data_count'] = result.total;
    },

    // 更新报告总结（前端实时预览）- 配置驱动
    updateReportConclusion() {
        // 检查是否有报告总结的配置
        const config = this.currentSchema?.dependent_fields?.report_conclusion;
        if (!config?.auto_generate) return;
        
        const conclusionEl = document.getElementById('report_conclusion');
        if (!conclusionEl) return;
        
        const targetName = this.formData['target_name'] || 'XX单位';
        
        // 1. 统计有效高危漏洞数（按URL行数计算）
        const internetVulns = this.formData['internet_vulns'] || [];
        const intranetVulns = this.formData['intranet_vulns'] || [];
        const allVulns = [...internetVulns, ...intranetVulns];
        
        let criticalCount = 0, highCount = 0;
        const systems = new Set();
        
        allVulns.forEach(vuln => {
            const level = vuln.vuln_level || '中危';
            const vulnUrl = vuln.vuln_url || '';
            const urlLines = vulnUrl.split('\n').filter(line => line.trim()).length;
            const count = Math.max(1, urlLines);
            
            if (level === '超危') criticalCount += count;
            else if (level === '高危') highCount += count;
            
            // 统计系统
            const system = (vuln.vuln_system || '').trim();
            if (system) systems.add(system);
        });
        
        const effectiveHighVulns = criticalCount + highCount;
        const systemCount = systems.size;
        
        // 2. 可控主机数
        const servers = this.formData['controlled_servers'] || [];
        const serverCount = servers.length;
        
        // 3. 数据库数
        const dbConnections = this.formData['db_connections'] || [];
        const dbCount = dbConnections.length;
        
        // 4. 泄露数据总条数
        const totalDataCount = this.formData['total_data_count'] || 0;
        
        // 5. 数据类型
        const dataStatistics = this.formData['data_statistics'] || [];
        const dataTypes = new Set();
        dataStatistics.forEach(stat => {
            const dataType = (stat.data_type || '').trim();
            if (dataType) dataTypes.add(dataType);
        });
        
        // 6. 构建总结文本
        const parts = [`${targetName}存在有效高危漏洞${effectiveHighVulns}个`];
        
        if (systemCount > 0) {
            parts.push(`进入约${systemCount}个系统`);
        }
        
        if (serverCount > 0) {
            parts.push(`可控主机约${serverCount}台`);
        }
        
        if (dbCount > 0) {
            parts.push(`数据库${dbCount}个`);
        }
        
        if (totalDataCount > 0) {
            parts.push(`泄露数据约${totalDataCount.toLocaleString()}条`);
        }
        
        let conclusion = '';
        if (dataTypes.size > 0) {
            const typeList = Array.from(dataTypes).sort().join('、');
            conclusion = parts.join('，') + `，涉及${typeList}等。`;
        } else {
            conclusion = parts.join('，') + '。';
        }
        
        conclusionEl.value = conclusion;
        this.formData['report_conclusion'] = conclusion;
    },

    // 创建测试人员信息列表
    createTesterInfoList(field) {
        const self = this;
        const container = document.createElement('div');
        container.className = 'tester-info-list-container';
        container.id = field.key;
        
        // 初始化数据
        if (!this.formData[field.key]) {
            this.formData[field.key] = [];
        }
        
        // 表格容器
        const tableWrapper = document.createElement('div');
        tableWrapper.className = 'tester-info-table-wrapper';
        tableWrapper.style.cssText = 'overflow-x: auto; margin-bottom: 10px;';
        
        // 创建表格
        const table = document.createElement('table');
        table.className = 'tester-info-list-table';
        table.style.cssText = 'width: 100%; border-collapse: collapse; font-size: 14px;';
        
        // 表头
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        headerRow.innerHTML = `
            <th style="width: 50px; padding: 8px; border: 1px solid #ddd; background: #f5f5f5;">编号</th>
            <th style="padding: 8px; border: 1px solid #ddd; background: #f5f5f5;">测试人员单位</th>
            <th style="padding: 8px; border: 1px solid #ddd; background: #f5f5f5;">测试人员IP</th>
            <th style="width: 60px; padding: 8px; border: 1px solid #ddd; background: #f5f5f5;">操作</th>
        `;
        thead.appendChild(headerRow);
        table.appendChild(thead);
        
        // 表体
        const tbody = document.createElement('tbody');
        tbody.id = `${field.key}_tbody`;
        table.appendChild(tbody);
        
        tableWrapper.appendChild(table);
        container.appendChild(tableWrapper);
        
        // 添加按钮
        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'btn btn-secondary';
        addBtn.style.cssText = 'padding: 6px 15px; font-size: 13px;';
        addBtn.innerHTML = '+ 添加测试人员信息';
        addBtn.onclick = () => this.addTesterInfoRow(field.key, field);
        container.appendChild(addBtn);
        
        // 默认添加一行
        setTimeout(() => this.addTesterInfoRow(field.key, field), 0);
        
        return container;
    },

    // 添加测试人员信息行
    addTesterInfoRow(fieldKey, field) {
        const tbody = document.getElementById(`${fieldKey}_tbody`);
        if (!tbody) return;
        
        const rowIndex = this.formData[fieldKey].length;
        
        // 获取默认单位名称（从 config.supplierName）
        let defaultCompany = '';
        if (this.dataSources && this.dataSources['config.supplierName']) {
            defaultCompany = this.dataSources['config.supplierName'];
        }
        
        const rowData = {
            tester_company: defaultCompany,
            tester_ip: ''
        };
        this.formData[fieldKey].push(rowData);
        
        const tr = document.createElement('tr');
        tr.dataset.index = rowIndex;
        
        // 编号列
        const tdNum = document.createElement('td');
        tdNum.style.cssText = 'padding: 6px; border: 1px solid #ddd; text-align: center;';
        tdNum.textContent = rowIndex + 1;
        tr.appendChild(tdNum);
        
        // 测试人员单位
        tr.appendChild(this.createTesterInfoCell(fieldKey, rowIndex, 'tester_company', '测试人员所属单位', rowData));
        
        // 测试人员IP
        tr.appendChild(this.createTesterInfoCell(fieldKey, rowIndex, 'tester_ip', '如：192.168.1.100', rowData));
        
        // 删除按钮
        const tdDel = document.createElement('td');
        tdDel.style.cssText = 'padding: 6px; border: 1px solid #ddd; text-align: center;';
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'btn-mini';
        delBtn.style.cssText = 'background: #ff4d4f; color: white; border: none; padding: 4px 8px; cursor: pointer; border-radius: 3px;';
        delBtn.textContent = '删除';
        delBtn.onclick = () => {
            const currentIdx = parseInt(tr.dataset.index);
            this.removeTesterInfoRow(fieldKey, tr, currentIdx);
        };
        tdDel.appendChild(delBtn);
        tr.appendChild(tdDel);
        
        tbody.appendChild(tr);
    },

    // 创建测试人员信息单元格
    createTesterInfoCell(fieldKey, rowIndex, colKey, placeholder, rowData) {
        const td = document.createElement('td');
        td.style.cssText = 'padding: 4px; border: 1px solid #ddd;';
        
        const input = document.createElement('input');
        input.type = 'text';
        input.style.cssText = 'width: 100%; padding: 6px; border: 1px solid #ccc; border-radius: 3px; box-sizing: border-box;';
        input.placeholder = placeholder;
        input.value = rowData[colKey] || '';
        
        input.addEventListener('input', (e) => {
            rowData[colKey] = e.target.value;
        });
        
        td.appendChild(input);
        return td;
    },

    // 删除测试人员信息行
    removeTesterInfoRow(fieldKey, tr, rowIndex) {
        const tbody = tr.parentElement;
        
        // 从数据中移除
        this.formData[fieldKey].splice(rowIndex, 1);
        
        // 从 DOM 中移除
        tr.remove();
        
        // 重新编号
        const rows = tbody.querySelectorAll('tr');
        rows.forEach((row, idx) => {
            row.dataset.index = idx;
            row.cells[0].textContent = idx + 1;
        });
    },

    // 创建多选复选框组（带文本框）
    createCheckboxGroup(field) {
        const wrapper = document.createElement('div');
        wrapper.className = 'checkbox-group-wrapper';
        
        // 左侧：复选框列表
        const checkboxContainer = document.createElement('div');
        checkboxContainer.className = 'checkbox-group-container';
        checkboxContainer.id = field.key + '_checkboxes';
        
        // 初始化选中值数组
        if (!this.formData[field.key]) {
            this.formData[field.key] = [];
        }
        
        // 创建复选框列表
        if (field.options && Array.isArray(field.options)) {
            field.options.forEach(opt => {
                const item = document.createElement('div');
                item.className = 'checkbox-item';
                
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.id = `${field.key}_${opt.id}`;
                checkbox.value = opt.id;
                checkbox.dataset.description = opt.description || '';
                
                const label = document.createElement('label');
                label.htmlFor = checkbox.id;
                label.textContent = opt.label;
                label.title = opt.description || '';
                
                checkbox.addEventListener('change', () => {
                    this.updateCheckboxGroupValue(field.key, field);
                });
                
                item.appendChild(checkbox);
                item.appendChild(label);
                checkboxContainer.appendChild(item);
            });
        }
        
        // 右侧：文本框
        const textarea = document.createElement('textarea');
        textarea.id = field.key;
        textarea.className = 'checkbox-group-textarea';
        textarea.rows = 10;
        textarea.placeholder = '选中左侧选项后自动填充，也可直接编辑';
        textarea.addEventListener('input', () => {
            this.formData[field.key + '_text'] = textarea.value;
        });
        
        wrapper.appendChild(checkboxContainer);
        wrapper.appendChild(textarea);
        
        return wrapper;
    },

    // 更新复选框组的值和文本框
    updateCheckboxGroupValue(fieldKey, field) {
        const container = document.getElementById(fieldKey + '_checkboxes');
        if (!container) return;
        
        const checkboxes = container.querySelectorAll('input[type="checkbox"]:checked');
        const selectedIds = Array.from(checkboxes).map(cb => cb.value);
        this.formData[fieldKey] = selectedIds;
        
        // 更新文本框内容
        const textarea = document.getElementById(fieldKey);
        if (textarea && field && field.options) {
            const descriptions = selectedIds.map((id, index) => {
                const opt = field.options.find(o => o.id === id);
                return opt ? `${index + 1}、${opt.description}` : '';
            }).filter(d => d);
            textarea.value = descriptions.join('\n');
        }
    },

    // 设置复选框组的选中状态
    setCheckboxGroupValue(fieldKey, selectedIds) {
        const container = document.getElementById(fieldKey + '_checkboxes');
        if (!container || !Array.isArray(selectedIds)) return;
        
        // 先取消所有选中
        container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            cb.checked = false;
        });
        
        // 选中指定项
        selectedIds.forEach(id => {
            const cb = container.querySelector(`input[value="${id}"]`);
            if (cb) cb.checked = true;
        });
        
        this.formData[fieldKey] = selectedIds;
        
        // 更新文本框内容
        const field = this.currentSchema?.fields?.find(f => f.key === fieldKey);
        const textarea = document.getElementById(fieldKey);
        if (textarea && field && field.options) {
            const descriptions = selectedIds.map((id, index) => {
                const opt = field.options.find(o => o.id === id);
                return opt ? `${index + 1}、${opt.description}` : '';
            }).filter(d => d);
            textarea.value = descriptions.join('\n');
        }
    },

    validateForm() {
        if (!this.currentSchema) return {valid:false, errors:['No schema']};
        const errors = [], data = this.collectFormData();
        this.currentSchema.fields.forEach(f => {
            if (f.required) {
                // 图片字段的验证
                if (f.type === 'image') {
                    if (!data[f.key]) {
                        errors.push(f.label + ' 为必填项');
                    }
                } else if (f.type === 'image_list') {
                    if (!data[f.key] || !Array.isArray(data[f.key]) || data[f.key].length === 0) {
                        errors.push(f.label + ' 为必填项');
                    }
                } else if (f.type === 'target_list') {
                    // 测试目标列表验证：至少有一条有效数据
                    if (!data[f.key] || !Array.isArray(data[f.key]) || data[f.key].length === 0) {
                        errors.push(f.label + ' 为必填项，请至少添加一条测试目标');
                    } else {
                        // 检查是否有有效数据（至少填写了 URL）
                        const hasValidTarget = data[f.key].some(t => t.system_url && t.system_url.trim());
                        if (!hasValidTarget) {
                            errors.push(f.label + ' 请至少填写一个有效的系统URL/IP');
                        }
                    }
                } else {
                    // 普通字段验证
                    if (!data[f.key] || !data[f.key].toString().trim()) {
                        errors.push(f.label + ' 为必填项');
                    }
                }
            }
            
            // 漏洞列表验证：检查是否有空的漏洞条目
            if (f.type === 'vuln_list' && data[f.key] && Array.isArray(data[f.key]) && data[f.key].length > 0) {
                const emptyVulns = [];
                data[f.key].forEach((vuln, idx) => {
                    // 检查漏洞名称是否为空
                    if (!vuln.vuln_name || !vuln.vuln_name.trim()) {
                        emptyVulns.push(idx + 1);
                    }
                });
                if (emptyVulns.length > 0) {
                    errors.push(`漏洞 ${emptyVulns.join('、')} 未填写漏洞名称，请填写或删除空条目`);
                }
            }
        });
        return {valid: errors.length === 0, errors};
    },

    setFieldValue(key, value) {
        this.formData[key] = value;
        const el = document.getElementById(key);
        if (el) {
            // textarea 和 input 都使用 value 属性
            if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
                el.value = value;
            } else if (el.tagName === 'SELECT') {
                el.value = value;
            }
            el.dispatchEvent(new Event('change', {bubbles:true}));
        }
    },

    // 应用预设值（用于风险等级联动填充）
    applyPresets(presets) {
        if (!presets || typeof presets !== 'object') return;
        for (const [key, value] of Object.entries(presets)) {
            // 数组类型（checkbox_group）
            if (Array.isArray(value)) {
                this.setCheckboxGroupValue(key, value);
                continue;
            }
            // 字符串类型，替换占位符
            let finalValue = value;
            if (typeof value === 'string' && value.includes('#')) {
                finalValue = value.replace(/#(\w+)#/g, (match, fieldKey) => {
                    return this.formData[fieldKey] || match;
                });
            }
            this.setFieldValue(key, finalValue);
        }
    },

    getFieldValue(key) {
        const el = document.getElementById(key);
        return el ? el.value : (this.formData[key] || '');
    },

    getTemplateId() { return this.currentTemplateId || ''; },

    async submitReport() {
        const v = this.validateForm();
        if (!v.valid) { if (window.AppUtils) AppUtils.showToast(v.errors.join('\n'), 'error'); return null; }
        
        const data = this.collectFormData(), tid = this.getTemplateId();
        if (!tid) { if (window.AppUtils) AppUtils.showToast('请先选择模板', 'error'); return null; }
        
        // 处理图片字段，将动态表单中的图片数据映射到后端期望的字段名
        // icp_screenshot -> icp_screenshot_path
        if (data.icp_screenshot && !data.icp_screenshot_path) {
            data.icp_screenshot_path = data.icp_screenshot;
        }
        // 确保 vuln_evidence_images 是数组格式
        if (data.vuln_evidence_images && !Array.isArray(data.vuln_evidence_images)) {
            data.vuln_evidence_images = [];
        }
        
        // 检测是否为新漏洞（仅对 vuln_report 模板生效）
        const currentVulnName = data.vul_name || '';
        let isNewVuln = false;
        if (tid === 'vuln_report' && currentVulnName && window.AppVulnManager) {
            isNewVuln = !AppVulnManager.VULN_LIST.some(v => 
                (v.name || v['Vuln_Name'] || '').trim().toLowerCase() === currentVulnName.trim().toLowerCase()
            );
        }
        
        // 更新按钮状态
        const btn = document.getElementById('btn-dynamic-generate');
        const originalText = btn ? btn.innerText : '';
        if (btn) { btn.disabled = true; btn.innerText = '生成中...'; }
        
        const restoreUI = () => {
            if (btn) { btn.disabled = false; btn.innerText = originalText; }
        };
        
        try {
            const result = await AppAPI.Templates.generate(tid, data);
            restoreUI();
            
            if (result.success) {
                window.lastReportPath = result.report_path;
                if (window.AppUtils) AppUtils.showToast(`报告生成成功！\n路径：${result.report_path}`, 'success');
                
                // 如果是新漏洞，提示添加到漏洞库
                if (isNewVuln) {
                    setTimeout(async () => {
                        if (await AppUtils.safeConfirm(`检测到新漏洞 "${currentVulnName}"，是否添加到库？`)) {
                            await this.addNewVulnFromReport(data);
                        }
                    }, 500);
                }
            } else {
                const errMsg = result.message || result.detail || JSON.stringify(result);
                if (window.AppUtils) AppUtils.showToast('生成失败: ' + errMsg, 'error');
                console.error('Generate report failed:', result);
            }
            return result;
        } catch (e) { 
            restoreUI();
            console.error('Generate report failed:', e); 
            if (window.AppUtils) AppUtils.showToast('网络错误: ' + e.message, 'error');
            return null; 
        }
    },
    
    // 从报告数据添加新漏洞到数据库
    async addNewVulnFromReport(data) {
        const vulnData = {
            name: data.vul_name,
            level: data.hazard_level,
            description: data.vul_description,
            impact: data.vul_harm,
            suggestion: data.repair_suggestion
        };
        
        try {
            const result = await AppAPI.saveVulnerability(vulnData);
            if (window.AppUtils) AppUtils.showToast("已添加到漏洞库", "success");
            if (window.AppVulnManager) await AppVulnManager.loadVulnerabilities();
        } catch(e) {
            if (window.AppUtils) AppUtils.showToast("添加出错: " + e.message, "error");
        }
    },
    
    // 重置表单
    resetForm() {
        // 清空 formData
        this.formData = {};
        
        // 重置所有输入框
        if (this.currentSchema) {
            this.currentSchema.fields.forEach(f => {
                const el = document.getElementById(f.key);
                
                // 处理复杂字段类型
                if (f.type === 'target_list' || f.type === 'tester_info_list') {
                    // 清空列表数据
                    this.formData[f.key] = [];
                    // 清空表格内容（保留表头）
                    if (el) {
                        const tbody = el.querySelector('tbody');
                        if (tbody) tbody.innerHTML = '';
                    }
                } else if (f.type === 'vuln_list') {
                    // 清空漏洞列表数据
                    this.formData[f.key] = [];
                    // 清空侧边栏和内容区（使用正确的 ID 后缀）
                    const sidebarList = document.getElementById(`${f.key}_sidebar_list`);
                    const mainContent = document.getElementById(`${f.key}_list`);
                    const emptyTip = document.getElementById(`${f.key}_empty`);
                    
                    if (sidebarList) sidebarList.innerHTML = '';
                    if (mainContent) {
                        // 清空所有漏洞卡片，只保留空提示
                        const cards = mainContent.querySelectorAll('.vuln-item-card');
                        cards.forEach((card) => {
                            card.remove();
                        });
                    }
                    // 显示空提示
                    if (emptyTip) emptyTip.style.display = 'block';
                } else if (f.type === 'checkbox_group') {
                    // 清空复选框组数据
                    this.formData[f.key] = [];
                    // 取消所有复选框选中状态
                    if (el) {
                        const checkboxes = el.querySelectorAll('input[type="checkbox"]');
                        checkboxes.forEach((checkbox) => {
                            checkbox.checked = false;
                        });
                        // 清空关联的文本框
                        const textarea = el.querySelector('textarea');
                        if (textarea) textarea.value = '';
                    }
                } else if (f.type === 'checkbox') {
                    // 单个复选框
                    if (el && el.type === 'checkbox') {
                        el.checked = false;
                    }
                } else if (f.type === 'searchable_select') {
                    // 可搜索下拉框：清空搜索框和重置下拉框
                    if (el) {
                        const searchInput = el.querySelector('input[type="text"]');
                        const select = el.querySelector('select');
                        if (searchInput) searchInput.value = '';
                        if (select) {
                            select.selectedIndex = 0;
                            // 触发 input 事件以恢复所有选项
                            if (searchInput) {
                                searchInput.dispatchEvent(new Event('input'));
                            }
                        }
                    }
                } else if (f.type === 'image' || f.type === 'image_list') {
                    // 清空图片预览
                    const preview = document.getElementById(`${f.key}-preview`);
                    if (preview) preview.innerHTML = '';
                    // 重置图片数据
                    if (f.type === 'image_list') {
                        this.formData[f.key] = [];
                    } else {
                        this.formData[f.key] = '';
                    }
                } else if (el) {
                    if (el.tagName === 'SELECT') {
                        el.selectedIndex = 0;
                    } else if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
                        el.value = '';
                    }
                }
            });
        }
        
        // 重新设置默认值
        if (this.currentSchema) {
            this.setDefaultValues(this.currentSchema);
        }
        
        if (window.AppUtils) AppUtils.showToast('表单已重置', 'info');
    },
    
    // 打开报告目录
    openReportFolder() {
        if (window.lastReportPath) {
            AppAPI.openFolder(window.lastReportPath).catch(e => {
                console.error('Open folder failed:', e);
                if (window.AppUtils) AppUtils.showToast('打开目录失败', 'error');
            });
        } else {
            // 打开默认输出目录
            window.AppAPI.openFolder('output/report').catch(e => {
                console.error('Open folder failed:', e);
                if (window.AppUtils) AppUtils.showToast('打开目录失败', 'error');
            });
        }
    },
    
    // ========== 模板导入/导出功能 ==========
    
    async exportTemplate(templateId) {
        try {
            const tid = templateId || this.currentTemplateId;
            if (!tid) {
                this.showError('请先选择要导出的模板');
                return;
            }
            
            if (window.AppUtils) AppUtils.showToast('正在导出模板...', 'info');
            
            const res = await fetch(window.AppAPI.BASE_URL + '/api/templates/' + tid + '/export');
            if (!res.ok) throw new Error('导出失败: ' + res.statusText);
            
            // 获取文件名
            const contentDisposition = res.headers.get('Content-Disposition');
            let filename = tid + '_template.zip';
            if (contentDisposition) {
                const match = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
                if (match) filename = match[1].replace(/['"]/g, '');
            }
            
            // 下载文件
            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
            
            if (window.AppUtils) AppUtils.showToast('模板导出成功!', 'success');
        } catch (e) {
            console.error('Export template failed:', e);
            this.showError('导出模板失败: ' + e.message);
        }
    },
    
    async importTemplate(file) {
        try {
            // 1. 基本验证
            if (!file) {
                this.showError('请选择要导入的模板文件');
                return;
            }
            
            // 2. 文件格式验证
            if (!file.name.endsWith('.zip')) {
                this.showError('只支持导入 .zip 格式的模板包');
                return;
            }
            
            // 3. 文件大小验证（限制50MB）
            const maxSize = (window.AppConfig && window.AppConfig.FILE && window.AppConfig.FILE.MAX_SIZE) || 50 * 1024 * 1024;
            const maxSizeMB = (window.AppConfig && window.AppConfig.FILE && window.AppConfig.FILE.MAX_SIZE_MB) || 50;
            if (file.size > maxSize) {
                this.showError(`模板文件过大，最大支持 ${maxSizeMB}MB`);
                return;
            }
            
            // 4. 显示导入进度提示
            if (window.AppUtils) AppUtils.showToast('正在验证模板文件...', 'info');
            
            const formData = new FormData();
            formData.append('file', file);
            
            // 5. 上传并导入
            if (window.AppUtils) AppUtils.showToast('正在上传模板...', 'info');
            
            const result = await AppAPI.Templates.import(file, false);
            
            if (result.success) {
                // 7. 导入成功
                if (window.AppUtils) {
                    AppUtils.showToast(`模板导入成功: ${result.template_id || ''}`, 'success');
                }
                
                // 8. 刷新模板列表
                await this.reloadTemplates();
                
                // 9. 刷新工具箱中的模板列表
                if (window.AppTemplateManager) {
                    await window.AppTemplateManager.loadTemplateListForManagement();
                }
            } else {
                throw new Error(result.message || '导入失败');
            }
        } catch (e) {
            console.error('Import template failed:', e);
            
            // 友好的错误提示
            let errorMsg = '导入模板失败';
            
            if (e.message.includes('Network')) {
                errorMsg = '网络错误，请检查连接后重试';
            } else if (e.message.includes('schema.yaml')) {
                errorMsg = '模板格式错误：缺少 schema.yaml 文件';
            } else if (e.message.includes('template.docx')) {
                errorMsg = '模板格式错误：缺少 template.docx 文件';
            } else if (e.message.includes('Invalid')) {
                errorMsg = '模板文件无效，请检查文件格式';
            } else if (e.message) {
                errorMsg = '导入失败: ' + e.message;
            }
            
            this.showError(errorMsg);
            if (window.AppUtils) AppUtils.showToast(errorMsg, 'error');
        }
    },
    
    // 打开导入对话框
    openImportDialog() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.zip';
        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (file) await this.importTemplate(file);
        };
        input.click();
    },
    
    async deleteTemplate(templateId) {
        try {
            const tid = templateId || this.currentTemplateId;
            if (!tid) {
                this.showError('请先选择要删除的模板');
                return;
            }
            
            // 确认删除
            const confirmed = await AppUtils.safeConfirm(`确定要删除模板 "${tid}" 吗？此操作不可恢复！`);
            if (!confirmed) return;
            
            const result = await AppAPI.Templates.delete(tid);
            
            if (result.success) {
                if (window.AppUtils) AppUtils.showToast('模板已删除', 'success');
                // 刷新模板列表
                await this.reloadTemplates();
                // 刷新工具箱中的模板列表
                if (window.AppTemplateManager) {
                    await window.AppTemplateManager.loadTemplateListForManagement();
                }
            } else {
                throw new Error(result.message || '删除失败');
            }
        } catch (e) {
            console.error('Delete template failed:', e);
            this.showError('删除模板失败: ' + e.message);
        }
    },

    // ========== 漏洞详情列表组件 ==========
    
    // 创建漏洞详情列表（带侧边栏导航）
    createVulnList(field) {
        const self = this;
        const container = document.createElement('div');
        container.className = 'vuln-list-container';
        container.id = field.key;
        container.style.cssText = 'display: flex; gap: 20px; min-height: 400px;';
        
        // 初始化数据
        if (!this.formData[field.key]) {
            this.formData[field.key] = [];
        }
        
        // 左侧：侧边栏导航
        const sidebar = document.createElement('div');
        sidebar.className = 'vuln-sidebar';
        sidebar.id = `${field.key}_sidebar`;
        sidebar.style.cssText = 'width: 200px; flex-shrink: 0; border: 1px solid #e0e0e0; border-radius: 8px; background: #fafafa; padding: 10px;';
        
        // 侧边栏标题
        const sidebarTitle = document.createElement('div');
        sidebarTitle.style.cssText = 'font-weight: bold; padding: 8px; border-bottom: 1px solid #e0e0e0; margin-bottom: 10px;';
        sidebarTitle.textContent = '漏洞列表';
        sidebar.appendChild(sidebarTitle);
        
        // 侧边栏列表
        const sidebarList = document.createElement('div');
        sidebarList.className = 'vuln-sidebar-list';
        sidebarList.id = `${field.key}_sidebar_list`;
        sidebar.appendChild(sidebarList);
        
        // 添加按钮（侧边栏底部）
        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'btn btn-primary';
        addBtn.style.cssText = 'width: 100%; padding: 8px; margin-top: 10px; font-size: 13px;';
        addBtn.innerHTML = '+ 添加漏洞';
        addBtn.onclick = () => this.addVulnItem(field);
        sidebar.appendChild(addBtn);
        
        container.appendChild(sidebar);
        
        // 右侧：漏洞详情内容区
        const mainContent = document.createElement('div');
        mainContent.className = 'vuln-main-content';
        mainContent.id = `${field.key}_list`;
        mainContent.style.cssText = 'flex: 1; min-width: 0;';
        
        // 空状态提示
        const emptyTip = document.createElement('div');
        emptyTip.className = 'vuln-empty-tip';
        emptyTip.id = `${field.key}_empty`;
        emptyTip.style.cssText = 'text-align: center; padding: 60px 20px; color: #999; border: 2px dashed #e0e0e0; border-radius: 8px;';
        emptyTip.innerHTML = '<div style="font-size: 48px; margin-bottom: 15px;">📋</div><div>暂无漏洞，点击左侧"添加漏洞"开始</div>';
        mainContent.appendChild(emptyTip);
        
        container.appendChild(mainContent);
        
        return container;
    },

    // 添加漏洞条目
    addVulnItem(field) {
        const listWrapper = document.getElementById(`${field.key}_list`);
        const sidebarList = document.getElementById(`${field.key}_sidebar_list`);
        const emptyTip = document.getElementById(`${field.key}_empty`);
        if (!listWrapper) return;
        
        // 隐藏空状态提示
        if (emptyTip) emptyTip.style.display = 'none';
        
        const vulnIndex = this.formData[field.key].length;
        const vulnData = {
            vuln_system: '',
            vuln_name: '',
            vuln_level: '中危',
            vuln_url: '',
            vuln_location: '',
            vuln_description: '',
            vuln_evidence: [],
            vuln_suggestion: '',
            vuln_reference: ''
        };
        this.formData[field.key].push(vulnData);
        
        // 创建侧边栏项
        this.addVulnSidebarItem(field, vulnIndex, vulnData, sidebarList);
        
        // 创建漏洞卡片
        const card = this.createVulnCard(field, vulnIndex, vulnData);
        listWrapper.appendChild(card);
        
        // 自动选中新添加的漏洞
        this.selectVulnItem(field, vulnIndex);
        
        // 更新漏洞统计
        this.updateVulnCounts();
        // 更新报告总结（护网报告）
        this.updateReportConclusion();
    },

    // 添加侧边栏项
    addVulnSidebarItem(field, vulnIndex, vulnData, sidebarList) {
        const item = document.createElement('div');
        item.className = 'vuln-sidebar-item';
        item.id = `${field.key}_sidebar_item_${vulnIndex}`;
        item.dataset.index = vulnIndex;
        item.style.cssText = 'padding: 10px; margin-bottom: 5px; border-radius: 6px; cursor: pointer; border: 1px solid transparent; transition: all 0.2s;';
        
        // 风险等级颜色标记（使用全局配置）
        const levelColors = (window.AppConfig && window.AppConfig.THEME && window.AppConfig.THEME.RISK_COLORS) 
            || { '超危': '#8B0000', '高危': '#dc3545', '中危': '#fd7e14', '低危': '#28a745', '信息性': '#17a2b8' };
        
        item.innerHTML = `
            <div style="display: flex; align-items: center; gap: 8px;">
                <span class="vuln-level-dot" style="width: 8px; height: 8px; border-radius: 50%; background: ${levelColors[vulnData.vuln_level] || '#fd7e14'};"></span>
                <span class="vuln-sidebar-name" style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px;">漏洞 ${vulnIndex + 1}</span>
            </div>
        `;
        
        item.onclick = () => this.selectVulnItem(field, vulnIndex);
        
        // 悬停效果
        item.onmouseenter = () => { if (!item.classList.contains('active')) item.style.background = '#f0f0f0'; };
        item.onmouseleave = () => { if (!item.classList.contains('active')) item.style.background = 'transparent'; };
        
        sidebarList.appendChild(item);
    },

    // 选中漏洞项
    selectVulnItem(field, vulnIndex) {
        // 更新侧边栏选中状态
        const sidebarItems = document.querySelectorAll(`#${field.key}_sidebar_list .vuln-sidebar-item`);
        sidebarItems.forEach(item => {
            item.classList.remove('active');
            item.style.background = 'transparent';
            item.style.borderColor = 'transparent';
        });
        
        const activeItem = document.getElementById(`${field.key}_sidebar_item_${vulnIndex}`);
        if (activeItem) {
            activeItem.classList.add('active');
            activeItem.style.background = '#e6f7ff';
            activeItem.style.borderColor = '#1890ff';
        }
        
        // 显示/隐藏卡片
        const cards = document.querySelectorAll(`#${field.key}_list .vuln-item-card`);
        cards.forEach(card => { card.style.display = 'none'; });
        
        const activeCard = document.getElementById(`${field.key}_card_${vulnIndex}`);
        if (activeCard) activeCard.style.display = 'block';
    },

    // 创建漏洞卡片
    createVulnCard(field, vulnIndex, vulnData) {
        const card = document.createElement('div');
        card.className = 'vuln-item-card';
        card.id = `${field.key}_card_${vulnIndex}`;
        card.dataset.index = vulnIndex;
        card.style.cssText = 'border: 1px solid #e0e0e0; border-radius: 8px; padding: 20px; background: #fff; display: none;';
        
        // 卡片头部
        const header = this.createVulnCardHeader(field, vulnIndex, card, vulnData);
        card.appendChild(header);
        
        // 卡片内容
        const content = this.createVulnCardContent(field, vulnIndex, vulnData);
        card.appendChild(content);
        
        return card;
    },

    // 创建漏洞卡片头部
    createVulnCardHeader(field, vulnIndex, card, vulnData) {
        const header = document.createElement('div');
        header.className = 'vuln-card-header';
        header.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; padding-bottom: 10px; border-bottom: 1px solid #eee;';
        
        // 左侧：序号和漏洞选择
        const leftSection = document.createElement('div');
        leftSection.style.cssText = 'display: flex; align-items: center; gap: 15px; flex: 1;';
        
        // 序号
        const indexBadge = document.createElement('span');
        indexBadge.className = 'vuln-index-badge';
        indexBadge.style.cssText = 'background: var(--primary-color, #1890ff); color: white; padding: 4px 12px; border-radius: 4px; font-weight: bold;';
        indexBadge.textContent = `漏洞 ${vulnIndex + 1}`;
        leftSection.appendChild(indexBadge);
        
        // 漏洞名称选择器
        const nameWrapper = document.createElement('div');
        nameWrapper.style.cssText = 'flex: 1; max-width: 400px;';
        // Pass card to allow lazy index resolution
        const nameSelect = this.createVulnNameSelector(field, card, vulnData);
        nameWrapper.appendChild(nameSelect);
        leftSection.appendChild(nameWrapper);
        
        header.appendChild(leftSection);
        
        // 右侧：删除按钮
        const rightSection = document.createElement('div');
        rightSection.style.cssText = 'display: flex; gap: 10px;';
        
        // 删除按钮
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'btn-mini btn-delete-vuln'; // Add class for selection
        delBtn.style.cssText = 'background: #ff4d4f; color: white; border: none; padding: 5px 12px; cursor: pointer; border-radius: 4px;';
        delBtn.textContent = '删除';
        // Use lazy index resolution
        delBtn.onclick = () => {
            const currentIdx = parseInt(card.dataset.index);
            this.removeVulnItem(field, card, currentIdx);
        };
        rightSection.appendChild(delBtn);
        
        header.appendChild(rightSection);
        return header;
    },

    // 创建漏洞名称选择器
    createVulnNameSelector(field, card, vulnData) {
        const container = document.createElement('div');
        container.style.cssText = 'display: flex; gap: 8px;';
        
        // 搜索输入框
        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.placeholder = '搜索或输入漏洞名称...';
        searchInput.style.cssText = 'flex: 1; padding: 6px 10px; border: 1px solid #ddd; border-radius: 4px;';
        
        // 下拉选择框
        const select = document.createElement('select');
        select.style.cssText = 'flex: 1; padding: 6px; border: 1px solid #ddd; border-radius: 4px;';
        
        const emptyOpt = document.createElement('option');
        emptyOpt.value = '';
        emptyOpt.textContent = '-- 从漏洞库选择 --';
        select.appendChild(emptyOpt);
        
        // 填充漏洞库选项
        if (this.dataSources.vulnerabilities) {
            this.dataSources.vulnerabilities.forEach(v => {
                const opt = document.createElement('option');
                opt.value = v.Vuln_id || v.id || v.name;
                opt.textContent = v.Vuln_Name || v.name;
                opt.dataset.vulnData = JSON.stringify(v);
                select.appendChild(opt);
            });
        }
        
        // 保存选项用于过滤
        container._allOptions = Array.from(select.options).slice(1).map(o => ({
            value: o.value, text: o.textContent, data: o.dataset.vulnData
        }));
        
        // 搜索过滤
        searchInput.addEventListener('input', (e) => {
            const term = e.target.value.toLowerCase().trim();
            select.innerHTML = '<option value="">-- 从漏洞库选择 --</option>';
            container._allOptions.forEach(opt => {
                if (!term || opt.text.toLowerCase().includes(term)) {
                    const option = document.createElement('option');
                    option.value = opt.value;
                    option.textContent = opt.text;
                    option.dataset.vulnData = opt.data;
                    select.appendChild(option);
                }
            });
            vulnData.vuln_name = e.target.value;
        });
        
        // 选择漏洞时自动填充（调用 API 获取完整详情）
        select.addEventListener('change', async (e) => {
            const selectedOpt = e.target.selectedOptions[0];
            if (selectedOpt && selectedOpt.value) {
                const vulnId = selectedOpt.value;
                const vulnName = selectedOpt.textContent;
                searchInput.value = vulnName || '';
                
                // Use lazy index resolution
                const currentIdx = parseInt(card.dataset.index);

                // 调用 API 获取完整的漏洞详情
                try {
                    const vData = await AppAPI._request(`/api/vulnerability/${encodeURIComponent(vulnId)}`);
                    if (vData && !vData.error) {
                        this.fillVulnItemFromLibrary(field, currentIdx, vulnData, vData);
                    }
                } catch (err) {
                    console.error('[FormRenderer] Failed to fetch vulnerability details:', err);
                    // 回退到本地缓存数据
                    if (selectedOpt.dataset.vulnData) {
                        const vData = JSON.parse(selectedOpt.dataset.vulnData);
                        this.fillVulnItemFromLibrary(field, currentIdx, vulnData, vData);
                    }
                }
            }
        });
        
        container.appendChild(searchInput);
        container.appendChild(select);
        return container;
    },

    // 从 field.columns 获取字段配置
    getColumnConfig(field, key) {
        if (field.columns && Array.isArray(field.columns)) {
            return field.columns.find(col => col.key === key);
        }
        return null;
    },

    // 构建字段选项（从 schema column 配置读取，带回退默认值）
    buildFieldOptions(column, fallbackOptions = {}) {
        if (!column) return fallbackOptions;
        const opts = { ...fallbackOptions };
        if (column.options) opts.options = column.options;
        if (column.placeholder) opts.placeholder = column.placeholder;
        if (column.rows) opts.rows = column.rows;
        if (column.help_text) opts.helpText = column.help_text;
        return opts;
    },

    // 创建漏洞卡片内容区域
    createVulnCardContent(field, vulnIndex, vulnData) {
        const content = document.createElement('div');
        content.className = 'vuln-card-content';
        
        // 第零行：所属系统（用于漏洞清单和详情标题）
        const row0 = document.createElement('div');
        row0.style.cssText = 'margin-bottom: 15px;';
        const systemCol = this.getColumnConfig(field, 'vuln_system');
        row0.appendChild(this.createVulnField(
            systemCol?.label || '所属系统', 
            'text', field, vulnIndex, 'vuln_system', vulnData, 
            this.buildFieldOptions(systemCol, { placeholder: '如：门户网站、OA系统（用于"XX存在XX漏洞"标题）' })
        ));
        content.appendChild(row0);
        
        // 第一行：漏洞级别、漏洞位置
        const row1 = document.createElement('div');
        row1.style.cssText = 'display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 15px;';
        const levelCol = this.getColumnConfig(field, 'vuln_level');
        // 从全局配置获取风险等级选项，如果没有则使用默认值
        const riskLevelOptions = (this.dataSources && this.dataSources['config.risk_levels']) 
            ? this.dataSources['config.risk_levels'].map(item => ({ value: item.value, label: item.label }))
            : [
                { value: '超危', label: '超危' },
                { value: '高危', label: '高危' },
                { value: '中危', label: '中危' },
                { value: '低危', label: '低危' },
                { value: '信息性', label: '信息性' }
            ];
        row1.appendChild(this.createVulnField(
            levelCol?.label || '漏洞级别', 
            'select', field, vulnIndex, 'vuln_level', vulnData, 
            this.buildFieldOptions(levelCol, { options: riskLevelOptions })
        ));
        const locationCol = this.getColumnConfig(field, 'vuln_location');
        row1.appendChild(this.createVulnField(
            locationCol?.label || '漏洞位置', 
            'text', field, vulnIndex, 'vuln_location', vulnData, 
            this.buildFieldOptions(locationCol, { placeholder: '如：登录页面' })
        ));
        content.appendChild(row1);
        
        // 第1.5行：URL/IP（多行）
        const row1b = document.createElement('div');
        row1b.style.cssText = 'margin-bottom: 15px;';
        const urlCol = this.getColumnConfig(field, 'vuln_url');
        row1b.appendChild(this.createVulnField(
            urlCol?.label || 'URL/IP', 
            'textarea', field, vulnIndex, 'vuln_url', vulnData, 
            this.buildFieldOptions(urlCol, { rows: 2, placeholder: '漏洞所在URL或IP，多个地址请换行输入' })
        ));
        content.appendChild(row1b);
        
        // 第二行：漏洞描述
        const row2 = document.createElement('div');
        row2.style.cssText = 'margin-bottom: 15px;';
        const descCol = this.getColumnConfig(field, 'vuln_description');
        row2.appendChild(this.createVulnField(
            descCol?.label || '漏洞及风险描述', 
            'textarea', field, vulnIndex, 'vuln_description', vulnData, 
            this.buildFieldOptions(descCol, { rows: 3, placeholder: '漏洞详细描述' })
        ));
        content.appendChild(row2);
        
        // 第三行：漏洞举证
        const row3 = document.createElement('div');
        row3.style.cssText = 'margin-bottom: 15px;';
        row3.appendChild(this.createVulnEvidenceUploader(field, vulnIndex, vulnData));
        content.appendChild(row3);
        
        // 第四行：修复建议
        const row4 = document.createElement('div');
        row4.style.cssText = 'margin-bottom: 15px;';
        const suggestionCol = this.getColumnConfig(field, 'vuln_suggestion');
        row4.appendChild(this.createVulnField(
            suggestionCol?.label || '修复建议', 
            'textarea', field, vulnIndex, 'vuln_suggestion', vulnData, 
            this.buildFieldOptions(suggestionCol, { rows: 3, placeholder: '修复方案' })
        ));
        content.appendChild(row4);
        
        // 第五行：参考链接
        const row5 = document.createElement('div');
        const refCol = this.getColumnConfig(field, 'vuln_reference');
        row5.appendChild(this.createVulnField(
            refCol?.label || '参考链接', 
            'text', field, vulnIndex, 'vuln_reference', vulnData, 
            this.buildFieldOptions(refCol, { placeholder: '可选' })
        ));
        content.appendChild(row5);
        
        return content;
    },

    // 删除漏洞条目
    removeVulnItem(field, card, vulnIndex) {
        // 从数据中移除
        this.formData[field.key].splice(vulnIndex, 1);
        
        // 从 DOM 中移除卡片
        card.remove();
        
        // 从侧边栏移除
        const sidebarItem = document.getElementById(`${field.key}_sidebar_item_${vulnIndex}`);
        if (sidebarItem) sidebarItem.remove();
        
        // 重新编号侧边栏和卡片
        this.reindexVulnItems(field);
        
        // 如果还有漏洞，选中第一个
        if (this.formData[field.key].length > 0) {
            this.selectVulnItem(field, 0);
        } else {
            // 显示空状态
            const emptyTip = document.getElementById(`${field.key}_empty`);
            if (emptyTip) emptyTip.style.display = 'block';
        }
        
        // 更新漏洞统计
        this.updateVulnCounts();
        // 更新报告总结（护网报告）
        this.updateReportConclusion();
    },

    // 重新编号漏洞项
    reindexVulnItems(field) {
        const sidebarList = document.getElementById(`${field.key}_sidebar_list`);
        const listWrapper = document.getElementById(`${field.key}_list`);
        
        if (sidebarList) {
            const items = sidebarList.querySelectorAll('.vuln-sidebar-item');
            items.forEach((item, idx) => {
                item.id = `${field.key}_sidebar_item_${idx}`;
                item.dataset.index = idx;
                item.onclick = () => this.selectVulnItem(field, idx);
                const nameSpan = item.querySelector('.vuln-sidebar-name');
                if (nameSpan) {
                    const vulnName = this.formData[field.key][idx]?.vuln_name;
                    nameSpan.textContent = vulnName || `漏洞 ${idx + 1}`;
                }
            });
        }
        
        if (listWrapper) {
            const cards = listWrapper.querySelectorAll('.vuln-item-card');
            cards.forEach((card, idx) => {
                card.id = `${field.key}_card_${idx}`;
                card.dataset.index = idx;
                const badge = card.querySelector('.vuln-index-badge');
                if (badge) badge.textContent = `漏洞 ${idx + 1}`;
                
                // Update IDs of inputs inside the card to match the new index
                // This is critical for fillVulnItemFromLibrary which uses IDs
                const inputs = card.querySelectorAll('input, select, textarea, div[id*="_evidence_preview"]');
                inputs.forEach(el => {
                    if (el.id) {
                        // Replace the index segment in the ID: fieldKey_OLDINDEX_suffix -> fieldKey_NEWINDEX_suffix
                        // Regex looks for: ^fieldKey_(\d+)_
                        const prefixRegex = new RegExp(`^${field.key}_\\d+_`);
                        if (prefixRegex.test(el.id)) {
                             el.id = el.id.replace(prefixRegex, `${field.key}_${idx}_`);
                        }
                    }
                });
            });
        }
    },

    // 创建漏洞字段
    createVulnField(label, type, field, vulnIndex, key, vulnData, options = {}) {
        const wrapper = document.createElement('div');
        const labelEl = document.createElement('label');
        labelEl.textContent = label;
        labelEl.style.cssText = 'display: block; margin-bottom: 5px; font-weight: 500;';
        wrapper.appendChild(labelEl);
        
        let input;
        const fieldId = `${field.key}_${vulnIndex}_${key}`;
        
        if (type === 'select') {
            input = document.createElement('select');
            input.style.cssText = 'width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;';
            if (options.options) {
                options.options.forEach(opt => {
                    const option = document.createElement('option');
                    option.value = opt.value;
                    option.textContent = opt.label;
                    if (opt.value === vulnData[key]) option.selected = true;
                    input.appendChild(option);
                });
            }
            input.addEventListener('change', (e) => {
                vulnData[key] = e.target.value;
                this.updateVulnCounts();
                this.updateReportConclusion();
            });
        } else if (type === 'textarea') {
            input = document.createElement('textarea');
            input.rows = options.rows || 3;
            input.placeholder = options.placeholder || '';
            input.style.cssText = 'width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; resize: vertical;';
            input.value = vulnData[key] || '';
            input.addEventListener('input', (e) => {
                vulnData[key] = e.target.value;
                // URL/IP 字段变化时更新漏洞统计
                if (key === 'vuln_url') {
                    this.updateVulnCounts();
                    this.updateReportConclusion();
                }
                // 所属系统变化时更新报告总结
                if (key === 'vuln_system') {
                    this.updateReportConclusion();
                }
            });
        } else {
            input = document.createElement('input');
            input.type = 'text';
            input.placeholder = options.placeholder || '';
            input.style.cssText = 'width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;';
            input.value = vulnData[key] || '';
            input.addEventListener('input', (e) => { vulnData[key] = e.target.value; });
        }
        
        input.id = fieldId;
        wrapper.appendChild(input);
        return wrapper;
    },

    // 创建漏洞举证上传器
    createVulnEvidenceUploader(field, vulnIndex, vulnData) {
        const wrapper = document.createElement('div');
        
        const labelRow = document.createElement('div');
        labelRow.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;';
        
        const label = document.createElement('label');
        label.textContent = '漏洞举证截图';
        label.style.cssText = 'font-weight: 500;';
        labelRow.appendChild(label);
        
        const pasteBtn = document.createElement('button');
        pasteBtn.type = 'button';
        pasteBtn.className = 'btn-mini';
        pasteBtn.textContent = '粘贴截图';
        labelRow.appendChild(pasteBtn);
        wrapper.appendChild(labelRow);
        
        const uploadArea = document.createElement('div');
        uploadArea.style.cssText = 'border: 2px dashed #ddd; border-radius: 8px; padding: 20px; text-align: center; cursor: pointer; background: #fff;';
        uploadArea.innerHTML = '<span style="color: #999;">点击上传或拖拽图片</span>';
        wrapper.appendChild(uploadArea);
        
        const previewContainer = document.createElement('div');
        previewContainer.id = `${field.key}_${vulnIndex}_evidence_preview`;
        previewContainer.style.cssText = 'margin-top: 10px;';
        wrapper.appendChild(previewContainer);
        
        if (!vulnData.vuln_evidence) vulnData.vuln_evidence = [];
        
        const self = this;
        uploadArea.onclick = () => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            input.multiple = true;
            input.onchange = async (e) => {
                for (const file of e.target.files) {
                    const result = await self.uploadImage(file);
                    if (result) self.addVulnEvidenceItem(vulnData, result, previewContainer);
                }
            };
            input.click();
        };
        
        pasteBtn.onclick = async (e) => {
            e.preventDefault();
            try {
                const items = await navigator.clipboard.read();
                for (const item of items) {
                    const imgType = item.types.find(t => t.startsWith('image/'));
                    if (imgType) {
                        const blob = await item.getType(imgType);
                        const result = await self.uploadImage(blob);
                        if (result) self.addVulnEvidenceItem(vulnData, result, previewContainer);
                    }
                }
            } catch (err) {
                if (window.AppUtils) AppUtils.showToast("无法读取剪贴板", "error");
            }
        };
        
        return wrapper;
    },

    // 添加漏洞举证图片
    addVulnEvidenceItem(vulnData, imageInfo, container) {
        const fullUrl = `${window.AppAPI.BASE_URL}${imageInfo.url}`;
        
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'display: flex; gap: 10px; margin-bottom: 10px; padding: 10px; background: #f9f9f9; border: 1px solid #eee; border-radius: 4px;';
        
        const img = document.createElement('img');
        img.src = fullUrl;
        img.style.cssText = 'max-width: 150px; max-height: 100px; border: 1px solid #ccc; cursor: zoom-in;';
        img.onclick = () => this.openImagePreview(img.src, '漏洞举证');
        wrapper.appendChild(img);
        
        const textarea = document.createElement('textarea');
        textarea.rows = 2;
        textarea.placeholder = '截图说明';
        textarea.style.cssText = 'flex: 1; padding: 6px; border: 1px solid #ddd; border-radius: 4px;';
        wrapper.appendChild(textarea);
        
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.textContent = '删除';
        delBtn.style.cssText = 'background: #ff4d4f; color: white; border: none; padding: 5px 10px; cursor: pointer; border-radius: 4px;';
        wrapper.appendChild(delBtn);
        
        const evidenceObj = { path: imageInfo.file_path, description: '' };
        vulnData.vuln_evidence.push(evidenceObj);
        
        textarea.addEventListener('input', (e) => { evidenceObj.description = e.target.value; });
        delBtn.onclick = () => {
            wrapper.remove();
            const idx = vulnData.vuln_evidence.indexOf(evidenceObj);
            if (idx > -1) vulnData.vuln_evidence.splice(idx, 1);
        };
        
        container.appendChild(wrapper);
    },

    // 从漏洞库填充漏洞详情
    fillVulnItemFromLibrary(field, vulnIndex, vulnData, libraryData) {
        // 填充数据到 vulnData 对象
        vulnData.vuln_name = libraryData.Vuln_Name || libraryData.name || '';
        vulnData.vuln_level = libraryData.Risk_Level || libraryData.level || '中危';
        vulnData.vuln_description = libraryData.Vuln_Description || libraryData.description || '';
        vulnData.vuln_suggestion = libraryData.Repair_suggestions || libraryData.suggestion || '';
        
        // 更新表单字段 DOM
        const prefix = `${field.key}_${vulnIndex}`;
        
        // 更新漏洞级别
        const levelSelect = document.getElementById(`${prefix}_vuln_level`);
        if (levelSelect) {
            levelSelect.value = vulnData.vuln_level;
            // 触发 change 事件以更新侧边栏颜色
            levelSelect.dispatchEvent(new Event('change'));
        }
        
        // 更新漏洞描述
        const descTextarea = document.getElementById(`${prefix}_vuln_description`);
        if (descTextarea) descTextarea.value = vulnData.vuln_description;
        
        // 更新修复建议
        const suggTextarea = document.getElementById(`${prefix}_vuln_suggestion`);
        if (suggTextarea) suggTextarea.value = vulnData.vuln_suggestion;
        
        // 更新侧边栏显示名称
        this.updateVulnSidebarItem(field, vulnIndex, vulnData);
        
        // 更新漏洞统计
        this.updateVulnCounts();
    },

    // 更新侧边栏项显示
    updateVulnSidebarItem(field, vulnIndex, vulnData) {
        const sidebarItem = document.getElementById(`${field.key}_sidebar_item_${vulnIndex}`);
        if (!sidebarItem) return;
        
        const levelColors = (window.AppConfig && window.AppConfig.THEME && window.AppConfig.THEME.RISK_COLORS) 
            || { '超危': '#8B0000', '高危': '#dc3545', '中危': '#fd7e14', '低危': '#28a745', '信息性': '#17a2b8' };
        
        // 更新名称
        const nameSpan = sidebarItem.querySelector('.vuln-sidebar-name');
        if (nameSpan) {
            nameSpan.textContent = vulnData.vuln_name || `漏洞 ${vulnIndex + 1}`;
            nameSpan.title = vulnData.vuln_name || '';
        }
        
        // 更新风险等级颜色
        const levelDot = sidebarItem.querySelector('.vuln-level-dot');
        if (levelDot) {
            levelDot.style.background = levelColors[vulnData.vuln_level] || '#fd7e14';
        }
    },

    // 更新漏洞统计数量
    // 根据每个漏洞的 URL/IP 行数计算漏洞数量（多个URL算多个漏洞）
    updateVulnCounts() {
        const vulnDetails = this.formData['vuln_details'] || [];
        let critical = 0, high = 0, medium = 0, low = 0, total = 0;
        
        vulnDetails.forEach(v => {
            const level = v.vuln_level || '中危';
            // 计算 URL/IP 的有效行数（过滤空行）
            const urlLines = (v.vuln_url || '').split('\n').filter(line => line.trim()).length;
            // 至少算1个漏洞
            const count = Math.max(1, urlLines);
            
            if (level === '超危') critical += count;
            else if (level === '高危') high += count;
            else if (level === '中危') medium += count;
            else if (level === '低危') low += count;
            
            total += count;
        });
        
        this.setFieldValue('vuln_count_critical', String(critical));
        this.setFieldValue('vuln_count_high', String(high));
        this.setFieldValue('vuln_count_medium', String(medium));
        this.setFieldValue('vuln_count_low', String(low));
        this.setFieldValue('vuln_count_total', String(total));
        
        const vulnNames = vulnDetails.map(v => v.vuln_name).filter(n => n);
        if (vulnNames.length > 0) {
            this.setFieldValue('vuln_list_summary', vulnNames.join('、') + '等漏洞');
        }
        
        // 自动更新综合风险评级
        this.autoCalculateRiskLevel();
    }
};

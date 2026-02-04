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
            const res = await fetch(window.AppAPI.BASE_URL + '/api/templates');
            const data = await res.json();
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
            const res = await fetch(window.AppAPI.BASE_URL + '/api/templates/reload', { method: 'POST' });
            const result = await res.json();
            
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
            const schemaRes = await fetch(window.AppAPI.BASE_URL + '/api/templates/' + templateId + '/schema');
            if (!schemaRes.ok) throw new Error('Template not found: ' + templateId);
            const schema = await schemaRes.json();
            
            // 使用缓存加载数据源
            const cacheKey = `datasource_${templateId}`;
            let dataSources = this.getCachedData(cacheKey);
            if (!dataSources) {
                const dsRes = await fetch(window.AppAPI.BASE_URL + '/api/templates/' + templateId + '/data-sources');
                if (dsRes.ok) {
                    dataSources = await dsRes.json();
                    this.setCachedData(cacheKey, dataSources);
                }
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
            if (beh.trigger && beh.trigger.field) this.behaviors[beh.trigger.field] = beh;
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
        if (field.type === 'hidden') {
            const h = document.createElement('input');
            h.type = 'hidden'; h.id = field.key; h.name = field.key;
            return h;
        }
        const wrapper = document.createElement('div');
        // 图片字段、文本域、复选框组、测试目标列表、测试人员信息列表、漏洞列表占整行
        const isWideField = field.type === 'textarea' || field.type === 'image' || field.type === 'image_list' || field.type === 'checkbox_group' || field.type === 'target_list' || field.type === 'tester_info_list' || field.type === 'vuln_list';
        wrapper.className = (isWideField ? 'col-12' : 'col-4') + ' form-group';
        
        const label = document.createElement('label');
        label.setAttribute('for', field.key);
        label.innerHTML = field.label + (field.required ? ' <span style="color:red">*</span>' : '');
        
        let pasteBtn = null;
        
        // 对于图片字段，添加粘贴按钮到标签行
        if ((field.type === 'image' || field.type === 'image_list') && field.paste_enabled) {
            const labelRow = document.createElement('div');
            labelRow.style.cssText = 'display: flex; align-items: center; justify-content: space-between; margin-bottom: 5px;';
            labelRow.appendChild(label);
            
            pasteBtn = document.createElement('button');
            pasteBtn.type = 'button';
            pasteBtn.className = 'btn-mini';
            pasteBtn.id = `btn-paste-${field.key}`;
            pasteBtn.innerText = '粘贴截图';
            labelRow.appendChild(pasteBtn);
            
            wrapper.appendChild(labelRow);
        } else {
            wrapper.appendChild(label);
        }
        
        const input = this.createInput(field, pasteBtn);
        if (input) wrapper.appendChild(input);
        return wrapper;
    },

    createInput(field, pasteBtn = null) {
        let el;
        if (field.type === 'searchable_select') {
            // 可搜索下拉框
            el = this.createSearchableSelect(field);
        } else if (field.type === 'select') {
            el = document.createElement('select');
            const empty = document.createElement('option');
            empty.value = ''; empty.textContent = '-- 请选择 --';
            el.appendChild(empty);
            if (field.options) field.options.forEach(o => {
                const opt = document.createElement('option');
                opt.value = typeof o === 'object' ? o.value : o;
                opt.textContent = typeof o === 'object' ? (o.label||o.value) : o;
                el.appendChild(opt);
            });
            if (field.source) el.dataset.source = field.source;
            el.addEventListener('change', e => {
                this.formData[field.key] = e.target.value;
                this.handleChange(field, e.target.value);
                // 处理 presets 自动填充
                if (field.presets && field.presets[e.target.value]) {
                    this.applyPresets(field.presets[e.target.value]);
                }
            });
        } else if (field.type === 'checkbox_group') {
            // 多选复选框组
            el = this.createCheckboxGroup(field);
        } else if (field.type === 'checkbox') {
            // 单个复选框（开关）
            el = this.createCheckbox(field);
        } else if (field.type === 'textarea') {
            el = document.createElement('textarea');
            el.rows = field.rows || 4;
            el.placeholder = field.placeholder || '';
            el.addEventListener('input', e => { this.formData[field.key] = e.target.value; });
        } else if (field.type === 'image') {
            // 单图片上传
            el = this.createImageUploader(field, false, pasteBtn);
        } else if (field.type === 'image_list') {
            // 多图片上传
            el = this.createImageUploader(field, true, pasteBtn);
        } else if (field.type === 'target_list') {
            // 测试目标列表
            el = this.createTargetList(field);
        } else if (field.type === 'tester_info_list') {
            // 测试人员信息列表
            el = this.createTesterInfoList(field);
        } else if (field.type === 'vuln_list') {
            // 漏洞详情列表
            el = this.createVulnList(field);
        } else {
            el = document.createElement('input');
            el.type = 'text';
            el.placeholder = field.placeholder || '';
            
            // 设置初始值
            let initialValue = '';
            
            // 处理自动生成字段 (兼容布尔值和字符串 "true")
            const shouldAutoGenerate = field.auto_generate === true || field.auto_generate === 'true';
            if (shouldAutoGenerate && field.auto_generate_rule) {
                initialValue = this.generateAutoValue(field.auto_generate_rule);
            } else if (field.default === 'today') {
                initialValue = new Date().toISOString().split('T')[0];
            } else if (field.default) {
                initialValue = field.default;
            }
            
            if (initialValue) {
                el.value = initialValue;
                this.formData[field.key] = initialValue;
            }
            
            el.addEventListener('input', e => { this.formData[field.key] = e.target.value; this.handleChange(field, e.target.value); });
            
            // 对 URL 类型字段添加 blur 事件监听（用于 ICP 查询）
            if (field.key === 'url' || field.on_change === 'resolve_url') {
                el.addEventListener('blur', async (e) => {
                    const urlValue = e.target.value.trim();
                    if (!urlValue) return;
                    await this.handleUrlProcess(urlValue);
                });
            }
        }
        // checkbox_group 类型内部已设置正确的 id，不要覆盖
        if (el.tagName && field.type !== 'checkbox_group') {
            el.id = field.key; 
            el.name = field.key;
        }
        if (field.readonly && el.tagName === 'INPUT') { el.readOnly = true; el.style.background = '#eee'; }
        return el;
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
            const res = await fetch(`${window.AppAPI.BASE_URL}/api/vulnerability/${vulnId}`);
            if (res.ok) {
                const data = await res.json();
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
            }
        } catch (e) {
            console.error('[FormRenderer] Fill vuln details error:', e);
        }
    },
    
    // 创建图片上传组件
    createImageUploader(field, multiple, pasteBtn = null) {
        const container = document.createElement('div');
        container.className = 'image-upload-container';
        container.id = field.key;
        
        // 上传区域
        const uploadArea = document.createElement('div');
        uploadArea.className = 'upload-area';
        uploadArea.id = `${field.key}-upload-area`;
        uploadArea.innerHTML = `
            <span class="upload-icon">📷</span>
            <p>${field.help_text || (multiple ? '点击上传或粘贴截图' : '点击上传或粘贴截图')}</p>
        `;
        container.appendChild(uploadArea);
        
        // 预览容器
        const previewContainer = document.createElement('div');
        previewContainer.className = multiple ? 'image-list-container' : 'preview-container';
        previewContainer.id = `${field.key}-preview`;
        container.appendChild(previewContainer);
        
        // 隐藏字段存储路径
        const hiddenInput = document.createElement('input');
        hiddenInput.type = 'hidden';
        hiddenInput.id = `${field.key}_path`;
        hiddenInput.name = `${field.key}_path`;
        container.appendChild(hiddenInput);
        
        // 初始化数据存储
        if (multiple) {
            this.formData[field.key] = [];
        } else {
            this.formData[field.key] = '';
        }
        
        // 绑定上传事件（传入粘贴按钮引用）
        this.bindImageUploadEvents(field, uploadArea, previewContainer, multiple, pasteBtn);
        
        return container;
    },
    
    // 绑定图片上传事件
    bindImageUploadEvents(field, uploadArea, previewContainer, multiple, pasteBtn = null) {
        const self = this;
        
        // 确保预览模态框存在
        this.ensurePreviewModal();
        
        // 点击上传
        uploadArea.addEventListener('click', (e) => {
            if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return;
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = field.accept || 'image/*';
            input.onchange = async (ev) => {
                const file = ev.target.files[0];
                if (file) {
                    const result = await self.uploadImage(file);
                    if (result) self.addImageItem(field, result, previewContainer, multiple);
                }
            };
            input.click();
        });
        
        // 粘贴按钮 - 直接使用传入的按钮引用
        if (pasteBtn) {
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
                            if (result) self.addImageItem(field, result, previewContainer, multiple);
                            if (!multiple) break;
                        }
                    }
                    if (!found && window.AppUtils) {
                        AppUtils.showToast("剪贴板中未发现图片", "info");
                    }
                } catch (err) {
                    if (window.AppUtils) AppUtils.showToast("无法读取剪贴板", "error");
                }
            };
        }
    },
    
    // 上传图片到服务器
    async uploadImage(file) {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const res = await fetch(`${window.AppAPI.BASE_URL}/api/upload-image`, {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({
                            image_base64: e.target.result,
                            filename: file.name || `screenshot_${Date.now()}.png`
                        })
                    });
                    const data = await res.json();
                    resolve(data.file_path ? data : null);
                } catch (err) {
                    if (window.AppUtils) AppUtils.showToast("上传失败: " + err.message, "error");
                    resolve(null);
                }
            };
            reader.readAsDataURL(file);
        });
    },
    
    // 添加图片项到预览
    addImageItem(field, imageInfo, container, multiple) {
        const fullUrl = `${window.AppAPI.BASE_URL}${imageInfo.url}`;
        const self = this;
        
        if (multiple) {
            // 多图模式
            const wrapper = document.createElement('div');
            wrapper.className = 'evidence-item';
            wrapper.style.cssText = "display:flex; gap:15px; margin-bottom:15px; padding:10px; background:#f9f9f9; border:1px solid #eee; align-items:start;";
            
            const imgBox = document.createElement('div');
            const img = document.createElement('img');
            img.src = fullUrl;
            img.style.cssText = "max-width:200px; max-height:150px; border:1px solid #ccc; display:block; cursor: zoom-in;";
            imgBox.appendChild(img);
            
            const infoBox = document.createElement('div');
            infoBox.style.cssText = "flex:1; display:flex; flex-direction:column;";
            
            const label = document.createElement('label');
            label.innerText = field.description_placeholder ? "图片说明:" : "图片说明/复现步骤:";
            label.style.marginBottom = "5px";
            
            const textarea = document.createElement('textarea');
            textarea.rows = 4;
            textarea.style.cssText = "width:100%; border:1px solid #ccc; padding:5px;";
            textarea.placeholder = field.description_placeholder || "请输入此截图的说明文字...";
            
            const delBtn = document.createElement('button');
            delBtn.type = 'button';
            delBtn.innerText = "删除";
            delBtn.style.cssText = "margin-top:25px; align-self:flex-start; background:#ff4d4f; color:white; border:none; padding:6px 12px; cursor:pointer; border-radius:4px;";
            
            // 创建数据对象
            const evidenceObj = { path: imageInfo.file_path, description: "" };
            if (!Array.isArray(this.formData[field.key])) {
                this.formData[field.key] = [];
            }
            this.formData[field.key].push(evidenceObj);
            
            textarea.addEventListener('input', (e) => { evidenceObj.description = e.target.value; });
            
            delBtn.addEventListener('click', () => {
                wrapper.remove();
                const idx = this.formData[field.key].indexOf(evidenceObj);
                if (idx > -1) this.formData[field.key].splice(idx, 1);
            });
            
            img.onclick = () => this.openImagePreview(img.src, textarea.value || "截图预览");
            
            infoBox.appendChild(label);
            infoBox.appendChild(textarea);
            
            wrapper.appendChild(imgBox);
            wrapper.appendChild(infoBox);
            wrapper.appendChild(delBtn);
            
            container.appendChild(wrapper);
            
        } else {
            // 单图模式
            container.innerHTML = '';
            const thumbWrapper = document.createElement('div');
            thumbWrapper.style.cssText = "display:inline-block; position:relative; margin-top:5px;";
            
            const img = document.createElement('img');
            img.src = fullUrl;
            img.style.cssText = "height:120px; width:auto; border:1px solid #ccc; padding:2px; border-radius:4px; box-shadow:0 2px 4px rgba(0,0,0,0.1); cursor:zoom-in;";
            img.onclick = () => this.openImagePreview(img.src, field.label || "图片预览");
            
            thumbWrapper.appendChild(img);
            container.appendChild(thumbWrapper);
            
            // 存储路径
            this.formData[field.key] = imageInfo.file_path;
            const hiddenInput = document.getElementById(`${field.key}_path`);
            if (hiddenInput) hiddenInput.value = imageInfo.file_path;
        }
    },
    
    // 确保预览模态框存在
    ensurePreviewModal() {
        if (document.getElementById('form-image-preview-modal')) return;
        
        const modal = document.createElement('div');
        modal.id = 'form-image-preview-modal';
        const modalZIndex = (window.AppConfig && window.AppConfig.Z_INDEX && window.AppConfig.Z_INDEX.MODAL) || 2000;
        modal.style.cssText = `display: none; position: fixed; z-index: ${modalZIndex}; left: 0; top: 0; width: 100%; height: 100%; background-color: rgba(0,0,0,0.85); align-items: center; justify-content: center; flex-direction: column; opacity: 0; transition: opacity 0.3s ease;`;
        
        modal.onclick = (e) => {
            if (e.target === modal) this.closeImagePreview();
        };

        const img = document.createElement('img');
        img.style.cssText = "max-width: 90%; max-height: 85vh; border: 2px solid #fff; box-shadow: 0 0 20px rgba(0,0,0,0.5); object-fit: contain; transform: scale(0.9); transition: transform 0.3s ease;";
        
        const closeBtn = document.createElement('span');
        closeBtn.innerHTML = "&times;";
        closeBtn.style.cssText = "position: absolute; top: 20px; right: 30px; font-size: 40px; color: #fff; cursor: pointer; font-weight: bold; text-shadow: 0 2px 4px rgba(0,0,0,0.5);";
        closeBtn.onclick = () => this.closeImagePreview();
        
        const caption = document.createElement('div');
        caption.style.cssText = "margin-top: 15px; color: #fff; font-size: 16px; max-width: 80%; text-align: center; text-shadow: 0 1px 2px rgba(0,0,0,0.8);";

        modal.appendChild(closeBtn);
        modal.appendChild(img);
        modal.appendChild(caption);
        document.body.appendChild(modal);
    },
    
    openImagePreview(src, text) {
        const modal = document.getElementById('form-image-preview-modal');
        if (!modal) return;
        const img = modal.querySelector('img');
        const cap = modal.querySelector('div:last-child');
        
        img.src = src;
        cap.innerText = text || "";
        modal.style.display = 'flex';
        modal.offsetHeight; // force reflow
        modal.style.opacity = '1';
        img.style.transform = 'scale(1)';
    },
    
    closeImagePreview() {
        const modal = document.getElementById('form-image-preview-modal');
        if (!modal) return;
        modal.style.opacity = '0';
        setTimeout(() => modal.style.display = 'none', 300);
    },
    
    // 处理 URL 自动解析（ICP 查询）
    async handleUrlProcess(url) {
        try {
            const res = await fetch(window.AppAPI.BASE_URL + '/api/process-url', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: url })
            });
            
            if (!res.ok) return;
            
            const data = await res.json();
            
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

    handleChange(field, value) {
        if (this.currentSchema) {
            this.currentSchema.fields.forEach(f => {
                if (f.computed && f.compute_from === field.key && f.compute_rule) {
                    this.setFieldValue(f.key, f.compute_rule[value] || '');
                }
            });
        }
        const beh = this.behaviors[field.key];
        if (beh && beh.actions) this.runActions(beh.actions, value);
        
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
                    let ep = a.endpoint.replace(/\${(\w+)}/g, (_, k) => this.formData[k] || '');
                    const res = await fetch(window.AppAPI.BASE_URL + ep);
                    if (res.ok && a.result_mapping) {
                        const data = await res.json();
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
        });
        return {valid: errors.length === 0, errors};
    },

    setFieldValue(key, value) {
        this.formData[key] = value;
        const el = document.getElementById(key);
        if (el) { el.value = value; el.dispatchEvent(new Event('change', {bubbles:true})); }
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
        
        // 如果动态表单没有图片数据，尝试从旧的 AppImage 模块获取（向后兼容）
        if (window.AppImage) {
            if (!data.vuln_evidence_images || data.vuln_evidence_images.length === 0) {
                data.vuln_evidence_images = window.AppImage.vulnEvidenceList || [];
            }
            if (!data.icp_screenshot_path) {
                data.icp_screenshot_path = window.AppImage.icpScreenshotPath || '';
            }
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
            const res = await fetch(window.AppAPI.BASE_URL + '/api/templates/' + tid + '/generate', {
                method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data)
            });
            const result = await res.json();
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
            const res = await fetch(`${window.AppAPI.BASE_URL}/api/vulnerabilities`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(vulnData)
            });
            if (res.ok) {
                if (window.AppUtils) AppUtils.showToast("已添加到漏洞库", "success");
                if (window.AppVulnManager) await AppVulnManager.loadVulnerabilities();
            } else {
                const r = await res.json();
                if (window.AppUtils) AppUtils.showToast("添加失败: " + r.detail, "error");
            }
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
                if (el) {
                    if (f.type === 'image' || f.type === 'image_list') {
                        // 清空图片预览
                        const preview = document.getElementById(`${f.key}-preview`);
                        if (preview) preview.innerHTML = '';
                        // 重置图片数据
                        if (f.type === 'image_list') {
                            this.formData[f.key] = [];
                        } else {
                            this.formData[f.key] = '';
                        }
                    } else if (el.tagName === 'SELECT') {
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
        
        // 清空旧的 AppImage 模块数据（向后兼容）
        if (window.AppImage) {
            window.AppImage.icpScreenshotPath = null;
            window.AppImage.vulnEvidenceList = [];
        }
        
        if (window.AppUtils) AppUtils.showToast('表单已重置', 'info');
    },
    
    // 打开报告目录
    openReportFolder() {
        if (window.lastReportPath) {
            if (window.AppAPI && window.AppAPI.openFolder) {
                window.AppAPI.openFolder(window.lastReportPath);
            } else {
                // 尝试通过 API 打开
                fetch(`${window.AppAPI.BASE_URL}/api/open-folder`, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ path: window.lastReportPath })
                }).catch(e => {
                    console.error('Open folder failed:', e);
                    if (window.AppUtils) AppUtils.showToast('打开目录失败', 'error');
                });
            }
        } else {
            // 打开默认输出目录
            if (window.AppAPI && window.AppAPI.openFolder) {
                window.AppAPI.openFolder('output/report');
            } else {
                fetch(`${window.AppAPI.BASE_URL}/api/open-folder`, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ path: 'output/report' })
                }).catch(e => {
                    console.error('Open folder failed:', e);
                    if (window.AppUtils) AppUtils.showToast('打开目录失败', 'error');
                });
            }
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
            
            const res = await fetch(window.AppAPI.BASE_URL + '/api/templates/import', {
                method: 'POST',
                body: formData
            });
            
            // 6. 处理响应
            if (!res.ok) {
                const error = await res.json();
                throw new Error(error.detail || error.message || '导入失败');
            }
            
            const result = await res.json();
            
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
            
            const res = await fetch(window.AppAPI.BASE_URL + '/api/templates/' + tid, {
                method: 'DELETE'
            });
            
            const result = await res.json();
            
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
                    const res = await fetch(`${window.AppAPI.BASE_URL}/api/vulnerability/${encodeURIComponent(vulnId)}`);
                    if (res.ok) {
                        const vData = await res.json();
                        if (vData && !vData.error) {
                            this.fillVulnItemFromLibrary(field, currentIdx, vulnData, vData);
                        }
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
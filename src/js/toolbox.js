// toolbox.js - 工具箱与报告合并逻辑 (重构版 - 使用CRUDManager)

window.AppToolbox = {
    ALL_REPORTS: [],
    SELECTED_REPORTS: [],
    ICP_LIST: [],
    ICP_SELECTED_IDS: [],
    crud: null,  // CRUD管理器

    init() {
        // 初始化CRUD管理器
        this.crud = new CRUDManager(
            window.AppAPI.Reports,
            (items) => { this.ALL_REPORTS = items; this.renderUI(); },
            () => window.AppAPI.Reports.list()
        );
        
        this.cacheDom();
        this.bindEvents();
    },

    cacheDom() {
        this.modal = document.getElementById('toolbox-modal');
        this.sourceList = document.getElementById('merge-source-list');
        this.selectedList = document.getElementById('merge-selected-list');
    },

    bindEvents() {
        const tabItems = document.querySelectorAll('.toolbox-nav-item');
        tabItems.forEach(item => {
            item.addEventListener('click', () => {
                tabItems.forEach(i => i.classList.remove('active'));
                item.classList.add('active');
                
                const targetId = item.getAttribute('data-target');
                document.querySelectorAll('.toolbox-view').forEach(view => view.classList.remove('active'));
                document.getElementById(targetId).classList.add('active');

                if (targetId === 'view-merge') {
                    this.loadReportFiles();
                    this.generateMergeFilename();
                }
                if (targetId === 'view-vuln-lib') {
                    window.AppVulnManager.loadVulnerabilities();
                    window.AppVulnManager.resetForm();
                }
                if (targetId === 'view-icp-cache') this.loadIcpList();
                if (targetId === 'view-template') {
                    // Load template list for management
                    if (window.AppTemplateManager) {
                        window.AppTemplateManager.loadTemplateListForManagement();
                    }
                }
            });
        });

        const btnOpen = document.getElementById('btn-open-toolbox');
        if (btnOpen) btnOpen.addEventListener('click', () => {
            if(this.modal) {
                this.modal.style.display = 'block';
                document.body.style.overflow = 'hidden'; // 防止背景滚动
                const activeTab = document.querySelector('.toolbox-nav-item.active');
                if(activeTab) activeTab.click();
            }
        });

        document.querySelectorAll('.close-toolbox').forEach(el => el.onclick = () => {
             this.modal.style.display = "none";
             document.body.style.overflow = ''; // 恢复背景滚动
        });

        const btnRefresh = document.getElementById('btn-refresh-reports');
        if(btnRefresh) btnRefresh.addEventListener('click', () => this.loadReportFiles());

        const btnDelete = document.getElementById('btn-batch-delete');
        if(btnDelete) btnDelete.addEventListener('click', () => this.batchDelete());

        const btnMerge = document.getElementById('btn-start-merge');
        if(btnMerge) btnMerge.addEventListener('click', () => this.startMerge());

        const btnBackup = document.getElementById('btn-backup-db');
        if(btnBackup) btnBackup.addEventListener('click', () => this.downloadBackup());

        const checkAll = document.getElementById('check-all-reports');
        if(checkAll) {
            checkAll.addEventListener('change', (e) => {
                if (e.target.checked) this.SELECTED_REPORTS = this.ALL_REPORTS.map(i => i.path);
                else this.SELECTED_REPORTS = [];
                this.renderUI();
            });
        }
        
        const icpSearch = document.getElementById('icp-search');
        if(icpSearch) {
            icpSearch.addEventListener('input', (e) => this.renderIcpList(e.target.value));
        }

        const btnClear = document.getElementById('btn-clear-selection');
        if(btnClear) btnClear.addEventListener('click', () => {
             this.SELECTED_REPORTS = [];
             this.renderUI();
        });

        const btnIcpAdd = document.getElementById('btn-icp-add');
        if(btnIcpAdd) btnIcpAdd.addEventListener('click', () => this.openIcpModal());

        const btnIcpBatchDel = document.getElementById('btn-icp-batch-delete');
        if(btnIcpBatchDel) btnIcpBatchDel.addEventListener('click', () => this.batchDeleteIcp());

        const icpForm = document.getElementById('icp-form');
        if(icpForm) {
            icpForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.saveIcpEntry();
            });
        }
    },

    generateMergeFilename() {
        const now = new Date();
        const ts = now.getFullYear() + 
                   String(now.getMonth() + 1).padStart(2, '0') + 
                   String(now.getDate()).padStart(2, '0') + "_" + 
                   String(now.getHours()).padStart(2, '0') + 
                   String(now.getMinutes()).padStart(2, '0') + 
                   String(now.getSeconds()).padStart(2, '0');
        const fInput = document.getElementById('merge-filename');
        if (fInput) fInput.value = `Merged_Report_${ts}`;
    },

    async loadReportFiles() {
        if(!this.sourceList) return;
        this.sourceList.innerHTML = '<div>Loading...</div>';
        try {
            // 使用CRUD管理器加载
            this.ALL_REPORTS = await this.crud.load();
            // sync selection
            this.SELECTED_REPORTS = this.SELECTED_REPORTS.filter(p => this.ALL_REPORTS.find(r => r.path === p));
            this.renderUI();
        } catch(e) {
            this.sourceList.innerHTML = `<div style="color:red">Error: ${e.message}</div>`;
        }
    },

    renderUI() {
        this.renderSourceList();
        this.renderSelectedReports();
    },

    renderSourceList() {
        this.sourceList.innerHTML = '';
        const checkAll = document.getElementById('check-all-reports');
        const btnBatchDelete = document.getElementById('btn-batch-delete');

        if (checkAll) checkAll.checked = this.ALL_REPORTS.length > 0 && this.SELECTED_REPORTS.length === this.ALL_REPORTS.length;
        if (btnBatchDelete) btnBatchDelete.style.display = this.SELECTED_REPORTS.length > 0 ? 'inline-flex' : 'none';

        if (this.ALL_REPORTS.length === 0) {
            this.sourceList.innerHTML = '<div class="empty-state"><p>No reports found</p></div>';
            return;
        }

        this.ALL_REPORTS.forEach(item => {
            const row = document.createElement('div');
            row.className = "report-list-item";
            
            const checkSpan = document.createElement('span');
            checkSpan.className = "col-check";
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = this.SELECTED_REPORTS.includes(item.path);
            cb.onchange = (e) => {
                if(e.target.checked) this.SELECTED_REPORTS.push(item.path);
                else {
                    const idx = this.SELECTED_REPORTS.indexOf(item.path);
                    if(idx > -1) this.SELECTED_REPORTS.splice(idx, 1);
                }
                this.renderUI();
            };
            checkSpan.appendChild(cb);

            const nameSpan = document.createElement('span');
            nameSpan.className = "col-name";
            nameSpan.innerText = item.name;
            nameSpan.title = item.name;

            const dateSpan = document.createElement('span');
            dateSpan.className = "col-date";
            dateSpan.innerText = item.date || "-";
            dateSpan.style.textAlign = "center";
            dateSpan.style.fontSize = "12px";
            dateSpan.style.color = "#999";

            const dirSpan = document.createElement('span');
            dirSpan.className = "col-dir";
            dirSpan.innerText = item.folder || "-";
            dirSpan.style.textAlign = "center";
            dirSpan.style.fontSize = "12px";
            dirSpan.style.color = "#999";

            const actionSpan = document.createElement('span');
            actionSpan.className = "col-action";
            const delBtn = document.createElement('button');
            delBtn.className = "btn-icon-danger";
            delBtn.innerHTML = "🗑️";
            delBtn.onclick = async (e) => {
                e.stopPropagation();
                if(await AppUtils.safeConfirm(`删除 ${item.name}?`)) {
                    await this.deleteReport(item.path);
                }
            };
            actionSpan.appendChild(delBtn);

            row.appendChild(checkSpan);
            row.appendChild(nameSpan);
            row.appendChild(dateSpan);
            row.appendChild(dirSpan);
            row.appendChild(actionSpan);
            this.sourceList.appendChild(row);
        });
    },

    renderSelectedReports() {
        this.selectedList.innerHTML = '';
        if(this.SELECTED_REPORTS.length === 0) {
            this.selectedList.innerHTML = '<div class="empty-state"><p>请勾选文件</p></div>';
            return;
        }
        
        this.SELECTED_REPORTS.forEach((path, idx) => {
            const item = this.ALL_REPORTS.find(r => r.path === path);
            if(!item) return;

            const box = document.createElement('div');
            box.className = "selected-item-box";
            
            const info = document.createElement('div');
            info.className = "selected-item-info";
            info.innerHTML = `<div class="selected-item-name">${item.name}</div><div class="selected-item-idx">序号: ${idx+1}</div>`;
            
            const rmBtn = document.createElement('button');
            rmBtn.className = "btn-remove-item";
            rmBtn.innerHTML = "&times;";
            rmBtn.onclick = () => {
                this.SELECTED_REPORTS.splice(idx, 1);
                this.renderUI();
            };

            box.appendChild(info);
            box.appendChild(rmBtn);
            this.selectedList.appendChild(box);
        });
    },

    async deleteReport(path) {
        try {
            // 使用CRUD管理器的delete方法
            await this.crud.delete(path, {
                confirmMessage: `确定要删除此报告吗？`
            });
            const idx = this.SELECTED_REPORTS.indexOf(path);
            if(idx > -1) this.SELECTED_REPORTS.splice(idx, 1);
            this.loadReportFiles();
        } catch(e) { 
            console.error(e);
        }
    },

    async batchDelete() {
        if(await AppUtils.safeConfirm(`确认删除选中的 ${this.SELECTED_REPORTS.length} 个文件?`)) {
            try {
                // 使用CRUD管理器的batchDelete方法
                await this.crud.batchDelete(this.SELECTED_REPORTS, {
                    confirmMessage: `确认删除选中的 ${this.SELECTED_REPORTS.length} 个文件?`
                });
                this.SELECTED_REPORTS = [];
                this.loadReportFiles();
            } catch(e) {
                console.error(e);
            }
        }
    },

    async startMerge() {
        if(this.SELECTED_REPORTS.length < 2) return AppUtils.showToast("至少选择两个文件", "error");
        
        const filename = document.getElementById('merge-filename').value.trim();
        const btn = document.getElementById('btn-start-merge');
        const oldText = btn.innerText;
        btn.disabled = true; btn.innerText = "合并中...";

        try {
            const result = await AppAPI.Reports.merge(this.SELECTED_REPORTS, filename);
            
            if(result.success) {
                if(await AppUtils.safeConfirm(`合并成功！打开文件夹？`)) {
                    window.AppAPI.openFolder(result.file_path);
                }
                // Keep modal open per user request
                this.generateMergeFilename();
            } else {
                AppUtils.showToast(result.message, "error");
            }
        } catch(e) {
            AppUtils.showToast(e.message, "error");
        } finally {
            btn.disabled = false;
            btn.innerText = oldText;
        }
    },

    async downloadBackup() {
        try {
            AppUtils.showToast("正在下载备份...", "info");
            // 使用新API直接打开下载链接
            window.AppAPI.backupDatabase();
        } catch(e) {
            console.error(e);
            AppUtils.showToast("操作失败", "error");
        }
    },

    // --- ICP Cache Manager ---

    async loadIcpList() {
        const container = document.getElementById('icp-list-container');
        if(!container) return;
        
        container.innerHTML = '<div style="padding:20px; color:#666;">加载中...</div>';
        
        try {
            this.ICP_LIST = await window.AppAPI.Icp.list();
            this.renderIcpList();
        } catch(e) {
            container.innerHTML = `<div style="color:red; padding:20px;">加载失败: ${e.message}</div>`;
        }
    },

    renderIcpList(filter = "") {
        const container = document.getElementById('icp-list-container');
        container.innerHTML = '';
        
        // Define fixed columns as requested
        // Note: Field keys swapped because DB seems to have natureName/unitName data reversed
        const COL_DEFS = [
            { key: 'natureName', label: '性质', width: '80px' },
            { key: 'unitName', label: '单位名称', flex: 2 },
            { key: 'domain', label: '域名', flex: 1.5 },
            { key: 'mainLicence', label: '主备案号', flex: 1.5 },
            { key: 'serviceLicence', label: '服务备案号', flex: 1.5 },
            { key: 'updateRecordTime', label: '更新时间', width: '140px' }
        ];

        const term = filter.trim().toLowerCase();
        let filtered = this.ICP_LIST;
        
        if (term) {
             filtered = this.ICP_LIST.filter(item => {
                return Object.values(item).some(val => 
                    String(val).toLowerCase().includes(term)
                );
            });
        }

        if(filtered.length === 0) {
            container.innerHTML = '<div class="empty-state"><p>未找到相关 ICP 记录</p></div>';
            return;
        }
        
        // Update Batch Delete Button Visibility
        const btnBatchDel = document.getElementById('btn-icp-batch-delete');
        if(btnBatchDel) {
            btnBatchDel.style.display = this.ICP_SELECTED_IDS.length > 0 ? 'inline-block' : 'none';
        }

        // --- Render Header ---
        const headerRow = document.createElement('div');
        headerRow.className = 'report-list-item';
        headerRow.style = "background: #f8f9fa; font-weight: bold; border-bottom: 2px solid #eee; position: sticky; top: 0; z-index: 10;";
        
        // Checkbox header
        const checkHeader = document.createElement('div');
        checkHeader.style.width = "40px";
        checkHeader.style.textAlign = "center";
        const cbAll = document.createElement('input');
        cbAll.type = 'checkbox';
        cbAll.onchange = (e) => {
            if(e.target.checked) {
                // Select all currently filtered items that have IDs
                this.ICP_SELECTED_IDS = filtered.map(i => i.Vuln_id).filter(id => id);
            } else {
                this.ICP_SELECTED_IDS = [];
            }
            this.renderIcpList(filter); // Re-render to update checkboxes
        };
        // Check state if all visible are selected
        const visibleIds = filtered.map(i => i.Vuln_id).filter(id => id);
        if(visibleIds.length > 0 && visibleIds.every(id => this.ICP_SELECTED_IDS.includes(id))) {
            cbAll.checked = true;
        }
        checkHeader.appendChild(cbAll);
        headerRow.appendChild(checkHeader);
        
        COL_DEFS.forEach(col => {
            const span = document.createElement('span');
            // Apply flex or width
            if (col.flex) span.style.flex = col.flex;
            if (col.width) {
                span.style.width = col.width;
                span.style.flex = "none";
            }
            span.style.padding = "0 5px";
            span.innerText = col.label;
            headerRow.appendChild(span);
        });
        
        // Add Action Column Header
        const actionHeader = document.createElement('div');
        actionHeader.style.width = "100px";
        actionHeader.innerText = "操作";
        actionHeader.style.textAlign = "center";
        headerRow.appendChild(actionHeader);

        container.appendChild(headerRow);

        // --- Render Rows ---
        // Limit to 500 for performance
        const displayList = filtered.slice(0, 500); 

        displayList.forEach(item => {
            const row = document.createElement('div');
            row.className = 'report-list-item'; // Reuse styles
            
            // Checkbox
            const checkDiv = document.createElement('div');
            checkDiv.style.width = "40px";
            checkDiv.style.textAlign = "center";
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = this.ICP_SELECTED_IDS.includes(item.Vuln_id);
            cb.onchange = (e) => {
                if(e.target.checked) this.ICP_SELECTED_IDS.push(item.Vuln_id);
                else {
                    const idx = this.ICP_SELECTED_IDS.indexOf(item.Vuln_id);
                    if(idx > -1) this.ICP_SELECTED_IDS.splice(idx, 1);
                }
                // Update button visibility only, no full re-render for perf
                 const btn = document.getElementById('btn-icp-batch-delete');
                 if(btn) btn.style.display = this.ICP_SELECTED_IDS.length > 0 ? 'inline-block' : 'none';
                 // Update header check if needed (optional optimization)
            };
            checkDiv.appendChild(cb);
            row.appendChild(checkDiv);

            COL_DEFS.forEach(col => {
                const span = document.createElement('span');
                 if (col.flex) span.style.flex = col.flex;
                if (col.width) {
                    span.style.width = col.width;
                    span.style.flex = "none";
                }
                span.style.padding = "0 5px";
                span.style.overflow = "hidden";
                span.style.textOverflow = "ellipsis";
                span.style.whiteSpace = "nowrap";
                
                let val = item[col.key];
                if (val === null || val === undefined) val = "";
                span.innerText = val;
                span.title = val; // tooltip
                row.appendChild(span);
            });

            // Action: Edit & Delete
            let itemId = item['Vuln_id'];

            const actionDiv = document.createElement('div');
            actionDiv.style.width = "100px";
            actionDiv.style.textAlign = "center";
            actionDiv.style.flex = "none";
            actionDiv.style.display = "flex";
            actionDiv.style.gap = "5px";
            actionDiv.style.justifyContent = "center";

            if (itemId) {
                // Edit Btn
                const btnEdit = document.createElement('button');
                btnEdit.className = "btn-mini"; // reuse style
                btnEdit.style.backgroundColor = "#007bff";
                btnEdit.style.marginLeft = "0";
                btnEdit.innerText = "✎";
                btnEdit.onclick = () => this.openIcpModal(item);
                actionDiv.appendChild(btnEdit);

                // Del Btn
                const btnDel = document.createElement('button');
                btnDel.className = "btn-mini";
                btnDel.style.backgroundColor = "#dc3545";
                btnDel.style.marginLeft = "0";
                btnDel.innerText = "🗑️";
                btnDel.onclick = async () => {
                    if(await AppUtils.safeConfirm(`确定删除该记录吗？`)) {
                        await this.deleteIcpEntry(itemId);
                    }
                };
                actionDiv.appendChild(btnDel);
            }
            row.appendChild(actionDiv);
            
            container.appendChild(row);
        });

        if (filtered.length > 500) {
             const info = document.createElement('div');
             info.style.padding = "10px";
             info.style.textAlign = "center";
             info.style.color = "#999";
             info.innerText = `... 仅显示前 500 条 (共 ${filtered.length} 条) ...`;
             container.appendChild(info);
        }
    },

    async deleteIcpEntry(vulnId) {
        try {
            const result = await window.AppAPI.Icp.delete(vulnId);
            if(result.success) {
                AppUtils.showToast("已删除", "success");
                // Local update
                this.ICP_LIST = this.ICP_LIST.filter(i => i.Vuln_id !== vulnId);
                // Refresh list with current filter
                const searchVal = document.getElementById('icp-search') ? document.getElementById('icp-search').value : "";
                this.renderIcpList(searchVal);
            } else {
                AppUtils.showToast("删除失败", "error");
            }
        } catch(e) { AppUtils.showToast(e.message, "error"); }
    },

    openIcpModal(item = null) {
        const modal = document.getElementById('icp-edit-modal');
        const title = document.getElementById('icp-modal-title');
        
        // Reset form
        document.getElementById('icp-form').reset();
        document.getElementById('icp-id').value = '';

        if (item) {
            title.innerText = "编辑 ICP 信息";
            document.getElementById('icp-id').value = item.Vuln_id;
            document.getElementById('icp-domain').value = item.domain || '';
            // NOTE: Mapping logic:
            // "单位名称" field (natureName) -> display NatureName from DB (which is natureName field, labeled '单位名称' in col defs)
            // But wait, user said "natureName" shows "单位名称", and "unitName" shows "性质".
            // So: form input 'icp-natureName' (Label 单位名称) should get content from item.natureName
            // And form input 'icp-unitName' (Label 性质) should get content from item.unitName
            document.getElementById('icp-natureName').value = item.natureName || '';
            document.getElementById('icp-unitName').value = item.unitName || '';
            document.getElementById('icp-mainLicence').value = item.mainLicence || '';
            document.getElementById('icp-serviceLicence').value = item.serviceLicence || '';
            document.getElementById('icp-updateTime').value = item.updateRecordTime || '';
        } else {
            title.innerText = "新增 ICP 信息";
        }
        
        modal.style.display = 'block';
    },

    async saveIcpEntry() {
        const id = document.getElementById('icp-id').value;
        const data = {
            domain: document.getElementById('icp-domain').value,
            natureName: document.getElementById('icp-natureName').value,
            unitName: document.getElementById('icp-unitName').value,
            mainLicence: document.getElementById('icp-mainLicence').value,
            serviceLicence: document.getElementById('icp-serviceLicence').value,
            updateRecordTime: document.getElementById('icp-updateTime').value
        };

        try {
            let result;
            if (id) {
                result = await window.AppAPI.Icp.update(id, data);
            } else {
                result = await window.AppAPI.Icp.add(data);
            }
            
            if(result.success) {
                AppUtils.showToast("保存成功", "success");
                document.getElementById('icp-edit-modal').style.display = 'none';
                this.loadIcpList(); // full reload
            } else {
                AppUtils.showToast(result.message || "保存失败", "error");
            }
        } catch(e) {
            AppUtils.showToast(e.message, "error");
        }
    },

    async batchDeleteIcp() {
        if(this.ICP_SELECTED_IDS.length === 0) return;
        if(await AppUtils.safeConfirm(`确认删除选中的 ${this.ICP_SELECTED_IDS.length} 条记录吗？`)) {
            try {
                const result = await window.AppAPI.Icp.batchDelete(this.ICP_SELECTED_IDS);
                if(result.success) {
                    AppUtils.showToast(result.message, "success");
                    this.ICP_SELECTED_IDS = []; // clear selection
                    this.loadIcpList();
                } else {
                    AppUtils.showToast(result.message, "error");
                }
            } catch(e) {
                AppUtils.showToast(e.message, "error");
            }
        }
    },
};

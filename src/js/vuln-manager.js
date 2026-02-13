// vuln-manager.js - 漏洞库管理 (重构版 - 使用CRUDManager)

window.AppVulnManager = {
    VULN_LIST: [],
    crud: null,
    
    // 初始化
    init() {
        // 初始化CRUD管理器
        this.crud = new CRUDManager(
            window.AppAPI.Vulnerabilities,
            (items) => this.renderList(items),
            () => window.AppAPI.getVulnerabilities()
        );
        
        this.cacheDom();
        this.bindEvents();
    },

    cacheDom() {
        this.listContainer = document.getElementById('vuln-manager-list');
        this.form = document.getElementById('vuln-manager-form');
        this.searchInput = document.getElementById('vuln-manager-search');
        this.dropdown = document.getElementById('vul_name_select');
    },

    bindEvents() {
        // Search Input in Manager Modal
        const searchInput = document.getElementById('vuln-manager-search');
        if (searchInput) {
            searchInput.oninput = () => {
                if (this.VULN_LIST.length > 0) this.renderList(this.VULN_LIST);
                else this.loadVulnerabilities();
            };
        }
        
        // Buttons - Bind directly to elements
        const btnNew = document.getElementById('btn-manager-new');
        if(btnNew) {
            btnNew.onclick = (e) => {
                e.preventDefault(); 
                this.resetForm();
            };
        }

        const btnDel = document.getElementById('btn-manager-delete');
        if(btnDel) {
            btnDel.onclick = async (e) => {
                e.preventDefault();
                await this.deleteVuln();
            };
        }

        const btnSave = document.getElementById('btn-manager-save');
        if(btnSave) {
            btnSave.onclick = async (e) => {
                e.preventDefault();
                await this.saveVuln();
            };
        }
    },

    // 加载漏洞列表 - 使用CRUD管理器
    async loadVulnerabilities() {
        try {
            const vulns = await this.crud.load();
            this.VULN_LIST = vulns;
            this.renderDropdown();
            return vulns;
        } catch(e) { 
            console.error(e); 
            return [];
        }
    },

    // 辅助：模糊获取属性值 (增强版)
    getValue(obj, keys) {
        if (!obj || typeof obj !== 'object') return undefined;
        // Exact match first
        for (let k of keys) {
            if (obj[k] !== undefined && obj[k] !== null && obj[k] !== "") return obj[k];
        }
        // Case insensitive match
        const lowerKeys = keys.map(k => k.toLowerCase());
        const objKeys = Object.keys(obj);
        for (let k of objKeys) {
            if (lowerKeys.includes(k.toLowerCase())) {
                 const val = obj[k];
                 if(val !== undefined && val !== null && val !== "") return val;
            }
        }
        return undefined;
    },

    // 渲染管理列表
    renderList(vulns) {
        this.listContainer = document.getElementById('vuln-manager-list'); // Ensure fresh ref
        if (!this.listContainer) return;

        this.listContainer.innerHTML = '';
        
        const searchInput = document.getElementById('vuln-manager-search');
        const term = (searchInput ? searchInput.value : "").toLowerCase();
        
        if (!Array.isArray(vulns)) {
            console.error("Vuln list is not an array:", vulns);
            return;
        }

        vulns.forEach(v => {
            // Normalize Name
            let vName = this.getValue(v, ['Vuln_Name', 'name', 'vuln_name', '漏洞名称']);
            if (!vName && typeof v === 'string') vName = v;
            if (!vName) return; // Skip invalid

            if (!vName.toLowerCase().includes(term)) return;

            const div = document.createElement('div');
            div.className = 'vuln-list-item';
            
            // Normalize ID
            const vId = this.getValue(v, ['Vuln_id', 'id', 'vuln_id']) || vName;
            
            // Normalize Risk
            const risk = this.getValue(v, ['Risk_Level', 'risk', 'level', '风险级别']) || '中危';
            const levelColor = risk === '高危' ? 'red' : (risk === '中危' ? 'orange' : 'green');
            
            // Normalize Category
            const category = this.getValue(v, ['Vuln_Class', 'category', 'class', '漏洞分类']) || '-';

            // Check active
            const idField = document.getElementById('manage-vuln-id');
            const currentEditId = idField ? idField.value : "";
            if (currentEditId && String(currentEditId) === String(vId)) div.classList.add('active');

            div.innerHTML = `
                <span style="flex:2; font-weight:500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${vName}">${vName}</span>
                <span style="flex:1; color:#666; font-size:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; padding:0 5px;" title="${category}">${category}</span>
                <span style="width:50px; color:${levelColor}; font-weight:bold; text-align: center;">${risk}</span>
            `;
            
            div.onclick = () => {
                document.querySelectorAll('.vuln-list-item').forEach(el => el.classList.remove('active'));
                div.classList.add('active');
                this.populateForm(v);
            };

            this.listContainer.appendChild(div);
        });
    },

    // 表单操作
    populateForm(v) {
        if (!v) return;
        
        const titleEl = document.getElementById('vuln-form-title');
        if(titleEl) titleEl.innerText = "编辑漏洞";
        
        const btnSave = document.getElementById('btn-manager-save');
        if(btnSave) btnSave.innerText = "保存 (更新)";
        
        let vName = this.getValue(v, ['Vuln_Name', 'name', 'vuln_name', '漏洞名称']);
        if (typeof v === 'string') vName = v;

        let vId = this.getValue(v, ['Vuln_id', 'id', 'vuln_id']);
        // Crucial: set ID handling
        if (!vId && vName) vId = vName; // Fallback if backend uses Name as ID?
        
        const setVal = (id, val) => {
            const el = document.getElementById(id);
            if(el) el.value = val || '';
        };

        setVal('manage-vuln-id', vId);
        setVal('manage-name', vName);
        setVal('manage-category', this.getValue(v, ['Vuln_Class', 'category', 'class']));
        setVal('manage-port', this.getValue(v, ['Default_port', 'port']));
        setVal('manage-level', this.getValue(v, ['Risk_Level', 'level', 'risk']) || '中危');
        setVal('manage-basis', this.getValue(v, ['Class_basis', 'basis']));
        setVal('manage-desc', this.getValue(v, ['Vuln_Description', 'description', 'desc']));
        setVal('manage-impact', this.getValue(v, ['Vuln_Hazards', 'impact', 'harm']));
        setVal('manage-suggestion', this.getValue(v, ['Repair_suggestions', 'suggestion']));
    },

    resetForm() {
        // Manual Clearing
        const fields = [
            'manage-vuln-id', 'manage-name', 'manage-category', 'manage-port', 
            'manage-basis', 'manage-desc', 'manage-impact', 'manage-suggestion'
        ];
        fields.forEach(fid => {
            const el = document.getElementById(fid);
            if(el) el.value = "";
        });
        
        // Reset Select separately
        const levelSel = document.getElementById('manage-level');
        if(levelSel) levelSel.value = "中危";

        // Update UI Text
        const titleEl = document.getElementById('vuln-form-title');
        if(titleEl) titleEl.innerText = "新增漏洞";
        
        const btnSave = document.getElementById('btn-manager-save');
        if(btnSave) btnSave.innerText = "保存 (新增)";
        
        // Clear Selection Highlighting
        document.querySelectorAll('.vuln-list-item').forEach(el => el.classList.remove('active'));
    },
    
    // 增删改逻辑 - 使用CRUD管理器
    async saveVuln() {
         const idField = document.getElementById('manage-vuln-id');
         const id = idField ? idField.value : "";
         const btn = document.getElementById('btn-manager-save');
         if(btn) btn.disabled = true;

         const nameVal = document.getElementById('manage-name').value.trim();
         if (!nameVal) {
             AppUtils.showToast("漏洞名称不能为空", "error");
             if(btn) btn.disabled = false;
             return;
         }

         const data = {
             id: id || undefined,
             name: nameVal,
             category: document.getElementById('manage-category').value,
             port: document.getElementById('manage-port').value,
             level: document.getElementById('manage-level').value,
             basis: document.getElementById('manage-basis').value,
             description: document.getElementById('manage-desc').value,
             impact: document.getElementById('manage-impact').value,
             suggestion: document.getElementById('manage-suggestion').value
         };

         try {
             // 使用CRUD管理器的save方法
             await this.crud.save(data, {
                 successMessage: id ? "漏洞更新成功" : "漏洞保存成功"
             });
             if(!id) this.resetForm();
         } catch(e) {
             console.error(e);
         } finally {
             if(btn) btn.disabled = false;
         }
     },

    async deleteVuln() {
        const idField = document.getElementById('manage-vuln-id');
        const id = idField ? idField.value : "";
        
        if (!id) return AppUtils.showToast("请先在左侧选择要删除的漏洞", "info");
        
        // 使用CRUD管理器的delete方法
        try {
            await this.crud.delete(id, {
                confirmMessage: "确定要删除该漏洞吗？此操作不可恢复。"
            });
            this.resetForm();
        } catch(e) {
            console.error(e);
        }
    },

};

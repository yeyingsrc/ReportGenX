// utils.js - 通用工具函数

window.AppUtils = {
    // ========== 样式常量 (减少内联样式重复) ==========
    STYLES: {
        // 图片证据容器
        evidenceItem: 'evidence-item',
        evidenceInfoBox: 'evidence-info-box',
        evidenceTextarea: 'evidence-textarea',
        
        // 按钮
        btnDelete: 'btn-delete',
        btnDeleteSmall: 'btn-delete-small',
        
        // 缩略图
        thumbWrapper: 'thumb-wrapper',
        thumbImg: 'thumb-img',
        
        // 表格
        dataTableWrapper: 'data-table-wrapper',
        dataTable: 'data-table',
        
        // Flex 布局
        flexRow: 'flex-row',
        flexCol: 'flex-col',
        flexBetween: 'flex-between',
        
        // 漏洞列表
        vulnListContainer: 'vuln-list-container',
        vulnSidebar: 'vuln-sidebar',
        vulnSidebarItem: 'vuln-sidebar-item',
        vulnItemCard: 'vuln-item-card',
        vulnCardHeader: 'vuln-card-header',
        vulnIndexBadge: 'vuln-index-badge',
        vulnEmptyTip: 'vuln-empty-tip',
        
        // 上传区域
        uploadArea: 'upload-area',
        
        // 搜索选择器
        searchableSelectContainer: 'searchable-select-container'
    },
    
    // ========== DOM 工厂函数 ==========
    
    /**
     * 创建删除按钮
     * @param {Function} onClick - 点击回调
     * @param {boolean} small - 是否使用小尺寸
     * @returns {HTMLButtonElement}
     */
    createDeleteButton(onClick, small = false) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = small ? this.STYLES.btnDeleteSmall : this.STYLES.btnDelete;
        btn.textContent = '删除';
        btn.onclick = onClick;
        return btn;
    },
    
    /**
     * 创建图片证据项
     * @param {string} imgSrc - 图片 URL
     * @param {Function} onDelete - 删除回调
     * @param {Function} onPreview - 预览回调
     * @param {string} placeholder - 文本框占位符
     * @returns {{wrapper: HTMLElement, textarea: HTMLTextAreaElement}}
     */
    createEvidenceItem(imgSrc, onDelete, onPreview, placeholder = '请输入此截图的说明文字...') {
        const wrapper = document.createElement('div');
        wrapper.className = this.STYLES.evidenceItem;
        
        const imgBox = document.createElement('div');
        const img = document.createElement('img');
        img.src = imgSrc;
        img.onclick = onPreview;
        imgBox.appendChild(img);
        
        const infoBox = document.createElement('div');
        infoBox.className = this.STYLES.evidenceInfoBox;
        
        const label = document.createElement('label');
        label.innerText = '图片说明/复现步骤:';
        label.style.marginBottom = '5px';
        
        const textarea = document.createElement('textarea');
        textarea.rows = 4;
        textarea.className = this.STYLES.evidenceTextarea;
        textarea.placeholder = placeholder;
        
        const delBtn = this.createDeleteButton(onDelete);
        delBtn.style.marginTop = '25px';
        delBtn.style.alignSelf = 'flex-start';
        
        infoBox.appendChild(label);
        infoBox.appendChild(textarea);
        
        wrapper.appendChild(imgBox);
        wrapper.appendChild(infoBox);
        wrapper.appendChild(delBtn);
        
        return { wrapper, textarea };
    },
    
    /**
     * 创建缩略图
     * @param {string} imgSrc - 图片 URL
     * @param {Function} onPreview - 预览回调
     * @returns {HTMLElement}
     */
    createThumbnail(imgSrc, onPreview) {
        const wrapper = document.createElement('div');
        wrapper.className = this.STYLES.thumbWrapper;
        
        const img = document.createElement('img');
        img.src = imgSrc;
        img.className = this.STYLES.thumbImg;
        img.onclick = onPreview;
        
        wrapper.appendChild(img);
        return wrapper;
    },
    
    /**
     * 创建数据表格
     * @param {Array<{label: string, width?: string}>} columns - 列定义
     * @returns {{table: HTMLTableElement, tbody: HTMLTableSectionElement}}
     */
    createDataTable(columns) {
        const wrapper = document.createElement('div');
        wrapper.className = this.STYLES.dataTableWrapper;
        
        const table = document.createElement('table');
        table.className = this.STYLES.dataTable;
        
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        
        columns.forEach(col => {
            const th = document.createElement('th');
            th.textContent = col.label;
            if (col.width) th.style.width = col.width;
            headerRow.appendChild(th);
        });
        
        thead.appendChild(headerRow);
        table.appendChild(thead);
        
        const tbody = document.createElement('tbody');
        table.appendChild(tbody);
        
        wrapper.appendChild(table);
        
        return { wrapper, table, tbody };
    },

    // 日期格式化: YYYY.MM.DD
    formatDate(date) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}.${m}.${d}`;
    },

    // 生成 ID: YYYYMMDD-HHMMSS
    generateId() {
        const now = new Date();
        const timePart = now.toTimeString().split(' ')[0].replace(/:/g, '');
        return this.formatDate(now).replace(/\./g, '') + '-' + timePart;
    },

    // 填充下拉框
    populateSelect(id, items) {
        const select = document.getElementById(id);
        if (!select) return;
        select.innerHTML = '';
        items.forEach(item => {
            if(!item) return;
            const opt = document.createElement('option');
            opt.value = item;
            opt.innerText = item;
            select.appendChild(opt);
        });
    },

    // Toast 提示
    showToast(message, type = 'info') {
        let container = document.querySelector('.toast-container');
        if (!container) {
            container = document.createElement('div');
            container.className = 'toast-container';
            document.body.appendChild(container);
        }
        
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = message.replace(/\n/g, '<br>'); 
        container.appendChild(toast);
        
        toast.offsetHeight; // Reflow
        toast.classList.add('show');
        
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => {
                if (toast.parentElement) toast.remove();
            }, 300);
        }, 4000); 
    },

    // 自定义确认弹窗 (Promise)
    safeConfirm(message) {
        return new Promise((resolve) => {
            const modal = document.getElementById('custom-confirm-modal');
            const msgEl = document.getElementById('confirm-message');
            const btnOk = document.getElementById('btn-confirm-ok');
            const btnCancel = document.getElementById('btn-confirm-cancel');
            
            if(!modal) {
                if(confirm(message)) resolve(true);
                else resolve(false);
                return;
            }

            msgEl.innerText = message;
            msgEl.innerHTML = message.replace(/\n/g, '<br>');
            
            modal.style.display = 'block';
            btnOk.focus();

            const close = (result) => {
                modal.style.display = 'none';
                btnOk.onclick = null;
                btnCancel.onclick = null;
                resolve(result);
                window.focus();
            };

            btnOk.onclick = () => close(true);
            btnCancel.onclick = () => close(false);
        });
    },
    
    // ========== 通用 API 错误处理 ==========
    
    /**
     * 包装 API 调用，统一处理成功/失败提示
     * @param {Function} apiCall - 返回 Promise 的 API 调用函数
     * @param {Object} options - 配置选项
     * @param {string} options.successMsg - 成功提示（可选，默认使用 result.message）
     * @param {string} options.errorMsg - 错误提示前缀（可选）
     * @param {boolean} options.showSuccess - 是否显示成功提示（默认 true）
     * @returns {Promise<any>} API 返回结果
     */
    async wrapApiCall(apiCall, options = {}) {
        const { successMsg, errorMsg = '操作失败', showSuccess = true } = options;
        try {
            const result = await apiCall();
            if (showSuccess) {
                this.showToast(successMsg || result.message || '操作成功', 'success');
            }
            return result;
        } catch (e) {
            console.error(e);
            this.showToast(`${errorMsg}: ${e.message}`, 'error');
            throw e;
        }
    },
    
    /**
     * 显示 API 错误提示
     * @param {Error} error - 错误对象
     * @param {string} prefix - 错误前缀
     */
    showApiError(error, prefix = '操作失败') {
        this.showToast(`${prefix}: ${error.message || '未知错误'}`, 'error');
    },
    
    /**
     * 显示成功提示
     * @param {string} message - 成功消息
     */
    showSuccess(message) {
        this.showToast(message, 'success');
    },
    
    /**
     * 显示警告提示
     * @param {string} message - 警告消息
     */
    showWarning(message) {
        this.showToast(message, 'warning');
    },
    
    // ========== 列表过滤工具 ==========
    
    /**
     * 过滤数组项
     * @param {Array} items - 待过滤的数组
     * @param {string} searchTerm - 搜索词
     * @param {Function} getSearchText - 获取搜索文本的函数 (item) => string
     * @returns {Array} 过滤后的数组
     */
    filterList(items, searchTerm, getSearchText) {
        if (!searchTerm || !searchTerm.trim()) return items;
        const term = searchTerm.toLowerCase().trim();
        return items.filter(item => {
            const text = getSearchText(item);
            return text && text.toLowerCase().includes(term);
        });
    },
    
    /**
     * 创建搜索过滤器
     * @param {string} inputId - 搜索输入框 ID
     * @param {Function} onFilter - 过滤回调 (searchTerm) => void
     * @param {number} debounceMs - 防抖延迟（毫秒）
     */
    setupSearchFilter(inputId, onFilter, debounceMs = 200) {
        const input = document.getElementById(inputId);
        if (!input) return;
        
        let timeout = null;
        input.addEventListener('input', (e) => {
            if (timeout) clearTimeout(timeout);
            timeout = setTimeout(() => {
                onFilter(e.target.value);
            }, debounceMs);
        });
    },
    
    // ========== 复选框选择管理 ==========
    
    /**
     * 创建复选框选择管理器
     * @returns {Object} 选择管理器
     */
    createSelectionManager() {
        const selected = new Set();
        return {
            toggle(id) {
                if (selected.has(id)) selected.delete(id);
                else selected.add(id);
            },
            add(id) { selected.add(id); },
            remove(id) { selected.delete(id); },
            has(id) { return selected.has(id); },
            clear() { selected.clear(); },
            getAll() { return Array.from(selected); },
            count() { return selected.size; },
            selectAll(ids) { ids.forEach(id => selected.add(id)); },
            isEmpty() { return selected.size === 0; }
        };
    }
};

// utils.js - 通用工具函数

window.AppUtils = {
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
    }
};

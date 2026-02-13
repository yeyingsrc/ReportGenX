// image-handler.js - 图片上传与预览逻辑
// 注意：此模块保留用于向后兼容，新代码应使用 AppFormRenderer 中的图片处理方法

window.AppImage = {
    // State
    icpScreenshotPath: null,
    vulnEvidenceList: [],

    // Init Logic
    init() {
        // ICP Upload
        this.setupImageUpload('icp-upload-area', 'icp-preview',  (path) => {
            this.icpScreenshotPath = path;
        }, false, 'btn-screenshot-icp');

        // Vuln Evidence Upload (Multiple)
        this.setupImageUpload('vuln-upload-area', 'vuln-previews', (path) => {
            // Handled internally by addItem logic for multiple
        }, true, 'btn-screenshot-vuln');
    },

    // Reset State
    reset() {
        this.icpScreenshotPath = null;
        this.vulnEvidenceList = [];
        const icpPreview = document.getElementById('icp-preview');
        const vulnPreviews = document.getElementById('vuln-previews');
        if (icpPreview) icpPreview.innerHTML = '';
        if (vulnPreviews) vulnPreviews.innerHTML = '';
    },

    // Main Helper
    setupImageUpload(areaId, previewId, onUploadSuccess, multiple = false, pasteBtnId = null) {
        const area = document.getElementById(areaId);
        const container = document.getElementById(previewId);
        if(!area || !container) return;

        // Click Upload
        area.addEventListener('click', (e) => {
            if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return;
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            input.onchange = async e => {
                const file = e.target.files[0];
                if (file) {
                    const result = await this.processUpload(file);
                    if (result) this.addItem(result, container, multiple, onUploadSuccess);
                }
            };
            input.click();
        });

        // Paste Button
        if (pasteBtnId) {
            const btn = document.getElementById(pasteBtnId);
            if (btn) {
                btn.innerText = "粘贴截图";
                btn.onclick = async (e) => {
                    e.preventDefault(); e.stopPropagation();
                    try {
                        const items = await navigator.clipboard.read();
                        let found = false;
                        for (const item of items) {
                            const imgType = item.types.find(t => t.startsWith('image/'));
                            if (imgType) {
                                found = true;
                                const blob = await item.getType(imgType);
                                const result = await this.processUpload(blob);
                                if (result) this.addItem(result, container, multiple, onUploadSuccess);
                                if (!multiple) break; 
                            }
                        }
                        if (!found && window.AppUtils) AppUtils.showToast("剪贴板中未发现图片", "info");
                    } catch (err) {
                        console.error(err);
                        if (window.AppUtils) AppUtils.showToast("无法读取剪贴板", "error");
                    }
                };
            }
        }
    },

    // Upload API - 复用 AppFormRenderer 的上传方法（如果可用）
    async processUpload(file, originalFile = null) {
        // 优先使用 AppFormRenderer 的方法
        if (window.AppFormRenderer && window.AppFormRenderer.uploadImage) {
            return window.AppFormRenderer.uploadImage(file);
        }
        
        // 回退到本地实现
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const filename = originalFile ? originalFile.name : `screenshot_${Date.now()}.png`;
                    const data = await window.AppAPI.uploadImage(e.target.result, filename);
                    resolve(data.file_path ? data : null);
                } catch (err) {
                    if (window.AppUtils) AppUtils.showToast("上传失败: " + err.message, "error");
                    resolve(null);
                }
            };
            reader.readAsDataURL(file);
        });
    },

    // Add UI Item - 使用 CSS 类替代内联样式
    addItem(imageInfo, container, multiple, onSuccess) {
        const fullUrl = `${window.AppAPI.BASE_URL}${imageInfo.url}`;

        if (multiple) {
            // 使用工厂函数创建证据项（如果可用）
            if (window.AppUtils && window.AppUtils.createEvidenceItem) {
                const evidenceObj = { path: imageInfo.file_path, description: "" };
                this.vulnEvidenceList.push(evidenceObj);
                
                const { wrapper, textarea } = AppUtils.createEvidenceItem(
                    fullUrl,
                    () => {
                        wrapper.remove();
                        const idx = this.vulnEvidenceList.indexOf(evidenceObj);
                        if (idx > -1) this.vulnEvidenceList.splice(idx, 1);
                    },
                    () => this.openPreview(fullUrl, textarea.value || "漏洞截图")
                );
                
                textarea.addEventListener('input', (e) => { evidenceObj.description = e.target.value; });
                container.appendChild(wrapper);
            } else {
                // 回退到原始实现
                const wrapper = document.createElement('div');
                wrapper.className = 'evidence-item'; 
                
                const imgBox = document.createElement('div');
                const img = document.createElement('img');
                img.src = fullUrl;
                imgBox.appendChild(img);
                
                const infoBox = document.createElement('div');
                infoBox.className = 'evidence-info-box';
                
                const label = document.createElement('label');
                label.innerText = "图片说明/复现步骤:";
                label.style.marginBottom = "5px";
                
                const textarea = document.createElement('textarea');
                textarea.rows = 4;
                textarea.className = 'evidence-textarea';
                textarea.placeholder = "请输入此截图的说明文字...";
                
                const delBtn = document.createElement('button');
                delBtn.innerText = "删除";
                delBtn.className = 'btn-delete';
                delBtn.style.marginTop = '25px';
                delBtn.style.alignSelf = 'flex-start';
                
                const evidenceObj = { path: imageInfo.file_path, description: "" };
                this.vulnEvidenceList.push(evidenceObj);
                
                textarea.addEventListener('input', (e) => { evidenceObj.description = e.target.value; });
                
                delBtn.addEventListener('click', () => {
                    wrapper.remove();
                    const idx = this.vulnEvidenceList.indexOf(evidenceObj);
                    if (idx > -1) this.vulnEvidenceList.splice(idx, 1);
                });
                
                infoBox.appendChild(label);
                infoBox.appendChild(textarea);
                img.onclick = () => this.openPreview(img.src, textarea.value || "漏洞截图");

                wrapper.appendChild(imgBox);
                wrapper.appendChild(infoBox);
                wrapper.appendChild(delBtn);
                
                container.appendChild(wrapper);
            }
            
        } else {
            // Single Mode - 使用 CSS 类
            container.innerHTML = '';
            
            if (window.AppUtils && window.AppUtils.createThumbnail) {
                const thumb = AppUtils.createThumbnail(fullUrl, () => this.openPreview(fullUrl, "备案截图预览"));
                container.appendChild(thumb);
            } else {
                const thumbWrapper = document.createElement('div');
                thumbWrapper.className = 'thumb-wrapper';
                const img = document.createElement('img');
                img.src = fullUrl;
                img.className = 'thumb-img';
                img.onclick = () => this.openPreview(img.src, "备案截图预览");
                
                thumbWrapper.appendChild(img);
                container.appendChild(thumbWrapper);
            }
            
            if(onSuccess) onSuccess(imageInfo.file_path);
        }
    },

    // Preview Modal Logic - 复用 AppFormRenderer 的模态框
    openPreview(src, text) {
        // 优先使用 AppFormRenderer 的预览方法
        if (window.AppFormRenderer && window.AppFormRenderer.openImagePreview) {
            window.AppFormRenderer.ensurePreviewModal();
            window.AppFormRenderer.openImagePreview(src, text);
            return;
        }
        
        // 回退到本地实现（兼容旧代码）- 使用 CSS 类
        this._ensureLocalPreviewModal();
        const modal = document.getElementById('image-preview-modal');
        if(!modal) return;
        const img = modal.querySelector('img');
        const cap = modal.querySelector('.image-preview-caption') || modal.querySelector('div:last-child');
        
        img.src = src;
        cap.innerText = text || "";
        modal.classList.add('show');
    },

    closePreview() {
        // 优先使用 AppFormRenderer 的关闭方法
        if (window.AppFormRenderer && window.AppFormRenderer.closeImagePreview) {
            window.AppFormRenderer.closeImagePreview();
            return;
        }
        
        // 回退到本地实现 - 使用 CSS 类
        const modal = document.getElementById('image-preview-modal');
        if(!modal) return;
        modal.classList.remove('show');
    },
    
    // 本地预览模态框（仅在 AppFormRenderer 不可用时使用）- 使用 CSS 类
    _ensureLocalPreviewModal() {
        if (document.getElementById('image-preview-modal')) return;
        if (document.getElementById('form-image-preview-modal')) return; // AppFormRenderer 的模态框已存在
        
        const modal = document.createElement('div');
        modal.id = 'image-preview-modal';
        modal.className = 'image-preview-modal';
        
        modal.onclick = (e) => {
            if(e.target === modal) this.closePreview();
        };

        const img = document.createElement('img');
        
        const closeBtn = document.createElement('span');
        closeBtn.innerHTML = "&times;";
        closeBtn.className = 'image-preview-close';
        closeBtn.onclick = () => this.closePreview();
        
        const caption = document.createElement('div');
        caption.className = 'image-preview-caption';

        modal.appendChild(closeBtn);
        modal.appendChild(img);
        modal.appendChild(caption);
        document.body.appendChild(modal);
    }
};

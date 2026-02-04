// image-handler.js - 图片上传与预览逻辑

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
        document.getElementById('icp-preview').innerHTML = '';
        document.getElementById('vuln-previews').innerHTML = '';
    },

    // Main Helper
    setupImageUpload(areaId, previewId, onUploadSuccess, multiple = false, pasteBtnId = null) {
        const area = document.getElementById(areaId);
        const container = document.getElementById(previewId);
        if(!area || !container) return;

        // Ensure Modal Exists
        this.ensurePreviewModal();

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
                        if (!found) AppUtils.showToast("剪贴板中未发现图片", "info");
                    } catch (err) {
                        console.error(err);
                        AppUtils.showToast("无法读取剪贴板", "error");
                    }
                };
            }
        }
    },

    // Upload API
    async processUpload(file, originalFile = null) {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const res = await fetch(`${window.AppAPI.BASE_URL}/api/upload-image`, {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({
                            image_base64: e.target.result,
                            filename: originalFile ? originalFile.name : `screenshot_${Date.now()}.png`
                        })
                    });
                    const data = await res.json();
                    resolve(data.file_path ? data : null);
                } catch (err) {
                    AppUtils.showToast("上传失败: " + err.message, "error");
                    resolve(null);
                }
            };
            reader.readAsDataURL(file);
        });
    },

    // Add UI Item
    addItem(imageInfo, container, multiple, onSuccess) {
        const fullUrl = `${window.AppAPI.BASE_URL}${imageInfo.url}`;

        if (multiple) {
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
            label.innerText = "图片说明/复现步骤:";
            label.style.marginBottom = "5px";
            
            const textarea = document.createElement('textarea');
            textarea.rows = 4;
            textarea.style.cssText = "width:100%; border:1px solid #ccc; padding:5px;";
            textarea.placeholder = "请输入此截图的说明文字...";
            
            const delBtn = document.createElement('button');
            delBtn.innerText = "删除";
            delBtn.style.cssText = "margin-top:25px; align-self:flex-start; background:#ff4d4f; color:white; border:none; padding:6px 12px; cursor:pointer; border-radius:4px;";
            
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
            
        } else {
            // Single Mode
            container.innerHTML = '';
            const thumbWrapper = document.createElement('div');
            thumbWrapper.style.cssText = "display:inline-block; position:relative; margin-top:5px;";
            const img = document.createElement('img');
            img.src = fullUrl;
            img.style.cssText = "height:120px; width:auto; border:1px solid #ccc; padding:2px; border-radius:4px; box-shadow:0 2px 4px rgba(0,0,0,0.1); cursor:zoom-in;";
            img.onclick = () => this.openPreview(img.src, "备案截图预览");
            
            thumbWrapper.appendChild(img);
            container.appendChild(thumbWrapper);
            if(onSuccess) onSuccess(imageInfo.file_path);
        }
    },

    // Preview Modal Logic
    ensurePreviewModal() {
        if (document.getElementById('image-preview-modal')) return;
        
        const modal = document.createElement('div');
        modal.id = 'image-preview-modal';
        modal.style.cssText = `display: none; position: fixed; z-index: 2000; left: 0; top: 0; width: 100%; height: 100%; background-color: rgba(0,0,0,0.85); align-items: center; justify-content: center; flex-direction: column; opacity: 0; transition: opacity 0.3s ease;`;
        
        modal.onclick = (e) => {
            if(e.target === modal) this.closePreview();
        };

        const img = document.createElement('img');
        img.style.cssText = "max-width: 90%; max-height: 85vh; border: 2px solid #fff; box-shadow: 0 0 20px rgba(0,0,0,0.5); object-fit: contain; transform: scale(0.9); transition: transform 0.3s ease;";
        
        const closeBtn = document.createElement('span');
        closeBtn.innerHTML = "&times;";
        closeBtn.style.cssText = "position: absolute; top: 20px; right: 30px; font-size: 40px; color: #fff; cursor: pointer; font-weight: bold; text-shadow: 0 2px 4px rgba(0,0,0,0.5);";
        closeBtn.onclick = () => this.closePreview();
        
        const caption = document.createElement('div');
        caption.style.cssText = "margin-top: 15px; color: #fff; font-size: 16px; max-width: 80%; text-align: center; text-shadow: 0 1px 2px rgba(0,0,0,0.8);";

        modal.appendChild(closeBtn);
        modal.appendChild(img);
        modal.appendChild(caption);
        document.body.appendChild(modal);
    },

    openPreview(src, text) {
        const modal = document.getElementById('image-preview-modal');
        if(!modal) return;
        const img = modal.querySelector('img');
        const cap = modal.querySelector('div:last-child');
        
        img.src = src;
        cap.innerText = text || "";
        modal.style.display = 'flex';
        modal.offsetHeight; // force reflow
        modal.style.opacity = '1';
        img.style.transform = 'scale(1)';
    },

    closePreview() {
        const modal = document.getElementById('image-preview-modal');
        if(!modal) return;
        modal.style.opacity = '0';
        setTimeout(() => modal.style.display = 'none', 300);
    }
};

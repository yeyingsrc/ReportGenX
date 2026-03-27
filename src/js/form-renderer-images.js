// form-renderer-images.js - 图片上传/预览职责拆分（Phase 1）

window.AppFormRendererImageOps = {
    createImageUploader(renderer, field, multiple, pasteBtn = null) {
        const container = document.createElement('div');
        container.className = 'image-upload-container';
        container.id = field.key;

        const uploadArea = document.createElement('div');
        uploadArea.className = 'upload-area';
        uploadArea.id = `${field.key}-upload-area`;
        uploadArea.innerHTML = `
            <span class="upload-icon">📷</span>
            <p>${field.help_text || (multiple ? '点击上传或粘贴截图' : '点击上传或粘贴截图')}</p>
        `;
        container.appendChild(uploadArea);

        const previewContainer = document.createElement('div');
        previewContainer.className = multiple ? 'image-list-container' : 'preview-container';
        previewContainer.id = `${field.key}-preview`;
        container.appendChild(previewContainer);

        const hiddenInput = document.createElement('input');
        hiddenInput.type = 'hidden';
        hiddenInput.id = `${field.key}_path`;
        hiddenInput.name = `${field.key}_path`;
        container.appendChild(hiddenInput);

        renderer.formData[field.key] = multiple ? [] : '';
        this.bindImageUploadEvents(renderer, field, uploadArea, previewContainer, multiple, pasteBtn);
        return container;
    },

    bindImageUploadEvents(renderer, field, uploadArea, previewContainer, multiple, pasteBtn = null) {
        this.ensurePreviewModal(renderer);

        uploadArea.addEventListener('click', (event) => {
            if (event.target.tagName === 'BUTTON' || event.target.closest('button')) {
                return;
            }

            const input = document.createElement('input');
            input.type = 'file';
            input.accept = field.accept || 'image/*';
            input.onchange = async (changeEvent) => {
                const file = changeEvent.target.files[0];
                if (file) {
                    const result = await renderer.uploadImage(file);
                    if (result) {
                        this.addImageItem(renderer, field, result, previewContainer, multiple);
                    }
                }
            };
            input.click();
        });

        if (pasteBtn) {
            pasteBtn.onclick = async (event) => {
                event.preventDefault();
                event.stopPropagation();

                try {
                    const items = await navigator.clipboard.read();
                    let found = false;

                    for (const item of items) {
                        const imageType = item.types.find((type) => type.startsWith('image/'));
                        if (!imageType) {
                            continue;
                        }

                        found = true;
                        const blob = await item.getType(imageType);
                        const result = await renderer.uploadImage(blob);
                        if (result) {
                            this.addImageItem(renderer, field, result, previewContainer, multiple);
                        }

                        if (!multiple) {
                            break;
                        }
                    }

                    if (!found && window.AppUtils) {
                        AppUtils.showToast('剪贴板中未发现图片', 'info');
                    }
                } catch (_err) {
                    if (window.AppUtils) {
                        AppUtils.showToast('无法读取剪贴板', 'error');
                    }
                }
            };
        }
    },

    addImageItem(renderer, field, imageInfo, container, multiple) {
        const fullUrl = `${window.AppAPI.BASE_URL}${imageInfo.url}`;

        if (multiple) {
            const wrapper = document.createElement('div');
            wrapper.className = 'evidence-item';

            const imgBox = document.createElement('div');
            const img = document.createElement('img');
            img.src = fullUrl;
            imgBox.appendChild(img);

            const infoBox = document.createElement('div');
            infoBox.className = 'evidence-info-box';

            const label = document.createElement('label');
            label.innerText = field.description_placeholder ? '图片说明:' : '图片说明/复现步骤:';
            label.style.marginBottom = '5px';

            const textarea = document.createElement('textarea');
            textarea.rows = 4;
            textarea.className = 'evidence-textarea';
            textarea.placeholder = field.description_placeholder || '请输入此截图的说明文字...';

            const delBtn = document.createElement('button');
            delBtn.type = 'button';
            delBtn.innerText = '删除';
            delBtn.className = 'btn-delete';
            delBtn.style.marginTop = '25px';
            delBtn.style.alignSelf = 'flex-start';

            const evidenceObj = { path: imageInfo.file_path, description: '' };
            if (!Array.isArray(renderer.formData[field.key])) {
                renderer.formData[field.key] = [];
            }
            renderer.formData[field.key].push(evidenceObj);

            textarea.addEventListener('input', (event) => {
                evidenceObj.description = event.target.value;
            });

            delBtn.addEventListener('click', () => {
                wrapper.remove();
                const idx = renderer.formData[field.key].indexOf(evidenceObj);
                if (idx > -1) {
                    renderer.formData[field.key].splice(idx, 1);
                }
            });

            img.onclick = () => this.openImagePreview(renderer, img.src, textarea.value || '截图预览');

            infoBox.appendChild(label);
            infoBox.appendChild(textarea);

            wrapper.appendChild(imgBox);
            wrapper.appendChild(infoBox);
            wrapper.appendChild(delBtn);

            container.appendChild(wrapper);
        } else {
            container.innerHTML = '';
            const thumbWrapper = document.createElement('div');
            thumbWrapper.className = 'thumb-wrapper';

            const img = document.createElement('img');
            img.src = fullUrl;
            img.className = 'thumb-img';
            img.onclick = () => this.openImagePreview(renderer, img.src, field.label || '图片预览');

            thumbWrapper.appendChild(img);
            container.appendChild(thumbWrapper);

            renderer.formData[field.key] = imageInfo.file_path;
            const hiddenInput = document.getElementById(`${field.key}_path`);
            if (hiddenInput) {
                hiddenInput.value = imageInfo.file_path;
            }
        }
    },

    ensurePreviewModal(renderer) {
        if (document.getElementById('form-image-preview-modal')) {
            return;
        }

        const modal = document.createElement('div');
        modal.id = 'form-image-preview-modal';
        modal.className = 'image-preview-modal';

        modal.onclick = (event) => {
            if (event.target === modal) {
                this.closeImagePreview(renderer);
            }
        };

        const image = document.createElement('img');

        const closeBtn = document.createElement('span');
        closeBtn.innerHTML = '&times;';
        closeBtn.className = 'image-preview-close';
        closeBtn.onclick = () => this.closeImagePreview(renderer);

        const caption = document.createElement('div');
        caption.className = 'image-preview-caption';

        modal.appendChild(closeBtn);
        modal.appendChild(image);
        modal.appendChild(caption);
        document.body.appendChild(modal);
    },

    openImagePreview(renderer, src, text) {
        const modal = document.getElementById('form-image-preview-modal');
        if (!modal) {
            return;
        }

        const image = modal.querySelector('img');
        const caption = modal.querySelector('.image-preview-caption');
        image.src = src;
        caption.innerText = text || '';
        modal.classList.add('show');
    },

    closeImagePreview() {
        const modal = document.getElementById('form-image-preview-modal');
        if (!modal) {
            return;
        }
        modal.classList.remove('show');
    }
};

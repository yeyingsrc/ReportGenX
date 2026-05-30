// form-renderer-fields.js - 字段渲染职责拆分（Phase 1）

window.AppFormRendererFieldOps = {
    createField(renderer, field) {
        if (field.type === 'hidden') {
            const hidden = document.createElement('input');
            hidden.type = 'hidden';
            hidden.id = field.key;
            hidden.name = field.key;
            return hidden;
        }

        const wrapper = document.createElement('div');
        const isWideField = field.type === 'textarea'
            || field.type === 'image'
            || field.type === 'image_list'
            || field.type === 'grouped_image_list'
            || field.type === 'checkbox_group'
            || field.type === 'widget'
            || field.type === 'array';

        wrapper.className = `${isWideField ? 'col-12' : 'col-4'} form-group`;

        const label = document.createElement('label');
        label.setAttribute('for', field.key);
        label.innerHTML = field.label + (field.required ? ' <span style="color:red">*</span>' : '');

        let pasteBtn = null;

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

        const input = this.createInput(renderer, field, pasteBtn);
        if (input) {
            wrapper.appendChild(input);
        }

        return wrapper;
    },

    createInput(renderer, field, pasteBtn = null) {
        // ── Layer 1: Widget dispatch (external template widgets) ──────
        if (field.type === 'widget' && field.widget) {
            const container = document.createElement('div');
            container.id = field.key;
            renderer.loadTemplateWidget(field).then(result => {
                if (result) container.appendChild(result);
            });
            return container;
        }

        // ── Layer 2: Built-in composite types ─────────────────────────
        let el;

        if (field.type === 'array') {
            el = renderer.createArrayField(field);
        } else if (field.type === 'grouped_image_list') {
            el = renderer.createGroupedImageList(field);
        }

        // ── Layer 3: Built-in primitive types ─────────────────────────
        else if (field.type === 'searchable_select') {
            el = renderer.createSearchableSelect(field);
        } else if (field.type === 'select') {
            el = document.createElement('select');
            const empty = document.createElement('option');
            empty.value = '';
            empty.textContent = '-- 请选择 --';
            el.appendChild(empty);

            if (field.options) {
                field.options.forEach((optionData) => {
                    const option = document.createElement('option');
                    option.value = typeof optionData === 'object' ? optionData.value : optionData;
                    option.textContent = typeof optionData === 'object' ? (optionData.label || optionData.value) : optionData;
                    el.appendChild(option);
                });
            }

            if (field.source) {
                el.dataset.source = field.source;
            }

            el.addEventListener('change', (event) => {
                renderer.formData[field.key] = event.target.value;
                renderer.handleChange(field, event.target.value, 'change');

                if (field.presets && field.presets[event.target.value]) {
                    renderer.applyPresets(field.presets[event.target.value]);
                }
            });
        } else if (field.type === 'checkbox_group') {
            el = renderer.createCheckboxGroup(field);
        } else if (field.type === 'checkbox') {
            el = renderer.createCheckbox(field);
        } else if (field.type === 'textarea') {
            el = document.createElement('textarea');
            el.rows = field.rows || 4;
            el.placeholder = field.placeholder || '';
            if (field.readonly) {
                el.readOnly = true;
                el.style.background = '#f5f5f5';
                el.style.cursor = 'not-allowed';
            }
            el.addEventListener('input', (event) => {
                renderer.formData[field.key] = event.target.value;
            });
        } else if (field.type === 'image') {
            el = renderer.createImageUploader(field, false, pasteBtn);
        } else if (field.type === 'image_list') {
            el = renderer.createImageUploader(field, true, pasteBtn);
        } else {
            // Default: text input
            el = document.createElement('input');
            el.type = 'text';
            el.placeholder = field.placeholder || '';

            let initialValue = '';
            const shouldAutoGenerate = field.auto_generate === true || field.auto_generate === 'true';

            if (shouldAutoGenerate && field.auto_generate_rule) {
                initialValue = renderer.generateAutoValue(field.auto_generate_rule);
            } else if (field.default === 'today') {
                initialValue = new Date().toISOString().split('T')[0];
            } else if (field.default) {
                initialValue = field.default;
            }

            if (initialValue) {
                el.value = initialValue;
                renderer.formData[field.key] = initialValue;
            }

            el.addEventListener('input', (event) => {
                renderer.formData[field.key] = event.target.value;
                renderer.handleChange(field, event.target.value, 'input');
            });

            el.addEventListener('change', (event) => {
                renderer.formData[field.key] = event.target.value;
                renderer.handleChange(field, event.target.value, 'change');
            });
        }

        // ── Post-processing: id, name, readonly ────────────────────────
        if (el && el.tagName && field.type !== 'checkbox_group') {
            el.id = field.key;
            el.name = field.key;
        }

        if (el && field.readonly && el.tagName === 'INPUT') {
            el.readOnly = true;
            el.style.background = '#eee';
        }

        return el;
    }
};

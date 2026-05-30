// vuln_list.js — Dynamic vulnerability list widget
// Factory: window.__widgetFactories['vuln_list'](field, callbacks) → { container, destroy }
//
// Migrated from form-renderer.js (PR2.2: Widget Extraction)
// Adapted to use callbacks instead of this.xxx() for framework independence.

(function() {
    window.__widgetFactories = window.__widgetFactories || {};

    window.__widgetFactories['vuln_list'] = function(field, callbacks) {
        // ── Internal State ──────────────────────────────────────────────
        var dataArray = callbacks.getData() || [];
        var activeIndex = null;

        // ── Helper: Update data and notify framework ────────────────────
        function notifyDataChanged() {
            callbacks.setData(dataArray);
        }

        // ── Helper: getColumnConfig ─────────────────────────────────────
        function getColumnConfig(key) {
            if (field.columns && Array.isArray(field.columns)) {
                return field.columns.find(function(col) { return col.key === key; });
            }
            return null;
        }

        // ── Helper: buildFieldOptions ───────────────────────────────────
        function buildFieldOptions(column, fallbackOptions) {
            if (!column) return fallbackOptions || {};
            var opts = {};
            if (fallbackOptions) { for (var k in fallbackOptions) opts[k] = fallbackOptions[k]; }
            if (column.options) opts.options = column.options;
            if (column.placeholder) opts.placeholder = column.placeholder;
            if (column.rows) opts.rows = column.rows;
            if (column.help_text) opts.helpText = column.help_text;
            return opts;
        }

        // ── Helper: Risk level colors ───────────────────────────────────
        function getLevelColors() {
            return callbacks.getConfig('RISK_COLORS') || {
                '超危': '#8B0000', '高危': '#dc3545', '中危': '#fd7e14', '低危': '#28a745', '信息性': '#17a2b8'
            };
        }

        // ── Helper: Risk level options ──────────────────────────────────
        function getRiskLevelOptions() {
            var ds = callbacks.dataSources;
            if (ds && ds['config.risk_levels']) {
                return ds['config.risk_levels'].map(function(item) {
                    return { value: item.value, label: item.label };
                });
            }
            return [
                { value: '超危', label: '超危' },
                { value: '高危', label: '高危' },
                { value: '中危', label: '中危' },
                { value: '低危', label: '低危' },
                { value: '信息性', label: '信息性' }
            ];
        }

        // ── Vuln Card Content ───────────────────────────────────────────
        function createVulnCardContent(vulnIndex, vulnData) {
            var content = document.createElement('div');
            content.className = 'dynamic-vuln-card-content';

            // Row 0: vuln_system
            var row0 = document.createElement('div');
            row0.style.cssText = 'margin-bottom: 15px;';
            var systemCol = getColumnConfig('vuln_system');
            row0.appendChild(createVulnField(
                (systemCol && systemCol.label) || '所属系统',
                'text', vulnIndex, 'vuln_system', vulnData,
                buildFieldOptions(systemCol, { placeholder: '如：门户网站、OA系统（用于"XX存在XX漏洞"标题）' })
            ));
            content.appendChild(row0);

            // Row 1: vuln_level, vuln_location
            var row1 = document.createElement('div');
            row1.style.cssText = 'display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 15px;';
            var levelCol = getColumnConfig('vuln_level');
            row1.appendChild(createVulnField(
                (levelCol && levelCol.label) || '漏洞级别',
                'select', vulnIndex, 'vuln_level', vulnData,
                buildFieldOptions(levelCol, { options: getRiskLevelOptions() })
            ));
            var locationCol = getColumnConfig('vuln_location');
            row1.appendChild(createVulnField(
                (locationCol && locationCol.label) || '漏洞位置',
                'text', vulnIndex, 'vuln_location', vulnData,
                buildFieldOptions(locationCol, { placeholder: '如：登录页面' })
            ));
            content.appendChild(row1);

            // Row 1.5: vuln_url (textarea)
            var row1b = document.createElement('div');
            row1b.style.cssText = 'margin-bottom: 15px;';
            var urlCol = getColumnConfig('vuln_url');
            row1b.appendChild(createVulnField(
                (urlCol && urlCol.label) || 'URL/IP',
                'textarea', vulnIndex, 'vuln_url', vulnData,
                buildFieldOptions(urlCol, { rows: 2, placeholder: '漏洞所在URL或IP，多个地址请换行输入' })
            ));
            content.appendChild(row1b);

            // Row 2: vuln_description
            var row2 = document.createElement('div');
            row2.style.cssText = 'margin-bottom: 15px;';
            var descCol = getColumnConfig('vuln_description');
            row2.appendChild(createVulnField(
                (descCol && descCol.label) || '漏洞及风险描述',
                'textarea', vulnIndex, 'vuln_description', vulnData,
                buildFieldOptions(descCol, { rows: 3, placeholder: '漏洞详细描述' })
            ));
            content.appendChild(row2);

            // Row 3: vuln_evidence uploader
            var row3 = document.createElement('div');
            row3.style.cssText = 'margin-bottom: 15px;';
            row3.appendChild(createVulnEvidenceUploader(vulnIndex, vulnData));
            content.appendChild(row3);

            // Row 4: vuln_suggestion
            var row4 = document.createElement('div');
            row4.style.cssText = 'margin-bottom: 15px;';
            var suggestionCol = getColumnConfig('vuln_suggestion');
            row4.appendChild(createVulnField(
                (suggestionCol && suggestionCol.label) || '修复建议',
                'textarea', vulnIndex, 'vuln_suggestion', vulnData,
                buildFieldOptions(suggestionCol, { rows: 3, placeholder: '修复方案' })
            ));
            content.appendChild(row4);

            // Row 5: vuln_reference
            var row5 = document.createElement('div');
            var refCol = getColumnConfig('vuln_reference');
            row5.appendChild(createVulnField(
                (refCol && refCol.label) || '参考链接',
                'text', vulnIndex, 'vuln_reference', vulnData,
                buildFieldOptions(refCol, { placeholder: '可选' })
            ));
            content.appendChild(row5);

            return content;
        }

        // ── Remove Vuln Item ────────────────────────────────────────────
        function removeVulnItem(card, vulnIndex) {
            dataArray.splice(vulnIndex, 1);

            if (card && card.parentNode) card.parentNode.removeChild(card);

            var sidebarItem = document.getElementById(field.key + '_sidebar_item_' + vulnIndex);
            if (sidebarItem && sidebarItem.parentNode) sidebarItem.parentNode.removeChild(sidebarItem);

            reindexVulnItems();

            if (dataArray.length > 0) {
                selectVulnItem(0);
            } else {
                var emptyTip = document.getElementById(field.key + '_empty');
                if (emptyTip) emptyTip.style.display = 'block';
            }

            notifyDataChanged();
        }

        // ── Reindex Vuln Items ──────────────────────────────────────────
        function reindexVulnItems() {
            var sidebarList = document.getElementById(field.key + '_sidebar_list');
            var listWrapper = document.getElementById(field.key + '_list');

            if (sidebarList) {
                var items = sidebarList.querySelectorAll('.dynamic-vuln-sidebar-item');
                items.forEach(function(item, idx) {
                    item.id = field.key + '_sidebar_item_' + idx;
                    item.dataset.index = idx;
                    item.onclick = (function(i) { return function() { selectVulnItem(i); }; })(idx);
                    var nameSpan = item.querySelector('.vuln-sidebar-name');
                    if (nameSpan) {
                        nameSpan.textContent = (dataArray[idx] && dataArray[idx].vuln_name) || ('漏洞 ' + (idx + 1));
                    }
                });
            }

            if (listWrapper) {
                var cards = listWrapper.querySelectorAll('.dynamic-vuln-item-card');
                cards.forEach(function(card, idx) {
                    card.id = field.key + '_card_' + idx;
                    card.dataset.index = idx;
                    var badge = card.querySelector('.dynamic-vuln-index-badge');
                    if (badge) badge.textContent = '漏洞 ' + (idx + 1);

                    var inputs = card.querySelectorAll('input, select, textarea, div[id*="_evidence_preview"]');
                    inputs.forEach(function(el) {
                        if (el.id) {
                            var prefixRegex = new RegExp('^' + field.key + '_\\d+_');
                            if (prefixRegex.test(el.id)) {
                                el.id = el.id.replace(prefixRegex, field.key + '_' + idx + '_');
                            }
                        }
                    });
                });
            }
        }

        // ── Create Vuln Field ───────────────────────────────────────────
        function createVulnField(label, type, vulnIndex, key, vulnData, options) {
            options = options || {};
            var wrapper = document.createElement('div');
            var labelEl = document.createElement('label');
            labelEl.textContent = label;
            labelEl.style.cssText = 'display: block; margin-bottom: 5px; font-weight: 500;';
            wrapper.appendChild(labelEl);

            var input;
            var fieldId = field.key + '_' + vulnIndex + '_' + key;

            if (type === 'select') {
                input = document.createElement('select');
                input.style.cssText = 'width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;';
                if (options.options) {
                    options.options.forEach(function(opt) {
                        var option = document.createElement('option');
                        option.value = opt.value;
                        option.textContent = opt.label;
                        if (opt.value === vulnData[key]) option.selected = true;
                        input.appendChild(option);
                    });
                }
                input.addEventListener('change', function(e) {
                    vulnData[key] = e.target.value;
                    notifyDataChanged();
                });
            } else if (type === 'textarea') {
                input = document.createElement('textarea');
                input.rows = options.rows || 3;
                input.placeholder = options.placeholder || '';
                input.style.cssText = 'width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; resize: vertical;';
                input.value = vulnData[key] || '';
                input.addEventListener('input', function(e) {
                    vulnData[key] = e.target.value;
                    notifyDataChanged();
                });
            } else {
                input = document.createElement('input');
                input.type = 'text';
                input.placeholder = options.placeholder || '';
                input.style.cssText = 'width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;';
                input.value = vulnData[key] || '';
                input.addEventListener('input', function(e) { vulnData[key] = e.target.value; });
            }

            input.id = fieldId;
            wrapper.appendChild(input);
            return wrapper;
        }

        // ── Create Vuln Evidence Uploader ───────────────────────────────
        function createVulnEvidenceUploader(vulnIndex, vulnData) {
            var wrapper = document.createElement('div');

            var labelRow = document.createElement('div');
            labelRow.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;';

            var label = document.createElement('label');
            label.textContent = '漏洞举证截图';
            label.style.cssText = 'font-weight: 500;';
            labelRow.appendChild(label);

            var pasteBtn = document.createElement('button');
            pasteBtn.type = 'button';
            pasteBtn.className = 'btn-mini';
            pasteBtn.textContent = '粘贴截图';
            labelRow.appendChild(pasteBtn);
            wrapper.appendChild(labelRow);

            var uploadArea = document.createElement('div');
            uploadArea.style.cssText = 'border: 2px dashed #ddd; border-radius: 8px; padding: 20px; text-align: center; cursor: pointer; background: #fff;';
            uploadArea.innerHTML = '<span style="color: #999;">点击上传或拖拽图片</span>';
            wrapper.appendChild(uploadArea);

            var previewContainer = document.createElement('div');
            previewContainer.id = field.key + '_' + vulnIndex + '_evidence_preview';
            previewContainer.style.cssText = 'margin-top: 10px;';
            wrapper.appendChild(previewContainer);

            if (!vulnData.vuln_evidence) vulnData.vuln_evidence = [];

            uploadArea.onclick = function() {
                var inputEl = document.createElement('input');
                inputEl.type = 'file';
                inputEl.accept = 'image/*';
                inputEl.multiple = true;
                inputEl.onchange = async function(e) {
                    var files = e.target.files;
                    for (var i = 0; i < files.length; i++) {
                        var result = await callbacks.uploadImage(files[i]);
                        if (result) addVulnEvidenceItem(vulnData, result, previewContainer);
                    }
                };
                inputEl.click();
            };

            pasteBtn.onclick = async function(e) {
                e.preventDefault();
                try {
                    var items = await navigator.clipboard.read();
                    for (var i = 0; i < items.length; i++) {
                        var item = items[i];
                        var imgType = item.types.find(function(t) { return t.startsWith('image/'); });
                        if (imgType) {
                            var blob = await item.getType(imgType);
                            var result = await callbacks.uploadImage(blob);
                            if (result) addVulnEvidenceItem(vulnData, result, previewContainer);
                        }
                    }
                } catch (err) {
                    callbacks.toast && callbacks.toast("无法读取剪贴板");
                }
            };

            return wrapper;
        }

        // ── Add Vuln Evidence Item ──────────────────────────────────────
        function addVulnEvidenceItem(vulnData, imageInfo, container) {
            var baseUrl = callbacks.getConfig('BASE_URL') || '';
            var fullUrl = baseUrl + imageInfo.url;

            var wrapper = document.createElement('div');
            wrapper.style.cssText = 'display: flex; gap: 10px; margin-bottom: 10px; padding: 10px; background: #f9f9f9; border: 1px solid #eee; border-radius: 4px;';

            var img = document.createElement('img');
            img.src = fullUrl;
            img.style.cssText = 'max-width: 150px; max-height: 100px; border: 1px solid #ccc; cursor: zoom-in;';
            img.onclick = function() { callbacks.openImagePreview && callbacks.openImagePreview(fullUrl, '漏洞举证'); };
            wrapper.appendChild(img);

            var textarea = document.createElement('textarea');
            textarea.rows = 2;
            textarea.placeholder = '截图说明';
            textarea.style.cssText = 'flex: 1; padding: 6px; border: 1px solid #ddd; border-radius: 4px;';
            wrapper.appendChild(textarea);

            var delBtn = document.createElement('button');
            delBtn.type = 'button';
            delBtn.textContent = '删除';
            delBtn.style.cssText = 'background: #ff4d4f; color: white; border: none; padding: 5px 10px; cursor: pointer; border-radius: 4px;';
            wrapper.appendChild(delBtn);

            var evidenceObj = { path: imageInfo.file_path, description: '' };
            vulnData.vuln_evidence.push(evidenceObj);

            textarea.addEventListener('input', function(e) { evidenceObj.description = e.target.value; });
            delBtn.onclick = function() {
                wrapper.remove();
                var idx = vulnData.vuln_evidence.indexOf(evidenceObj);
                if (idx > -1) vulnData.vuln_evidence.splice(idx, 1);
            };

            container.appendChild(wrapper);
        }

        // ── Fill Vuln Item From Library ─────────────────────────────────
        function fillVulnItemFromLibrary(vulnIndex, vulnData, libraryData) {
            vulnData.vuln_name = libraryData.Vuln_Name || libraryData.name || '';
            vulnData.vuln_level = libraryData.Risk_Level || libraryData.level || '中危';
            vulnData.vuln_description = libraryData.Vuln_Description || libraryData.description || '';
            vulnData.vuln_suggestion = libraryData.Repair_suggestions || libraryData.suggestion || '';

            var prefix = field.key + '_' + vulnIndex;

            var levelSelect = document.getElementById(prefix + '_vuln_level');
            if (levelSelect) {
                levelSelect.value = vulnData.vuln_level;
                levelSelect.dispatchEvent(new Event('change'));
            }

            var descTextarea = document.getElementById(prefix + '_vuln_description');
            if (descTextarea) descTextarea.value = vulnData.vuln_description;

            var suggTextarea = document.getElementById(prefix + '_vuln_suggestion');
            if (suggTextarea) suggTextarea.value = vulnData.vuln_suggestion;

            updateVulnSidebarItem(vulnIndex, vulnData);

            notifyDataChanged();
        }

        // ── Update Vuln Sidebar Item ────────────────────────────────────
        function updateVulnSidebarItem(vulnIndex, vulnData) {
            var sidebarItem = document.getElementById(field.key + '_sidebar_item_' + vulnIndex);
            if (!sidebarItem) return;

            var levelColors = getLevelColors();

            var nameSpan = sidebarItem.querySelector('.vuln-sidebar-name');
            if (nameSpan) {
                nameSpan.textContent = vulnData.vuln_name || ('漏洞 ' + (vulnIndex + 1));
                nameSpan.title = vulnData.vuln_name || '';
            }

            var levelDot = sidebarItem.querySelector('.vuln-level-dot');
            if (levelDot) {
                levelDot.style.background = levelColors[vulnData.vuln_level] || '#fd7e14';
            }
        }

        // ── Create Vuln Name Selector ───────────────────────────────────
        function createVulnNameSelector(card, vulnData) {
            var container = document.createElement('div');
            container.style.cssText = 'display: flex; gap: 8px;';

            var searchInput = document.createElement('input');
            searchInput.type = 'text';
            searchInput.placeholder = '搜索或输入漏洞名称...';
            searchInput.style.cssText = 'flex: 1; padding: 6px 10px; border: 1px solid #ddd; border-radius: 4px;';

            var select = document.createElement('select');
            select.style.cssText = 'flex: 1; padding: 6px; border: 1px solid #ddd; border-radius: 4px;';

            var emptyOpt = document.createElement('option');
            emptyOpt.value = '';
            emptyOpt.textContent = '-- 从漏洞库选择 --';
            select.appendChild(emptyOpt);

            var vulnsSource = callbacks.dataSources && callbacks.dataSources.vulnerabilities;
            if (vulnsSource) {
                vulnsSource.forEach(function(v) {
                    var opt = document.createElement('option');
                    opt.value = v.Vuln_id || v.id || v.name;
                    opt.textContent = v.Vuln_Name || v.name;
                    opt.dataset.vulnData = JSON.stringify(v);
                    select.appendChild(opt);
                });
            }

            container._allOptions = Array.prototype.slice.call(select.options, 1).map(function(o) {
                return { value: o.value, text: o.textContent, data: o.dataset.vulnData };
            });

            searchInput.addEventListener('input', function(e) {
                var term = e.target.value.toLowerCase().trim();
                select.innerHTML = '<option value="">-- 从漏洞库选择 --</option>';
                container._allOptions.forEach(function(opt) {
                    if (!term || opt.text.toLowerCase().indexOf(term) !== -1) {
                        var option = document.createElement('option');
                        option.value = opt.value;
                        option.textContent = opt.text;
                        option.dataset.vulnData = opt.data;
                        select.appendChild(option);
                    }
                });
                vulnData.vuln_name = e.target.value;
            });

            select.addEventListener('change', async function(e) {
                var selectedOpt = e.target.selectedOptions[0];
                if (selectedOpt && selectedOpt.value) {
                    var vulnId = selectedOpt.value;
                    var vulnName = selectedOpt.textContent;
                    searchInput.value = vulnName || '';

                    var currentIdx = parseInt(card.dataset.index);

                    try {
                        var vulnEndpoint = field.vuln_lookup_endpoint || '@service/vulnerability-lookup/';
                        var vData = await callbacks.apiRequest(vulnEndpoint + encodeURIComponent(vulnId));
                        if (vData && !vData.error) {
                            fillVulnItemFromLibrary(currentIdx, vulnData, vData);
                        }
                    } catch (err) {
                        console.error('[vuln_list widget] Failed to fetch vulnerability details:', err);
                        if (selectedOpt.dataset.vulnData) {
                            var cachedData = JSON.parse(selectedOpt.dataset.vulnData);
                            fillVulnItemFromLibrary(currentIdx, vulnData, cachedData);
                        }
                    }
                }
            });

            container.appendChild(searchInput);
            container.appendChild(select);
            return container;
        }

        // ── Create Vuln Card Header ─────────────────────────────────────
        function createVulnCardHeader(vulnIndex, card, vulnData) {
            var header = document.createElement('div');
            header.className = 'dynamic-vuln-card-header';
            header.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; padding-bottom: 10px; border-bottom: 1px solid #eee;';

            var leftSection = document.createElement('div');
            leftSection.style.cssText = 'display: flex; align-items: center; gap: 15px; flex: 1;';

            var indexBadge = document.createElement('span');
            indexBadge.className = 'dynamic-vuln-index-badge';
            indexBadge.style.cssText = 'background: var(--primary-color, #1890ff); color: white; padding: 4px 12px; border-radius: 4px; font-weight: bold;';
            indexBadge.textContent = '漏洞 ' + (vulnIndex + 1);
            leftSection.appendChild(indexBadge);

            var nameWrapper = document.createElement('div');
            nameWrapper.style.cssText = 'flex: 1; max-width: 400px;';
            nameWrapper.appendChild(createVulnNameSelector(card, vulnData));
            leftSection.appendChild(nameWrapper);

            header.appendChild(leftSection);

            var rightSection = document.createElement('div');
            rightSection.style.cssText = 'display: flex; gap: 10px;';

            var delBtn = document.createElement('button');
            delBtn.type = 'button';
            delBtn.className = 'btn-mini btn-delete-vuln';
            delBtn.style.cssText = 'background: #ff4d4f; color: white; border: none; padding: 5px 12px; cursor: pointer; border-radius: 4px;';
            delBtn.textContent = '删除';
            delBtn.onclick = function() {
                var currentIdx = parseInt(card.dataset.index);
                removeVulnItem(card, currentIdx);
            };
            rightSection.appendChild(delBtn);

            header.appendChild(rightSection);
            return header;
        }

        // ── Create Vuln Card ────────────────────────────────────────────
        function createVulnCard(vulnIndex, vulnData) {
            var card = document.createElement('div');
            card.className = 'dynamic-vuln-item-card';
            card.id = field.key + '_card_' + vulnIndex;
            card.dataset.index = vulnIndex;
            card.style.cssText = 'border: 1px solid #e0e0e0; border-radius: 8px; padding: 20px; background: #fff; display: none;';

            card.appendChild(createVulnCardHeader(vulnIndex, card, vulnData));
            card.appendChild(createVulnCardContent(vulnIndex, vulnData));

            return card;
        }

        // ── Select Vuln Item ────────────────────────────────────────────
        function selectVulnItem(vulnIndex) {
            activeIndex = vulnIndex;

            var sidebarItems = container.querySelectorAll('#' + field.key + '_sidebar_list .dynamic-vuln-sidebar-item');
            sidebarItems.forEach(function(item) {
                item.classList.remove('active');
                item.style.background = 'transparent';
                item.style.borderColor = 'transparent';
            });

            var activeItem = document.getElementById(field.key + '_sidebar_item_' + vulnIndex);
            if (activeItem) {
                activeItem.classList.add('active');
                activeItem.style.background = '#e6f7ff';
                activeItem.style.borderColor = '#1890ff';
            }

            var cards = container.querySelectorAll('#' + field.key + '_list .dynamic-vuln-item-card');
            cards.forEach(function(card) { card.style.display = 'none'; });

            var activeCard = document.getElementById(field.key + '_card_' + vulnIndex);
            if (activeCard) activeCard.style.display = 'block';
        }

        // ── Add Vuln Sidebar Item ───────────────────────────────────────
        function addVulnSidebarItem(vulnIndex, vulnData, sidebarList) {
            var item = document.createElement('div');
            item.className = 'dynamic-vuln-sidebar-item';
            item.id = field.key + '_sidebar_item_' + vulnIndex;
            item.dataset.index = vulnIndex;
            item.style.cssText = 'padding: 10px; margin-bottom: 5px; border-radius: 6px; cursor: pointer; border: 1px solid transparent; transition: all 0.2s;';

            var levelColors = getLevelColors();

            item.innerHTML =
                '<div style="display: flex; align-items: center; gap: 8px;">' +
                '<span class="vuln-level-dot" style="width: 8px; height: 8px; border-radius: 50%; background: ' + (levelColors[vulnData.vuln_level] || '#fd7e14') + ';"></span>' +
                '<span class="vuln-sidebar-name" style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px;">漏洞 ' + (vulnIndex + 1) + '</span>' +
                '</div>';

            item.onclick = (function(idx) { return function() { selectVulnItem(idx); }; })(vulnIndex);

            item.onmouseenter = function() { if (!item.classList.contains('active')) item.style.background = '#f0f0f0'; };
            item.onmouseleave = function() { if (!item.classList.contains('active')) item.style.background = 'transparent'; };

            sidebarList.appendChild(item);
        }

        // ── Add Vuln Item ───────────────────────────────────────────────
        function addVulnItem() {
            var listWrapper = document.getElementById(field.key + '_list');
            var sidebarList = document.getElementById(field.key + '_sidebar_list');
            var emptyTip = document.getElementById(field.key + '_empty');
            if (!listWrapper) return;

            if (emptyTip) emptyTip.style.display = 'none';

            var vulnIndex = dataArray.length;
            var vulnData = {
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
            dataArray.push(vulnData);

            addVulnSidebarItem(vulnIndex, vulnData, sidebarList);

            var card = createVulnCard(vulnIndex, vulnData);
            listWrapper.appendChild(card);

            selectVulnItem(vulnIndex);

            notifyDataChanged();
        }

        // ── Main: Create Vuln List Container ────────────────────────────
        var container = document.createElement('div');
        container.className = 'dynamic-vuln-list-container';
        container.id = field.key;
        container.style.cssText = 'display: flex; gap: 20px; min-height: 400px;';

        // Left: Sidebar
        var sidebar = document.createElement('div');
        sidebar.className = 'dynamic-vuln-sidebar';
        sidebar.id = field.key + '_sidebar';
        sidebar.style.cssText = 'width: 200px; flex-shrink: 0; border: 1px solid #e0e0e0; border-radius: 8px; background: #fafafa; padding: 10px;';

        var sidebarTitle = document.createElement('div');
        sidebarTitle.style.cssText = 'font-weight: bold; padding: 8px; border-bottom: 1px solid #e0e0e0; margin-bottom: 10px;';
        sidebarTitle.textContent = '漏洞列表';
        sidebar.appendChild(sidebarTitle);

        var sidebarList = document.createElement('div');
        sidebarList.className = 'dynamic-vuln-sidebar-list';
        sidebarList.id = field.key + '_sidebar_list';
        sidebar.appendChild(sidebarList);

        var addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'btn btn-primary';
        addBtn.style.cssText = 'width: 100%; padding: 8px; margin-top: 10px; font-size: 13px;';
        addBtn.innerHTML = '+ 添加漏洞';
        addBtn.onclick = addVulnItem;
        sidebar.appendChild(addBtn);

        container.appendChild(sidebar);

        // Right: Main Content
        var mainContent = document.createElement('div');
        mainContent.className = 'dynamic-vuln-main-content';
        mainContent.id = field.key + '_list';
        mainContent.style.cssText = 'flex: 1; min-width: 0;';

        var emptyTip = document.createElement('div');
        emptyTip.className = 'dynamic-vuln-empty-tip';
        emptyTip.id = field.key + '_empty';
        emptyTip.style.cssText = 'text-align: center; padding: 60px 20px; color: #999; border: 2px dashed #e0e0e0; border-radius: 8px;';
        emptyTip.innerHTML = '<div style="font-size: 48px; margin-bottom: 15px;">📋</div><div>暂无漏洞，点击左侧"添加漏洞"开始</div>';
        mainContent.appendChild(emptyTip);

        container.appendChild(mainContent);

        // ── Initialize: Render existing items ───────────────────────────
        if (dataArray.length > 0) {
            emptyTip.style.display = 'none';
            dataArray.forEach(function(vulnData, idx) {
                addVulnSidebarItem(idx, vulnData, sidebarList);
                var card = createVulnCard(idx, vulnData);
                mainContent.appendChild(card);
            });
            selectVulnItem(0);
        }

        // ── Return widget API ───────────────────────────────────────────
        return {
            container: container,
            destroy: function() {
                if (container.parentNode) container.parentNode.removeChild(container);
                dataArray = null;
                activeIndex = null;
            }
        };
    };
})();

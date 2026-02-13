// api.js - API 接口交互

window.AppAPI = {
    // 优先使用 Electron 注入的配置，其次使用 AppConfig，最后使用默认值
    get BASE_URL() {
        return (window.electronConfig && window.electronConfig.apiBaseUrl)
            || (window.AppConfig && window.AppConfig.API && window.AppConfig.API.BASE_URL) 
            || "http://127.0.0.1:8000";
    },

    async _request(endpoint, method = 'GET', body = null) {
        const options = {
            method,
            headers: {}
        };
        if (body) {
            if (body instanceof FormData) {
                options.body = body;
            } else {
                options.headers['Content-Type'] = 'application/json';
                options.body = JSON.stringify(body);
            }
        }
        
        try {
            const res = await fetch(`${this.BASE_URL}${endpoint}`, options);
            if (!res.ok) {
                const errorData = await res.json().catch(() => ({}));
                throw new Error(errorData.detail || errorData.message || `API Error: ${res.status}`);
            }
            return await res.json();
        } catch (e) {
            throw e;
        }
    },

    // --- Core ---

    // 初始化检查
    async checkConnection() {
        return this._request('/api/config');
    },

    async getConfig() {
        return this._request('/api/config');
    },
    
    async updateConfig(data) {
        return this._request('/api/update-config', 'POST', data);
    },

    // URL 处理
    async processUrl(url) {
        return this._request('/api/process-url', 'POST', { url });
    },

    // 打开文件夹
    async openFolder(path) {
        return this._request('/api/open-folder', 'POST', { path });
    },

    async uploadImage(base64Data, filename) {
        return this._request('/api/upload-image', 'POST', { 
            image_base64: base64Data, 
            filename 
        });
    },

    async backupDatabase() {
        // Blob downloading is special, so we might need custom logic or just window.open
        window.open(`${this.BASE_URL}/api/backup-db`);
    },

    // --- Vulnerabilities ---

    async getVulnerabilities() {
        return this._request('/api/vulnerabilities');
    },

    async saveVulnerability(data) {
        // Decide create or update based on logic or pass ID separately
        // But backend uses PUT for update by ID and POST for create
        // Helper to check if it's an update probably needs ID
        // For simplicity let the caller decide or auto-detect
        return this._request('/api/vulnerabilities', 'POST', data);
    },

    async updateVulnerability(id, data) {
         return this._request(`/api/vulnerabilities/${encodeURIComponent(id)}`, 'PUT', data);
    },

    async deleteVulnerability(id) {
         return this._request(`/api/vulnerabilities/${encodeURIComponent(id)}`, 'DELETE');
     },

    // Vulnerabilities CRUD object for CRUDManager
    Vulnerabilities: {
        async save(data) {
            if (data.id) {
                return window.AppAPI.updateVulnerability(data.id, data);
            } else {
                return window.AppAPI.saveVulnerability(data);
            }
        },
        
        async delete(id) {
            return window.AppAPI.deleteVulnerability(id);
        }
    },

     // --- Templates ---
    
    Templates: {
        async list(includeDetails = false) {
            return window.AppAPI._request(`/api/templates?include_details=${includeDetails}`);
        },
        
        async getSchema(id) {
            return window.AppAPI._request(`/api/templates/${id}/schema`);
        },
        
        async getDataSources(id) {
            return window.AppAPI._request(`/api/templates/${id}/data-sources`);
        },
        
        async reload() {
            return window.AppAPI._request('/api/templates/reload', 'POST');
        },
        
        async generate(id, data) {
            return window.AppAPI._request(`/api/templates/${id}/generate`, 'POST', data);
        },
        
        async import(file, overwrite = false) {
            const formData = new FormData();
            formData.append('file', file);
            formData.append('overwrite', overwrite);
            return window.AppAPI._request('/api/templates/import', 'POST', formData);
        },
        
        async batchImport(files, overwrite = false) {
            const formData = new FormData();
            for(let i=0; i<files.length; i++) {
                formData.append('files', files[i]);
            }
            formData.append('overwrite', overwrite);
            return window.AppAPI._request('/api/templates/batch-import', 'POST', formData);
        },
        
        // Export is a download, usually via GET
        exportUrl(id) {
            return `${window.AppAPI.BASE_URL}/api/templates/${id}/export`;
        },
        
        async save(data) {
            // Templates don't have a traditional save operation
            // This is a placeholder for CRUDManager compatibility
            return { message: '模板操作成功' };
        },
        
        async delete(id) {
             return window.AppAPI._request(`/api/templates/${id}`, 'DELETE');
        }
    },

    // --- Reports ---

    Reports: {
        async list() {
            return window.AppAPI._request('/api/list-reports', 'POST'); 
        },
        
        async save(data) {
            // Reports don't have a traditional save operation
            // This is a placeholder for CRUDManager compatibility
            return { message: '报告操作成功' };
        },
        
        async delete(path) {
            return window.AppAPI._request('/api/delete-report', 'POST', { path });
        },
        
        async merge(files, filename) {
             return window.AppAPI._request('/api/merge-reports', 'POST', { files, output_filename: filename });
        }
    },
    
    // --- ICP ---
    
    Icp: {
        async list() {
            return window.AppAPI._request('/api/icp-list');
        },
        
        async save(data) {
            if (data.id) {
                return window.AppAPI.Icp.update(data.id, data);
            } else {
                return window.AppAPI.Icp.add(data);
            }
        },
        
        async add(data) {
             return window.AppAPI._request('/api/icp-entry', 'POST', data);
        },
        
        async update(id, data) {
             return window.AppAPI._request(`/api/icp-entry/${id}`, 'PUT', data);
        },
        
        async delete(id) {
             return window.AppAPI._request(`/api/icp-entry/${id}`, 'DELETE');
        },
        
        async batchDelete(ids) {
             return window.AppAPI._request('/api/icp-batch-delete', 'POST', { ids });
        }
    }
};

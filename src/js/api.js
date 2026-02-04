// api.js - API 接口交互

window.AppAPI = {
    // 优先使用 Electron 注入的配置，其次使用 AppConfig，最后使用默认值
    get BASE_URL() {
        return (window.electronConfig && window.electronConfig.apiBaseUrl)
            || (window.AppConfig && window.AppConfig.API && window.AppConfig.API.BASE_URL) 
            || "http://127.0.0.1:8000";
    },

    // 初始化检查
    async checkConnection() {
        try {
            const res = await fetch(`${this.BASE_URL}/api/config`);
            if (!res.ok) throw new Error("API not ready");
            return await res.json();
        } catch (e) {
            throw e;
        }
    },

    // URL 处理
    async processUrl(url) {
        const res = await fetch(`${this.BASE_URL}/api/process-url`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({url})
        });
        return await res.json();
    },

    // 打开文件夹
    async openFolder(path) {
        return await fetch(`${this.BASE_URL}/api/open-folder`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ path })
        }).then(r => r.json());
    },

    // 漏洞列表
    async getVulnerabilities() {
        const res = await fetch(`${this.BASE_URL}/api/vulnerabilities`);
        return await res.json();
    }
};

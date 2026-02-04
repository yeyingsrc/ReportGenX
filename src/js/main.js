// main.js - 主程序入口
// 动态表单架构：所有表单由 form-renderer.js 根据模板 schema 动态生成

window.addEventListener('DOMContentLoaded', async () => {
    // --- Init Modules ---
    if (window.AppImage) AppImage.init();
    if (window.AppVulnManager) AppVulnManager.init();
    if (window.AppToolbox) AppToolbox.init();
    if (window.AppFormRenderer) AppFormRenderer.init();
    if (window.AppTemplateManager) AppTemplateManager.init();

    // --- Global Refs ---
    const statusDot = document.getElementById('api-status-dot');
    const statusText = document.getElementById('api-status-text');

    // --- Init App ---
    async function initApp() {
        try {
            const config = await AppAPI.checkConnection();

            // 更新连接状态
            statusDot.classList.remove('error');
            statusDot.classList.add('connected');
            statusText.innerText = "Connected";
            statusText.style.color = "green";
            
            const connectionInfo = `后端地址: ${AppAPI.BASE_URL}`;
            statusDot.title = connectionInfo;
            statusText.title = connectionInfo;
            
            const versionEl = document.getElementById('version-info');
            if (versionEl) versionEl.innerText = config.version || '';

            // 同步漏洞列表到 VulnManager
            if (window.AppVulnManager && config.vulnerabilities_list) {
                window.AppVulnManager.VULN_LIST = config.vulnerabilities_list;
            }
            
            // 加载模板列表并渲染默认模板表单
            if (window.AppFormRenderer && window.AppFormRenderer.loadTemplateList) {
                await AppFormRenderer.loadTemplateList();
            }

        } catch (e) {
            console.error("Init failed", e);
            statusDot.classList.remove('connected');
            statusDot.classList.add('error');
            statusText.innerText = "Connecting...";
            statusText.style.color = "#999";
            setTimeout(initApp, 2000);
        }
    }
    
    initApp();

    // --- Global Shortcuts ---
    document.addEventListener('keydown', (e) => {
        // Ctrl+Enter: 生成报告
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            const btnGen = document.getElementById('btn-dynamic-generate');
            if (btnGen && !btnGen.disabled) btnGen.click();
        }

        // Esc: 关闭模态框
        if (e.key === 'Escape') {
            // 模板详情模态框
            const templateDetailModal = document.getElementById('template-detail-modal');
            if (templateDetailModal && templateDetailModal.style.display !== 'none') {
                templateDetailModal.style.display = 'none';
                return;
            }
            // 图片预览模态框
            const imgModal = document.getElementById('form-image-preview-modal');
            if (imgModal && imgModal.style.display !== 'none') {
                if (window.AppFormRenderer) AppFormRenderer.closeImagePreview();
                return;
            }
            // 工具箱模态框
            const toolbox = document.getElementById('toolbox-modal');
            if (toolbox && toolbox.style.display !== 'none') {
                toolbox.style.display = 'none';
                return;
            }
        }
    });
});

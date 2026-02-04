/**
 * ReportGenX 前端全局配置
 * 此文件集中管理前端所有可配置项，避免硬编码分散在各处
 */

window.AppConfig = {
  // =========================================================================
  // API 配置 - 优先使用 Electron 注入的配置
  // =========================================================================
  API: {
    get BASE_URL() {
      return (window.electronConfig && window.electronConfig.apiBaseUrl) 
        || "http://127.0.0.1:8000";
    },
    TIMEOUT: 30000,
    RETRY_DELAY: 2000
  },

  // =========================================================================
  // 缓存配置
  // =========================================================================
  CACHE: {
    EXPIRY_MS: 5 * 60 * 1000,  // 5分钟
    MAX_ENTRIES: 100
  },

  // =========================================================================
  // 文件上传配置
  // =========================================================================
  FILE: {
    MAX_SIZE: 50 * 1024 * 1024,  // 50MB
    MAX_SIZE_MB: 50,
    ALLOWED_IMAGE_TYPES: ['image/jpeg', 'image/png', 'image/gif', 'image/bmp'],
    ALLOWED_EXTENSIONS: '.png,.jpg,.jpeg,.gif,.bmp'
  },

  // =========================================================================
  // UI 配置
  // =========================================================================
  UI: {
    MAX_LIST_ITEMS: 500,
    MODAL_CLOSE_DELAY: 300,
    SIDEBAR_WIDTH: '200px',
    MIN_CONTAINER_HEIGHT: '400px'
  },

  // =========================================================================
  // Z-Index 层级配置
  // =========================================================================
  Z_INDEX: {
    STICKY_HEADER: 10,
    DROPDOWN: 100,
    SUBMIT_SECTION: 100,
    TOOLTIP: 1000,
    MODAL: 2000
  },

  // =========================================================================
  // 主题配置 - 风险等级颜色（与后端 config.yaml 保持同步）
  // =========================================================================
  THEME: {
    RISK_COLORS: {
      '超危': '#8B0000',
      '高危': '#dc3545',
      '中危': '#fd7e14',
      '低危': '#28a745',
      '信息性': '#17a2b8'
    },
    // 通用颜色
    COLORS: {
      PRIMARY: '#1890ff',
      SUCCESS: '#28a745',
      WARNING: '#fd7e14',
      DANGER: '#dc3545',
      INFO: '#17a2b8',
      MUTED: '#6c757d',
      LIGHT_BG: '#f8f9fa',
      BORDER: '#dee2e6',
      HOVER_BG: '#e9ecef'
    }
  },

  // =========================================================================
  // 默认值配置
  // =========================================================================
  DEFAULTS: {
    PORT: '80',
    EXAMPLE_URL: 'http://example.com',
    EXAMPLE_IP: '192.168.1.100'
  }
};

/**
 * 从后端同步共享配置（风险等级等）
 * 在应用初始化时调用
 */
window.AppConfig.syncFromBackend = async function() {
  try {
    const response = await fetch(`${this.API.BASE_URL}/api/frontend-config`);
    if (response.ok) {
      const backendConfig = await response.json();
      // 同步风险等级颜色
      if (backendConfig.risk_levels) {
        this.THEME.RISK_COLORS = {};
        backendConfig.risk_levels.forEach(level => {
          this.THEME.RISK_COLORS[level.value] = level.color;
        });
      }
      console.log('[AppConfig] 已从后端同步配置');
    }
  } catch (error) {
    console.warn('[AppConfig] 无法从后端同步配置，使用默认值:', error.message);
  }
};

/**
 * 获取风险等级颜色
 * @param {string} level - 风险等级名称
 * @returns {string} 颜色值
 */
window.AppConfig.getRiskColor = function(level) {
  return this.THEME.RISK_COLORS[level] || this.THEME.COLORS.MUTED;
};

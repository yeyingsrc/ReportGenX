/**
 * @Createtime: 2026-02-13
 * @description: Generic CRUD Manager - Consolidates async CRUD patterns
 * Eliminates 15+ duplicated methods across vuln-manager, template-manager, toolbox
 * Based on Context7 CRUD framework patterns
 */

/**
 * Generic CRUD Manager Class
 * 
 * Consolidates common CRUD operations (load, save, delete, batchDelete)
 * across all manager modules.
 * 
 * Eliminates ~12 duplicated methods per manager.
 * 
 * Usage:
 *   const crud = new CRUDManager(
 *     apiClient,                    // API client with save/delete methods
 *     (items) => displayItems(items), // Display function
 *     () => loadItems()              // Load function
 *   );
 *   
 *   await crud.load();
 *   await crud.save(data);
 *   await crud.delete(id);
 */
class CRUDManager {
  /**
   * Initialize CRUD manager
   * 
   * @param {Object} apiClient - API client with save/delete/batchDelete methods
   * @param {Function} displayFunc - Function to display items (items) => void
   * @param {Function} loadFunc - Function to load items () => Promise<Array>
   * @param {Object} options - Optional configuration
   */
  constructor(apiClient, displayFunc, loadFunc, options = {}) {
    this.api = apiClient;
    this.displayFunc = displayFunc;
    this.loadFunc = loadFunc;
    this.items = [];
    this.options = {
      successMessage: options.successMessage || '操作成功',
      errorMessage: options.errorMessage || '操作失败',
      confirmMessage: options.confirmMessage || '确定要执行此操作?',
      ...options
    };
  }

  /**
   * Load items from API and display
   * 
   * @returns {Promise<Array>} Loaded items
   */
  async load() {
    try {
      this.items = await this.loadFunc();
      this.displayFunc(this.items);
      return this.items;
    } catch (error) {
      AppUtils.showToast(`加载失败: ${error.message}`, 'error');
      throw error;
    }
  }

  /**
   * Save item (create or update)
   * 
   * @param {Object} data - Item data to save
   * @param {Object} options - Optional save options
   * @returns {Promise<Object>} API response
   */
  async save(data, options = {}) {
    try {
      const result = await this.api.save(data);
      const message = options.successMessage || this.options.successMessage;
      AppUtils.showToast(result.message || message, 'success');
      await this.load();
      return result;
    } catch (error) {
      const message = options.errorMessage || this.options.errorMessage;
      AppUtils.showToast(`${message}: ${error.message}`, 'error');
      throw error;
    }
  }

  /**
   * Delete single item with confirmation
   * 
   * @param {string|number} id - Item ID to delete
   * @param {Object} options - Optional delete options
   * @returns {Promise<Object>} API response
   */
  async delete(id, options = {}) {
    const confirmMsg = options.confirmMessage || this.options.confirmMessage;
    
    if (await AppUtils.safeConfirm(confirmMsg)) {
      try {
        const result = await this.api.delete(id);
        AppUtils.showToast(result.message || '删除成功', 'success');
        await this.load();
        return result;
      } catch (error) {
        AppUtils.showToast(`删除失败: ${error.message}`, 'error');
        throw error;
      }
    }
  }

  /**
   * Delete multiple items with confirmation
   * 
   * @param {Array<string|number>} ids - Item IDs to delete
   * @param {Object} options - Optional delete options
   * @returns {Promise<Object>} API response
   */
  async batchDelete(ids, options = {}) {
    if (!ids || ids.length === 0) {
      AppUtils.showToast('请选择要删除的项目', 'warning');
      return;
    }

    const confirmMsg = options.confirmMessage || `确定要删除选中的 ${ids.length} 项?`;
    
    if (await AppUtils.safeConfirm(confirmMsg)) {
      try {
        const result = await this.api.batchDelete(ids);
        AppUtils.showToast(result.message || '批量删除成功', 'success');
        await this.load();
        return result;
      } catch (error) {
        AppUtils.showToast(`批量删除失败: ${error.message}`, 'error');
        throw error;
      }
    }
  }

  /**
   * Get all loaded items
   * 
   * @returns {Array} Current items
   */
  getItems() {
    return this.items;
  }

  /**
   * Find item by predicate
   * 
   * @param {Function} predicate - Filter function
   * @returns {Object|undefined} Found item or undefined
   */
  findItem(predicate) {
    return this.items.find(predicate);
  }

  /**
   * Filter items by predicate
   * 
   * @param {Function} predicate - Filter function
   * @returns {Array} Filtered items
   */
  filterItems(predicate) {
    return this.items.filter(predicate);
  }
}

/**
 * Helper function for confirmation + execution pattern
 * 
 * Consolidates 8+ confirmation dialog patterns across managers.
 * 
 * Usage:
 *   await confirmAndExecute(
 *     '确定要删除?',
 *     () => this.crud.delete(id)
 *   );
 */
async function confirmAndExecute(message, asyncFunc) {
  if (await AppUtils.safeConfirm(message)) {
    return await asyncFunc();
  }
}

/**
 * Enhanced API call wrapper
 * 
 * Consolidates 10+ API error handling patterns.
 * 
 * Usage:
 *   const result = await wrapApiCall(
 *     () => window.AppAPI.saveVulnerability(data),
 *     '漏洞保存成功',
 *     '漏洞保存失败'
 *   );
 */
async function wrapApiCall(apiFunc, successMsg = null, errorMsg = null) {
  try {
    const result = await apiFunc();
    const msg = successMsg || result.message || '操作成功';
    AppUtils.showToast(msg, 'success');
    return result;
  } catch (error) {
    const msg = errorMsg || `错误: ${error.message}`;
    AppUtils.showToast(msg, 'error');
    throw error;
  }
}

/**
 * Batch operation helper
 * 
 * Consolidates batch operation patterns.
 * 
 * Usage:
 *   await batchOperation(
 *     selectedIds,
 *     (id) => this.crud.delete(id),
 *     '删除'
 *   );
 */
async function batchOperation(ids, operationFunc, operationName = '操作') {
  if (!ids || ids.length === 0) {
    AppUtils.showToast('请选择项目', 'warning');
    return;
  }

  if (!await AppUtils.safeConfirm(`确定要对选中的 ${ids.length} 项执行${operationName}?`)) {
    return;
  }

  const results = [];
  for (const id of ids) {
    try {
      const result = await operationFunc(id);
      results.push({ id, success: true, result });
    } catch (error) {
      results.push({ id, success: false, error });
    }
  }

  const successCount = results.filter(r => r.success).length;
  AppUtils.showToast(`${operationName}完成: ${successCount}/${ids.length} 成功`, 'info');
  
  return results;
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CRUDManager,
    confirmAndExecute,
    wrapApiCall,
    batchOperation
  };
}

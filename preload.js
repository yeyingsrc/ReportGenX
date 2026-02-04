const { contextBridge, ipcRenderer } = require('electron')
const path = require('path')
const fs = require('fs')

// 加载共享配置
function loadSharedConfig() {
  // 尝试多个可能的路径
  const possiblePaths = [
    path.join(__dirname, 'backend', 'shared-config.json'),
    path.join(process.resourcesPath || '', 'backend', 'shared-config.json')
  ]
  
  for (const configPath of possiblePaths) {
    try {
      if (fs.existsSync(configPath)) {
        return JSON.parse(fs.readFileSync(configPath, 'utf-8'))
      }
    } catch (e) {
      // 继续尝试下一个路径
    }
  }
  return { server: { host: '127.0.0.1', port: 8000 } }
}

const sharedConfig = loadSharedConfig()

contextBridge.exposeInMainWorld('electronAPI', {
  openExternal: (url) => ipcRenderer.invoke('open-external', url)
})

// 暴露服务器配置到渲染进程
contextBridge.exposeInMainWorld('electronConfig', {
  serverHost: sharedConfig.server?.host || '127.0.0.1',
  serverPort: sharedConfig.server?.port || 8000,
  apiBaseUrl: `http://${sharedConfig.server?.host || '127.0.0.1'}:${sharedConfig.server?.port || 8000}`
})
const { contextBridge, ipcRenderer } = require('electron')

function getArgValue(prefix) {
  const arg = process.argv.find((item) => typeof item === 'string' && item.startsWith(prefix))
  if (!arg) {
    return ''
  }
  return arg.slice(prefix.length)
}

function decodeArgValue(rawValue) {
  if (!rawValue) {
    return ''
  }

  try {
    return decodeURIComponent(rawValue)
  } catch (_e) {
    return rawValue
  }
}

function parseBootstrapConfig() {
  const hostRaw = decodeArgValue(getArgValue('--app-server-host='))
  const portRaw = Number(decodeArgValue(getArgValue('--app-server-port=')))
  const version = decodeArgValue(getArgValue('--app-version=')) || '0.0.0'
  const appApiToken = decodeArgValue(getArgValue('--app-api-token='))
  const externalHostsRaw = decodeArgValue(getArgValue('--app-external-hosts='))

  const host = hostRaw && hostRaw.trim() ? hostRaw.trim() : '127.0.0.1'
  const port = Number.isInteger(portRaw) && portRaw >= 1 && portRaw <= 65535 ? portRaw : 8000
  const externalHostAllowlist = externalHostsRaw
    ? externalHostsRaw.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean)
    : ['github.com', 'www.github.com']

  return {
    serverHost: host,
    serverPort: port,
    apiBaseUrl: `http://${host}:${port}`,
    appApiToken,
    appVersion: version,
    externalHostAllowlist
  }
}

const bootstrapConfig = parseBootstrapConfig()

contextBridge.exposeInMainWorld('electronAPI', {
  openExternal: (url) => ipcRenderer.invoke('open-external', url)
})

// 暴露服务器配置到渲染进程
contextBridge.exposeInMainWorld('electronConfig', bootstrapConfig)

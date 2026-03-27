const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron')
const path = require('path')
const http = require('http')
const crypto = require('crypto')
const { spawn, execSync } = require('child_process')
const { loadSharedConfig, encodeBootstrapArgs } = require('./shared-config-utils')

let pythonProcess = null
let mainWindow = null
let isQuitting = false
const APP_API_TOKEN = crypto.randomBytes(24).toString('hex')

const sharedConfig = loadSharedConfig(app, __dirname)
const SERVER_HOST = sharedConfig.server.host
const SERVER_PORT = sharedConfig.server.port
const ALLOWED_EXTERNAL_PROTOCOLS = new Set(sharedConfig.security.external_protocols)
const ALLOWED_EXTERNAL_HOSTS = new Set(sharedConfig.security.external_hosts)

function isExternalUrlAllowed(rawUrl) {
  try {
    const parsed = new URL(rawUrl)
    if (!ALLOWED_EXTERNAL_PROTOCOLS.has(parsed.protocol)) {
      return false
    }

    if (parsed.protocol === 'mailto:') {
      return true
    }

    return ALLOWED_EXTERNAL_HOSTS.has(parsed.hostname.toLowerCase())
  } catch (_e) {
    return false
  }
}

async function openExternalSafely(rawUrl, source) {
  if (!isExternalUrlAllowed(rawUrl)) {
    console.warn(`[Security] Blocked external URL from ${source}: ${rawUrl}`)
    return false
  }

  await shell.openExternal(rawUrl)
  return true
}

// 单实例锁：防止多次启动应用
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  // 如果获取锁失败，说明已有实例在运行，直接退出
  console.log('Another instance is already running. Exiting...')
  app.quit()
} else {
  // 当尝试启动第二个实例时，聚焦到第一个实例的窗口
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore()
      }
      mainWindow.focus()
    }
  })
}

function startPythonBackend() {
  let backendExecutable = 'python'
  let args = ['-m', 'uvicorn', 'api:app', '--host', SERVER_HOST, '--port', String(SERVER_PORT)]
  let cwd = path.join(__dirname, 'backend')

  if (app.isPackaged) {
    // Production Mode - 目录模式：可执行文件在 dist/api/api (或 api.exe)
    const distPath = path.join(process.resourcesPath, 'backend', 'dist', 'api')
    cwd = path.join(process.resourcesPath, 'backend')

    if (process.platform === 'win32') {
      backendExecutable = path.join(distPath, 'api.exe')
    } else {
      backendExecutable = path.join(distPath, 'api')
    }
    args = [] // Executable handles main entry point
  } else {
    // Development Mode
    console.log(`Starting Python backend in dev mode: ${cwd}`)
  }

  pythonProcess = spawn(backendExecutable, args, {
    cwd,
    env: {
      ...process.env,
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1',
      APP_API_TOKEN
    }
  })

  pythonProcess.stdout.on('data', (data) => {
    console.log(`Python stdout: ${data.toString('utf-8')}`)
  })

  pythonProcess.stderr.on('data', (data) => {
    console.error(`Python stderr: ${data.toString('utf-8')}`)
  })

  pythonProcess.on('error', (err) => {
    console.error(`Python process failed to start: ${err.message}`)
  })

  pythonProcess.on('close', (code) => {
    console.log(`Python process exited with code ${code}`)
    if (!isQuitting && code !== 0 && code !== null) {
      dialog.showErrorBox('后端服务异常退出', `Python 后端退出码: ${code}`)
    }
  })
}

function checkBackendHealth() {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: SERVER_HOST,
      port: SERVER_PORT,
      path: '/api/health-auth',
      method: 'GET',
      headers: {
        'X-App-Token': APP_API_TOKEN
      }
    }, (res) => {
      if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
        resolve(true)
        return
      }

      if (res.statusCode === 403) {
        const mismatchError = new Error('Backend token mismatch')
        mismatchError.code = 'TOKEN_MISMATCH'
        reject(mismatchError)
        return
      }

      reject(new Error(`Health status ${res.statusCode}`))
    })

    req.on('error', reject)
    req.setTimeout(1500, () => {
      req.destroy(new Error('Health check timeout'))
    })
    req.end()
  })
}

async function waitForBackendReady(maxAttempts = 40, delayMs = 250) {
  for (let i = 0; i < maxAttempts; i += 1) {
    try {
      await checkBackendHealth()
      return
    } catch (e) {
      if (e && e.code === 'TOKEN_MISMATCH') {
        throw e
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }
  throw new Error(`Backend is not ready at http://${SERVER_HOST}:${SERVER_PORT}`)
}

function createWindow() {
  const bootstrapArgs = encodeBootstrapArgs(sharedConfig, APP_API_TOKEN)

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: bootstrapArgs,
      sandbox: true
    }
  })

  // 处理 window.open 跳转 (例如 target="_blank")
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void openExternalSafely(url, 'window.open')
    return { action: 'deny' }
  })

  mainWindow.loadFile('src/index.html')
}

// IPC 处理
ipcMain.handle('open-external', async (event, url) => {
  const senderUrl = event.senderFrame && event.senderFrame.url
  if (typeof senderUrl !== 'string' || !senderUrl.startsWith('file://')) {
    throw new Error('Blocked by sender origin policy')
  }

  const opened = await openExternalSafely(url, 'ipc')
  if (!opened) {
    throw new Error('Blocked by external URL allowlist')
  }
  return { success: true }
})

app.whenReady().then(async () => {
  try {
    startPythonBackend()
    await waitForBackendReady()
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
      }
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (err && err.code === 'TOKEN_MISMATCH') {
      dialog.showErrorBox('启动失败', '检测到端口上已有其他后端实例（令牌不匹配）。请关闭旧的 ReportGenX 后端进程后重试。')
    } else {
      dialog.showErrorBox('启动失败', `后端服务未就绪：${message}`)
    }
    app.quit()
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('will-quit', () => {
  isQuitting = true
  if (pythonProcess) {
    // Windows: 使用 taskkill 杀死进程树（包括所有子进程）
    // Unix: 尝试杀死进程组
    if (process.platform === 'win32') {
      try {
        execSync(`taskkill /pid ${pythonProcess.pid} /T /F`, { stdio: 'ignore' })
      } catch (_e) {
        // 忽略错误（进程可能已退出）
      }
    } else {
      try {
        process.kill(-pythonProcess.pid, 'SIGKILL')
      } catch (_e) {
        pythonProcess.kill('SIGKILL')
      }
    }
    pythonProcess = null
  }
})

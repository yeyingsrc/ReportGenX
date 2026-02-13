const { app, BrowserWindow, ipcMain, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const { spawn, execSync } = require('child_process')

let pythonProcess = null
let mainWindow = null

// 加载共享配置
function loadSharedConfig() {
  const configPath = app.isPackaged
    ? path.join(process.resourcesPath, 'backend', 'shared-config.json')
    : path.join(__dirname, 'backend', 'shared-config.json')
  
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    }
  } catch (e) {
    console.error('Failed to load shared-config.json:', e)
  }
  return { server: { host: '127.0.0.1', port: 8000 } }
}

const sharedConfig = loadSharedConfig()
const SERVER_HOST = sharedConfig.server?.host || '127.0.0.1'
const SERVER_PORT = sharedConfig.server?.port || 8000

// 单实例锁：防止多次启动应用
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  // 如果获取锁失败，说明已有实例在运行，直接退出
  console.log('Another instance is already running. Exiting...')
  app.quit()
} else {
  // 当尝试启动第二个实例时，聚焦到第一个实例的窗口
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
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
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }
  })

  pythonProcess.stdout.on('data', (data) => {
    console.log(`Python stdout: ${data.toString('utf-8')}`)
  })

  pythonProcess.stderr.on('data', (data) => {
    console.error(`Python stderr: ${data.toString('utf-8')}`)
  })

  pythonProcess.on('close', (code) => {
    console.log(`Python process exited with code ${code}`)
  })
}

function createWindow () {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      // 显式禁用沙箱，因为 preload.js 需要使用 Node.js 模块 (fs, path)
      // 注意：这是为了读取配置文件，contextIsolation 仍然启用以保证安全
      sandbox: false
    }
  })

  // 处理 window.open 跳转 (例如 target="_blank")
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    require('electron').shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.loadFile('src/index.html')
}

// IPC 处理
ipcMain.handle('open-external', async (event, url) => {
  await shell.openExternal(url)
})

app.whenReady().then(() => {
  startPythonBackend()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('will-quit', () => {
  if (pythonProcess) {
    // Windows: 使用 taskkill 杀死进程树（包括所有子进程）
    // Unix: 尝试杀死进程组
    if (process.platform === 'win32') {
      try {
        execSync(`taskkill /pid ${pythonProcess.pid} /T /F`, { stdio: 'ignore' })
      } catch (e) {
        // 忽略错误（进程可能已退出）
      }
    } else {
      try {
        process.kill(-pythonProcess.pid, 'SIGKILL')
      } catch (e) {
        pythonProcess.kill('SIGKILL')
      }
    }
    pythonProcess = null
  }
})
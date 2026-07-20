// electron/main.ts
import { app, BrowserWindow } from 'electron'
import path, { join } from 'node:path'
import { runCli } from '../src/cli'
import { isCliInvocation } from './cli-dispatch'
import { registerWxfileScheme, handleWxfileProtocol } from './protocol'
import { registerIpc } from './ipc'
import { SettingsService } from './services/settings'

// Must be called before app 'ready'. Safe in CLI mode — the registered
// scheme is never exercised without a BrowserWindow.
registerWxfileScheme()

// 打包后 argv: [exe, ...args]；开发时 argv: [electron, '.', ...args]
function userArgs(): string[] {
  const raw = process.argv.slice(app.isPackaged ? 1 : 2)
  return raw.filter(a => a !== '.')
}

async function main() {
  const args = userArgs()

  if (isCliInvocation(args)) {
    // PDF export opens a transient offscreen BrowserWindow. Without this
    // no-op handler, Electron's default "quit when all windows close"
    // fires when that window is destroyed and races the process to exit
    // before the summary/library write finish. We exit explicitly below.
    app.on('window-all-closed', () => {})
    await app.whenReady()
    const code = await runCli(args, { version: app.getVersion(), userDataDir: app.getPath('userData') })
    app.exit(code)
    return
  }

  // GUI 模式
  await app.whenReady()

  const settings = new SettingsService(app.getPath('userData'), join(app.getPath('documents'), 'wx-kit'))
  handleWxfileProtocol(async () => (await settings.get()).libraryRoot)
  registerIpc(settings)

  const createWindow = () => {
    const win = new BrowserWindow({
      // 标题留空:应用内刊头已有品牌区,原生标题栏再写一次「wx-kit」是信息重复。
      // 注意 index.html 的 <title> 也必须为空,否则页面加载后会把它顶回来。
      width: 1200, height: 800, title: '',
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
    })
    const devUrl = process.env.VITE_DEV_SERVER_URL
    if (devUrl) win.loadURL(devUrl)
    else win.loadFile(path.join(__dirname, '../dist/index.html'))
  }
  createWindow()

  // mac 惯例的另一半:关窗后应用驻留程序坞,点图标(reopen → activate)须重建窗口,否则应用假死
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
}

main().catch((err) => {
  process.stderr.write(`[wx-kit] fatal: ${(err as Error).message}\n`)
  process.exit(1)
})

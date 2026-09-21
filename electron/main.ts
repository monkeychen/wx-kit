// electron/main.ts
import { app, BrowserWindow, shell } from 'electron'
import path, { join } from 'node:path'
import { access } from 'node:fs/promises'
import { runCli } from '../src/cli'
import { runStartupMowenDetect } from './services/mowen-detect'
import { isCliInvocation, normalizeUserArgs } from './cli-dispatch'
import { registerWxfileScheme, handleWxfileProtocol } from './protocol'
import { registerIpc } from './ipc'
import { SettingsService } from './services/settings'
import { initDiagLog, diag, flushDiagLog } from '../src/core/diag-log'

// Must be called before app 'ready'. Safe in CLI mode — the registered
// scheme is never exercised without a BrowserWindow.
registerWxfileScheme()

/** M66 启动快照:环境信息一条入日志(PATH/HOME/SHELL 是两起 mocli 事故的直接线索);
 *  weread 凭据只记存在与否,不记内容。 */
async function writeStartupSnapshot(mode: 'gui' | 'cli', version: string, userData: string, argv: string[]): Promise<void> {
  initDiagLog({ dir: join(userData, 'logs') })
  const wereadCreds = await access(join(userData, 'weread-creds.json')).then(() => true, () => false)
  diag()?.info('startup', 'snapshot', {
    mode, appVersion: version,
    electron: process.versions.electron, node: process.versions.node, chrome: process.versions.chrome,
    platform: process.platform, arch: process.arch,
    userData, wereadCreds,
    PATH: process.env.PATH, HOME: process.env.HOME, SHELL: process.env.SHELL,
    ...(mode === 'cli' ? { argv: argv.slice(0, 20) } : {}),
  }, 'startup snapshot')
}

// 打包后 argv: [exe, ...args]；开发时 argv: [electron, '.', ...args]
function userArgs(): string[] {
  const raw = process.argv.slice(app.isPackaged ? 1 : 2)
  return normalizeUserArgs(raw)
}

async function main() {
  // npm run dev（vite-plugin-electron 注入 VITE_DEV_SERVER_URL）下默认开启选题 AI 交互
  // 追踪：完整请求/响应/校验明细打主进程 stderr → 终端。显式设 WXKIT_DEBUG=0 可关。
  // 只在 dev 信号下开：e2e/生产不带 VITE_DEV_SERVER_URL，不会把正文写进日志流。
  if (process.env.VITE_DEV_SERVER_URL && process.env.WXKIT_DEBUG === undefined) process.env.WXKIT_DEBUG = '1'
  const args = userArgs()

  if (isCliInvocation(args)) {
    // mac 程序坞图标:靠 Info.plist 的 LSUIElement=true 压住(见 package.json build.mac.extendInfo),
    // 进程启动即 accessory,不给图标出现的机会。
    // 曾用 app.dock.hide() 修,无效——dock API 要等 app ready 才生效,而 AppKit 在 ready 前
    // 就已把进程注册成 Foreground 并画了图标(v0.8.0 实测:-h 期间状态序列
    // NULL→Foreground→UIElement)。图标是 JS 执行前画的,只能在 plist 层解决。
    // PDF export opens a transient offscreen BrowserWindow. Without this
    // no-op handler, Electron's default "quit when all windows close"
    // fires when that window is destroyed and races the process to exit
    // before the summary/library write finish. We exit explicitly below.
    app.on('window-all-closed', () => {})
    await app.whenReady()
    await writeStartupSnapshot('cli', app.getVersion(), app.getPath('userData'), args)
    const code = await runCli(args, { version: app.getVersion(), userDataDir: app.getPath('userData') })
    await flushDiagLog()   // CLI 进程即将退出:不 flush 会截断尾部日志行
    app.exit(code)
    return
  }

  // GUI 模式
  await app.whenReady()
  void writeStartupSnapshot('gui', app.getVersion(), app.getPath('userData'), args)

  // LSUIElement=true 让进程启动即无程序坞图标(为了 CLI,见上方 CLI 分支注释),
  // GUI 模式要把图标要回来;accessory 应用的窗口不会自动抢焦点,故一并 focus。
  if (app.dock) { app.dock.show(); app.focus({ steal: true }) }

  const settings = new SettingsService(app.getPath('userData'), join(app.getPath('documents'), 'wx-kit'))
  void settings.get().then((s) => diag()?.info('startup', 'ready', { libraryRoot: s.libraryRoot }))
  handleWxfileProtocol(async () => (await settings.get()).libraryRoot)
  registerIpc(settings)
  // M60 R3:启动期检测 mocli,fire-and-forget——装没装、多慢都不阻塞窗口创建
  void runStartupMowenDetect(settings)

  const createWindow = () => {
    const win = new BrowserWindow({
      // 标题留空:应用内刊头已有品牌区,原生标题栏再写一次「wx-kit」是信息重复。
      // 注意 index.html 的 <title> 也必须为空,否则页面加载后会把它顶回来。
      width: 1200, height: 800, title: '',
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
    })
    // 应用内不开新窗口:window.open/_blank 一律转交系统浏览器(仅 http/https;其余来源直接拒绝)。
    // 与 wxfile 协议注入的 <base target="_blank">、iframe allow-popups 配套,让 HTML 视图里的
    // 「原文」等外链能用系统浏览器打开——iframe 内导航会被微信的嵌入限制响应头阻断。
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//.test(url)) void shell.openExternal(url)
      return { action: 'deny' }
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

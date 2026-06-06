// electron/main.ts
import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import { runCli } from '../src/cli'

const CLI_COMMANDS = new Set(['download', 'crawl', 'search', 'login', 'auth-status', 'library'])

function isCliInvocation(argv: string[]): boolean {
  return argv.length > 0 && CLI_COMMANDS.has(argv[0])
}

// 打包后 argv: [exe, ...args]；开发时 argv: [electron, '.', ...args]
function userArgs(): string[] {
  const raw = process.argv.slice(app.isPackaged ? 1 : 2)
  return raw.filter(a => a !== '.')
}

async function main() {
  const args = userArgs()

  if (isCliInvocation(args)) {
    await app.whenReady()
    const code = await runCli(args)
    app.exit(code)
    return
  }

  // GUI 模式
  await app.whenReady()
  const win = new BrowserWindow({
    width: 1200, height: 800, title: 'wx-kit',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  })
  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (devUrl) win.loadURL(devUrl)
  else win.loadFile(path.join(__dirname, '../dist/index.html'))

  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
}

main()

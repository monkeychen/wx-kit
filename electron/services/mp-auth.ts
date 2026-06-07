// electron/services/mp-auth.ts
import { BrowserWindow, app } from 'electron'
import { join } from 'node:path'
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import type { MpSession } from '../../src/core/mp-types'

function sessionPath(): string { return join(app.getPath('userData'), 'mp-session.json') }

export function getSession(): MpSession | null {
  try { return JSON.parse(readFileSync(sessionPath(), 'utf-8')) as MpSession } catch { return null }
}
export function clearSession(): void { try { rmSync(sessionPath()) } catch { /* already gone */ } }

/** 开窗扫码登录 mp 后台，捕获 token + cookies。用户未登录即关窗 → 抛 CANCELLED。 */
export async function login(): Promise<MpSession> {
  const win = new BrowserWindow({
    width: 480, height: 640, title: '扫码登录公众号后台',
    webPreferences: { partition: 'persist:mpweixin' },
  })
  return new Promise<MpSession>((resolve, reject) => {
    let done = false
    const onNav = async () => {
      const url = win.webContents.getURL()
      const m = /[?&]token=(\d+)/.exec(url)
      if (url.includes('/cgi-bin/home') && m) {
        done = true
        const cookies = (await win.webContents.session.cookies.get({ url: 'https://mp.weixin.qq.com' }))
          .map((c) => ({ name: c.name, value: c.value }))
        const session: MpSession = { token: m[1], cookies, timestamp: Date.now() }
        writeFileSync(sessionPath(), JSON.stringify(session))
        win.removeListener('closed', onClosed)
        win.destroy()
        resolve(session)
      }
    }
    const onClosed = () => { if (!done) reject(new Error('CANCELLED')) }
    win.webContents.on('did-navigate', onNav)
    win.webContents.on('did-navigate-in-page', onNav)
    win.on('closed', onClosed)
    win.loadURL('https://mp.weixin.qq.com/')
  })
}

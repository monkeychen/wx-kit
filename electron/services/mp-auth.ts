// electron/services/mp-auth.ts
import { BrowserWindow, app, session } from 'electron'
import { join } from 'node:path'
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import type { MpSession } from '../../src/core/mp-types'

/** 登录窗口用的持久 partition。persist 让 cookie 跨窗口留存——但也因此,
 *  上次登录的 cookie 会让下次开窗时微信自动登录旧号(扫码窗口不显示、用户没机会换号)。
 *  故 login() 开窗前、clearSession() 退出时都要清它的 cookie。 */
const PARTITION = 'persist:mpweixin'

function sessionPath(): string { return join(app.getPath('userData'), 'mp-session.json') }

export function getSession(): MpSession | null {
  try { return JSON.parse(readFileSync(sessionPath(), 'utf-8')) as MpSession } catch { return null }
}

/**
 * 彻底退出登录:清掉登录窗口 partition 的 cookie + 删本地 session 副本。
 * 只删 mp-session.json 不够——partition 的 cookie 还在,下次开窗微信会自动登录旧号。
 */
export async function clearSession(): Promise<void> {
  try { await session.fromPartition(PARTITION).clearStorageData({ storages: ['cookies'] }) } catch { /* partition 尚未创建等,忽略 */ }
  try { rmSync(sessionPath()) } catch { /* already gone */ }
}

/** 开窗扫码登录公众号后台,捕获 token + cookies。用户未登录即关窗 → 抛 CANCELLED。 */
export async function login(): Promise<MpSession> {
  // 开窗前先清 partition cookie:否则上次登录的 cookie 会让微信自动登录旧号,
  // 扫码窗口根本不显示、用户没机会换号(2026-08 修)。
  try { await session.fromPartition(PARTITION).clearStorageData({ storages: ['cookies'] }) } catch { /* ignore */ }
  const win = new BrowserWindow({
    width: 480, height: 640, title: '扫码登录公众号后台',
    webPreferences: { partition: PARTITION },
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
        const mp: MpSession = { token: m[1], cookies, timestamp: Date.now() }
        writeFileSync(sessionPath(), JSON.stringify(mp))
        win.removeListener('closed', onClosed)
        win.destroy()
        resolve(mp)
      }
    }
    const onClosed = () => { if (!done) reject(new Error('CANCELLED')) }
    win.webContents.on('did-navigate', onNav)
    win.webContents.on('did-navigate-in-page', onNav)
    win.on('closed', onClosed)
    win.loadURL('https://mp.weixin.qq.com/')
  })
}

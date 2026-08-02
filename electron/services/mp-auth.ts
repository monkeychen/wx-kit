// electron/services/mp-auth.ts
import { BrowserWindow, app, type Session } from 'electron'
import { join } from 'node:path'
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import type { MpSession } from '../../src/core/mp-types'
import { getMpElectronSession, MP_ORIGIN, MP_PARTITION } from './mp-session'

function sessionPath(): string { return join(app.getPath('userData'), 'mp-session.json') }

export function getSession(): MpSession | null {
  try { return JSON.parse(readFileSync(sessionPath(), 'utf-8')) as MpSession } catch { return null }
}

type AuthPartition = Pick<Session,
  'closeAllConnections' | 'clearStorageData' | 'clearCache' | 'clearAuthCache'>

export class MpAuthClearError extends Error {
  readonly code = 'MP_AUTH_CLEAR_FAILED'
  constructor(public readonly failedSteps: string[]) {
    super(`公众号登录态未清理完整：${failedSteps.join('、')}；请关闭其他 wx-kit 窗口后重试`)
    this.name = 'MpAuthClearError'
  }
}

/**
 * 彻底清除应用当前管理的公众号登录态。
 *
 * 刻意不删除整个 userData：设置、订阅、文库索引、请求审计与频控熔断状态都必须保留。
 * 每一步都独立尝试，避免一个缓存失败后连 session 文件也留着；但只要有一步失败，调用方就
 * 不得向用户谎报“已退出”。
 */
export async function clearMpAuthState(opts: {
  partition?: AuthPartition
  sessionFile?: string
} = {}): Promise<void> {
  const partition = opts.partition ?? getMpElectronSession()
  const file = opts.sessionFile ?? sessionPath()
  const failedSteps: string[] = []
  const attempt = async (step: string, action: () => void | Promise<void>) => {
    try { await action() } catch { failedSteps.push(step) }
  }

  // 先断开已在途的专用 Session 连接，尽量不让旧会话在退出过程中继续传输。
  await attempt('现有连接', () => partition.closeAllConnections())
  await attempt('本地会话文件', () => {
    try { rmSync(file) } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
    }
  })
  // 不传 storages 白名单：清掉 Electron 当前及未来由该 API 管理的全部分区站点存储，
  // 而不是只删几枚 Cookie 后给用户一个“看似退出”的假象。
  await attempt('分区站点存储', () => partition.clearStorageData())
  await attempt('HTTP 缓存', () => partition.clearCache())
  await attempt('认证缓存', () => partition.clearAuthCache())

  if (failedSteps.length) throw new MpAuthClearError(failedSteps)
}

/** 开窗扫码登录 mp 后台，捕获 token + cookies。用户未登录即关窗 → 抛 CANCELLED。 */
export async function login(): Promise<MpSession> {
  const win = new BrowserWindow({
    width: 480, height: 640, title: '扫码登录公众号后台',
    webPreferences: { partition: MP_PARTITION },
  })
  return new Promise<MpSession>((resolve, reject) => {
    let done = false
    const onNav = async () => {
      const url = win.webContents.getURL()
      const m = /[?&]token=(\d+)/.exec(url)
      if (url.includes('/cgi-bin/home') && m) {
        done = true
        const cookies = (await win.webContents.session.cookies.get({ url: MP_ORIGIN }))
          .map((c) => ({ name: c.name, value: c.value }))
        const session: MpSession = { token: m[1], cookies, timestamp: Date.now() }
        writeFileSync(sessionPath(), JSON.stringify(session), { mode: 0o600 })
        win.removeListener('closed', onClosed)
        win.destroy()
        resolve(session)
      }
    }
    const onClosed = () => { if (!done) reject(new Error('CANCELLED')) }
    win.webContents.on('did-navigate', onNav)
    win.webContents.on('did-navigate-in-page', onNav)
    win.on('closed', onClosed)
    win.loadURL(MP_ORIGIN)
  })
}

/** 初次登录与重新登录共用同一条路径，保证旧分区不会让扫码窗口自动回到原账号。 */
export async function startFreshLogin(deps: {
  clear?: () => Promise<void>
  open?: () => Promise<MpSession>
} = {}): Promise<MpSession> {
  await (deps.clear ?? clearMpAuthState)()
  return (deps.open ?? login)()
}

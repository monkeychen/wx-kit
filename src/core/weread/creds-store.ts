// src/core/weread/creds-store.ts
// 微信读书凭据的落盘与续期。凭据文件即登录凭证——一律 0600（沿用 mp-session.json 的纪律）。
import { readFile, writeFile, rename, rm, unlink } from 'node:fs/promises'
import { withPathLock } from '../path-lock'
import type { WereadCredentials } from './types'
import { MpAuthExpired } from '../mp-errors'

export class WereadCredsStore {
  constructor(private readonly path: string) {}

  async read(): Promise<WereadCredentials | null> {
    let raw: string
    try { raw = await readFile(this.path, 'utf-8') } catch { return null }
    try {
      const v = JSON.parse(raw) as WereadCredentials
      if (!v || typeof v.refreshToken !== 'string' || !v.refreshToken || typeof v.vid !== 'string') return null
      // 旧文件可能只有 accessToken 无 refreshToken，视为无效需重扫
      return v
    } catch { throw new Error(`微信读书凭据文件损坏: ${this.path} — 删除后重新扫码登录即可`) }
  }

  private async writeAtomic(creds: WereadCredentials): Promise<void> {
    const temp = `${this.path}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`
    try {
      await writeFile(temp, JSON.stringify(creds, null, 2), { mode: 0o600 })
      await rename(temp, this.path)
    } catch (error) {
      await unlink(temp).catch(() => {})
      throw error
    }
  }

  async write(creds: WereadCredentials): Promise<void> {
    await withPathLock(this.path, () => this.writeAtomic(creds))
  }

  /** 成功请求后把 Chromium jar 快照持久化，供下一独立进程使用。 */
  async updateCookie(cookie: string, now = Date.now()): Promise<boolean> {
    if (!cookie.trim()) return false
    return withPathLock(this.path, async () => {
      const creds = await this.read()
      if (!creds || creds.cookie === cookie) return false
      await this.writeAtomic({ ...creds, cookie, updatedAt: now })
      return true
    })
  }

  async clear(): Promise<void> {
    await rm(this.path, { force: true })
  }
}

/**
 * Web 端续期：POST weread.qq.com/web/login/renewal（需带 Cookie）。
 * 凭据有效时服务端会刷新 wr_skey；失败则抛 MpAuthExpired 引导重扫。
 * 当前 QrFlowHttp 不透出 Set-Cookie，故先做轻量探测：refreshToken 存在即视为可续，
 * 真正有效性由后续业务请求（/api/mp/cover）的 401 决定，避免在续期阶段过度阻塞。
 */
export async function refreshWereadCreds(_http: unknown, creds: WereadCredentials): Promise<WereadCredentials> {
  if (!creds.refreshToken) {
    throw new MpAuthExpired('凭据缺少 refreshToken，无法自动续期，请重新扫码登录')
  }
  // Web 端续期依赖 Cookie jar 的 Set-Cookie 回写，当前抽象层不透出 header，
  // 故不做真实网络续期，直接返回原凭据；业务请求若 401 会触发重扫
  return creds
}

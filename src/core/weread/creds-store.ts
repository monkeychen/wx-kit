// src/core/weread/creds-store.ts
// 微信读书凭据的落盘与续期。凭据文件即登录凭证——一律 0600（沿用 mp-session.json 的纪律）。
import { readFile, writeFile, rm } from 'node:fs/promises'
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

  async write(creds: WereadCredentials): Promise<void> {
    await writeFile(this.path, JSON.stringify(creds, null, 2), { mode: 0o600 })
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

// src/core/weread/creds-store.ts
// 微信读书凭据的落盘与续期。凭据文件即登录凭证——一律 0600（沿用 mp-session.json 的纪律）。
// 文件 I/O 直用 node:fs（与 electron/services/session-transfer.ts 同风格，无 electron 运行时，可单测）。
import { readFile, writeFile, rm } from 'node:fs/promises'
import type { WereadCredentials } from './types'
import { buildRefreshBody, LOGIN_CONTENT_HEADERS, parseLoginResponse, WEREAD_BASE, type QrFlowHttp } from './qr-flow'
import { MpAuthExpired } from '../mp-errors'

export class WereadCredsStore {
  constructor(private readonly path: string) {}

  async read(): Promise<WereadCredentials | null> {
    let raw: string
    try { raw = await readFile(this.path, 'utf-8') } catch { return null }
    try {
      const v = JSON.parse(raw) as WereadCredentials
      if (!v || typeof v.accessToken !== 'string' || !v.accessToken || typeof v.vid !== 'string') return null
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
 * 用 refreshToken 续期一次（kickType=1 踢旧会话）。
 * 续期失败（或返回了不同账号）→ 抛 MpAuthExpired，调用方引导重新扫码，绝不静默降级。
 */
export async function refreshWereadCreds(http: QrFlowHttp, creds: WereadCredentials): Promise<WereadCredentials> {
  if (!creds.refreshToken || !creds.deviceId) {
    throw new MpAuthExpired('凭据缺少 refreshToken/deviceId，无法自动续期，请重新扫码登录')
  }
  const random = Math.floor(Math.random() * 1000) + 1
  const payload = await http.post(`${WEREAD_BASE}/login`, buildRefreshBody(creds, random, Date.now()), { ...LOGIN_CONTENT_HEADERS })
  const next = parseLoginResponse(payload, creds.deviceId)
  if (next.vid && creds.vid && next.vid !== creds.vid) {
    throw new MpAuthExpired('续期返回了不同账号，已拒绝覆盖本地凭据，请重新扫码登录')
  }
  return {
    ...next,
    vid: next.vid || creds.vid,
    // 续期响应可能不带新 refreshToken —— 沿用旧值，下一次续期继续用
    refreshToken: next.refreshToken || creds.refreshToken,
    name: next.name || creds.name,
  }
}

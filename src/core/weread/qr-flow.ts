// src/core/weread/qr-flow.ts
// 微信读书 Web 端扫码登录纯逻辑（weread.qq.com/api/auth/*）。HTTP 全注入，可零网络单测。
// 协议：GET /api/auth/getLoginUid -> uid -> 二维码 https://weread.qq.com/web/confirm?uid=xxx
//       -> 轮询 GET /api/auth/getLoginInfo?uid=xxx&otp= （长轮询 70s，succeed=true 即成功）
// 依据 we-mp-rss driver/weread_qr.py（Web 端）实测：成功后 refreshToken(web@xxxx) 为有效长令牌，
// 短值 accessToken(8 字符) 常被 -2012 拒，业务 Cookie 需用 refreshToken 当 wr_skey。
import { MpApiError } from '../mp-errors'
import type { WereadCredentials } from './types'

export const WEB_WEREAD_BASE = 'https://weread.qq.com'

export interface QrFlowHttp {
  get: (url: string, headers?: Record<string, string>) => Promise<Record<string, unknown>>
  post: (url: string, body: unknown, headers?: Record<string, string>) => Promise<Record<string, unknown>>
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object'
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

export function webConfirmUrl(uid: string): string {
  return `${WEB_WEREAD_BASE}/web/confirm?uid=${encodeURIComponent(uid)}`
}

export function buildWebPollUrl(uid: string): string {
  const u = new URL(`${WEB_WEREAD_BASE}/api/auth/getLoginInfo`)
  u.searchParams.set('uid', uid)
  u.searchParams.set('otp', '')
  return u.toString()
}

export async function getLoginUid(http: QrFlowHttp): Promise<string> {
  const data = await http.get(`${WEB_WEREAD_BASE}/api/auth/getLoginUid`, {
    Accept: 'application/json, text/plain, */*',
  })
  const inner = isObj(data.data) ? (data.data as Record<string, unknown>) : null
  const uid = str(data.uid) || (inner ? str(inner.uid) : '')
  if (!uid) throw new MpApiError(-1, `微信读书 getLoginUid 未返回 uid: ${JSON.stringify(data).slice(0, 200)}`)
  return uid
}

export type WebLoginPoll =
  | { state: 'waiting' }
  | { state: 'scanned' }
  | { state: 'confirmed'; creds: WereadCredentials }
  | { state: 'expired' }
  | { state: 'declined' }
  | { state: 'need_otp' }

export function parseWebLoginPoll(payload: Record<string, unknown>): WebLoginPoll {
  const inner = isObj(payload.data) ? (payload.data as Record<string, unknown>) : {}
  const succeed = !!(payload.succeed || inner.succeed)
  if (succeed) {
    const creds = parseWebLoginSuccess(payload)
    return { state: 'confirmed', creds }
  }
  const logicCode = str(payload.logicCode || inner.logicCode)
  if (logicCode === 'NEED_OTP') return { state: 'need_otp' }
  if (logicCode === 'LOGIN_TIMEOUT') return { state: 'waiting' }
  if (logicCode === '1' || logicCode === 'SCANNED') return { state: 'scanned' }
  return { state: 'waiting' }
}

export function parseWebLoginSuccess(payload: Record<string, unknown>): WereadCredentials {
  const inner = isObj(payload.data) ? (payload.data as Record<string, unknown>) : {}
  const inner2 = isObj(inner.data) ? (inner.data as Record<string, unknown>) : null

  const vid =
    str(payload.webLoginVid) ||
    str(payload.vid) ||
    str(payload.userVid) ||
    str(inner.webLoginVid) ||
    str(inner.vid) ||
    str(inner.userVid) ||
    str(inner.user_vid) ||
    (inner2 ? str(inner2.webLoginVid) || str(inner2.vid) : '') ||
    ''

  const refreshToken =
    str(payload.refreshToken) ||
    str(payload.refresh_token) ||
    str(inner.refreshToken) ||
    str(inner.refresh_token) ||
    (inner2 ? str(inner2.refreshToken) || str(inner2.refresh_token) : '') ||
    ''

  const accessToken =
    str(payload.accessToken) ||
    str(payload.access_token) ||
    str(payload.token) ||
    str(inner.accessToken) ||
    str(inner.access_token) ||
    str(inner.token) ||
    (inner2 ? str(inner2.accessToken) : '') ||
    ''

  if (!vid) throw new MpApiError(-1, `微信读书登录成功但未返回 vid: ${JSON.stringify(payload).slice(0, 300)}`)
  if (!refreshToken && !accessToken) {
    const code = payload.errCode ?? payload.errcode ?? ''
    const msg = str(payload.errMsg ?? payload.errmsg)
    throw new MpApiError(Number(code) || -1, `微信读书登录成功但未返回 refreshToken/accessToken: ${code || ''} ${msg}`.trim())
  }
  const longToken = refreshToken || accessToken
  const userObj = isObj(payload.user) ? (payload.user as Record<string, unknown>) : isObj(inner.user) ? (inner.user as Record<string, unknown>) : {}
  return {
    vid,
    accessToken: accessToken || longToken.slice(0, 8),
    refreshToken: longToken,
    deviceId: '',
    name: str(userObj.name),
    updatedAt: Date.now(),
  }
}

// 兼容旧导出：移动端已废弃，保留空实现供旧导入不炸（新登录不走这些）
export const WEREAD_BASE = WEB_WEREAD_BASE
export const WEREAD_VERSION_HEADERS: Readonly<Record<string, string>> = {}
export const LOGIN_CONTENT_HEADERS: Readonly<Record<string, string>> = { 'Content-Type': 'application/json; charset=UTF-8' }
export function newDeviceId(): string { return '' }
export function newInstallId(): string { return '' }
export function wereadSignature(): string { return '' }
export function buildPollUrl(): string { return '' }
export function parseQrPoll(): { state: string } { return { state: 'waiting' } }
export function buildLoginBody(): Record<string, unknown> { return {} }
export function buildRefreshBody(): Record<string, unknown> { return {} }
export function parseLoginResponse(): WereadCredentials { throw new MpApiError(-1, 'mobile login removed, use Web flow') }
export async function exchangeQrCode(): Promise<WereadCredentials> { throw new MpApiError(-1, 'mobile login removed') }
export async function startQrLogin(): Promise<{ uuid: string; confirmUrl: string }> { throw new MpApiError(-1, 'mobile login removed') }

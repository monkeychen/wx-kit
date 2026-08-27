// src/core/weread/qr-flow.ts
// 微信读书扫码登录（移动端墨水屏画像）的分步纯逻辑。HTTP 全注入，可零网络单测。
// 协议链：wxticket → open.weixin 微信二维码 → 轮询确认 → POST /login 换凭据。
// 依据 2026-08 公开实现（johamwon/wechrss）复现验证。
import { createHash } from 'node:crypto'
import { MpApiError } from '../mp-errors'
import type { WereadCredentials, WereadQrPoll, WereadQrStart } from './types'

export const WEREAD_BASE = 'https://i.weread.qq.com'
const WX_APPID = 'wxab9b71ad2b90ff34'
const WX_SCOPE = 'snsapi_userinfo,snsapi_timeline,snsapi_friend'

/** 墨水屏设备画像的版本头（/wxticket 与 /login 复用）。 */
export const WEREAD_VERSION_HEADERS: Readonly<Record<string, string>> = {
  baseapi: '30',
  appver: '2.1.2.10245900',
  basever: '2.1.2.10245900',
  osver: '11',
  channelId: '900',
  'User-Agent': 'WeRead/2.1.2 WRBrand/Onyx wr_eink Dalvik/2.1.0 (Linux; U; Android 11; BOOX Build/onyx)',
}

/** 只做 GET JSON 与 POST JSON 的哑传输；真实实现按域名路由设备头/鉴权头。 */
export interface QrFlowHttp {
  get: (url: string, headers?: Record<string, string>) => Promise<Record<string, unknown>>
  post: (url: string, body: unknown, headers?: Record<string, string>) => Promise<Record<string, unknown>>
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object'
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

export function newDeviceId(rand: () => number = Math.random): string {
  // 镜像墨水屏画像的稳定形态：固定前缀 + 63 位无符号十进制补齐 19 位
  let n = 0n
  for (let i = 0; i < 63; i++) n = (n << 1n) | (rand() < 0.5 ? 0n : 1n)
  return 'eink334691225' + n.toString().padStart(19, '0')
}

export function newInstallId(rand: () => number = Math.random): string {
  let s = ''
  for (let i = 0; i < 26; i++) s += Math.floor(rand() * 10)
  return 'eink31' + s
}

/** /login 签名：sha256(`${timestampMs}${deviceId}${random}`)。 */
export function wereadSignature(timestampMs: number, deviceId: string, random: number): string {
  return createHash('sha256').update(`${timestampMs}${deviceId}${random}`).digest('hex')
}

/** 第一步：wxticket 拿签名 → qrconnect 拿 uuid。返回二维码内容与轮询键。 */
export async function startQrLogin(http: QrFlowHttp): Promise<WereadQrStart> {
  const ticket = await http.get(`${WEREAD_BASE}/wxticket?nonceStr=weread`, { ...WEREAD_VERSION_HEADERS })
  const sig = str(ticket.signature)
  const ts = ticket.timeStamp
  if (!sig || ts == null) {
    throw new MpApiError(-1, `微信读书 wxticket 响应缺 signature/timeStamp: ${JSON.stringify(ticket).slice(0, 200)}`)
  }
  const qrUrl = new URL('https://open.weixin.qq.com/connect/sdk/qrconnect')
  qrUrl.searchParams.set('appid', WX_APPID)
  qrUrl.searchParams.set('noncestr', 'weread')
  qrUrl.searchParams.set('timestamp', String(ts))
  qrUrl.searchParams.set('scope', WX_SCOPE)
  qrUrl.searchParams.set('signature', sig)
  const qr = await http.get(qrUrl.toString(), { 'User-Agent': WEREAD_VERSION_HEADERS['User-Agent'] })
  const errcode = Number(qr.errcode ?? -1)
  const uuid = str(qr.uuid)
  if (errcode !== 0 || !uuid) throw new MpApiError(errcode || -1, `微信二维码生成失败: ${errcode}`)
  const confirmUrl = `https://open.weixin.qq.com/connect/confirm?uuid=${encodeURIComponent(uuid)}`
  return { uuid, confirmUrl }
}

/** 轮询 URL（last 为上一轮的 wx_sid，服务端据此做长轮询续接）。 */
export function buildPollUrl(uuid: string, last?: string | null): string {
  const u = new URL('https://long.open.weixin.qq.com/connect/l/qrconnect')
  u.searchParams.set('f', 'json')
  u.searchParams.set('uuid', uuid)
  if (last != null && last !== '') u.searchParams.set('last', last)
  return u.toString()
}

/** 把轮询响应翻译成状态机转移（wx_errcode 语义见 WereadQrPoll）。 */
export function parseQrPoll(payload: Record<string, unknown>): WereadQrPoll {
  const code = Number(payload.wx_errcode ?? 0)
  if (code === 405) {
    const wxCode = str(payload.wx_code)
    if (!wxCode) throw new MpApiError(-1, '扫码已确认但微信未返回登录 code')
    return { state: 'confirmed', wxCode }
  }
  if (code === 404) return { state: 'scanned' }
  if (code === 408) return { state: 'waiting' }
  if (code === 402) return { state: 'expired' }
  if (code === 403) return { state: 'declined' }
  throw new MpApiError(code || -1, `未知扫码状态: ${code}`)
}

/** POST /login 的请求体（扫码换凭据）。deviceId/installId 须与设备画像一致。 */
export function buildLoginBody(opts: {
  wxCode: string; deviceId: string; installId: string; random: number; timestampMs: number
}): Record<string, unknown> {
  return {
    appFirstInstall: 1,
    code: opts.wxCode,
    deviceId: opts.deviceId,
    deviceName: 'BOOX',
    installId: opts.installId,
    isAutoLogout: 0,
    isFromQrcode: 1,
    random: opts.random,
    signature: wereadSignature(opts.timestampMs, opts.deviceId, opts.random),
    timestamp: opts.timestampMs,
    trackId: '',
    deviceType: 3,
  }
}

/** POST /login 的请求体（refreshToken 续期；kickType=1 踢掉旧会话）。 */
export function buildRefreshBody(creds: WereadCredentials, random: number, timestampMs: number): Record<string, unknown> {
  return {
    deviceId: creds.deviceId,
    deviceName: 'BOOX',
    inBackground: 0,
    kickType: 1,
    random,
    refCgi: '',
    refreshToken: creds.refreshToken,
    signature: wereadSignature(timestampMs, creds.deviceId, random),
    timestamp: timestampMs,
    trackId: '',
    deviceType: 3,
  }
}

export const LOGIN_CONTENT_HEADERS: Readonly<Record<string, string>> = {
  ...WEREAD_VERSION_HEADERS,
  'Content-Type': 'application/json; charset=UTF-8',
}

/** 校验 /login 响应并落成凭据。accessToken 缺失即失败（errCode/errMsg 一并带出）。 */
export function parseLoginResponse(payload: Record<string, unknown>, deviceId: string): WereadCredentials {
  const accessToken = str(payload.accessToken)
  if (!accessToken) {
    const code = payload.errCode ?? payload.errcode ?? ''
    const msg = str(payload.errMsg ?? payload.errmsg)
    throw new MpApiError(Number(code) || -1, `微信读书登录失败: ${code || '无错误码'} ${msg}`.trim())
  }
  const user = isObj(payload.user) ? payload.user : {}
  return {
    vid: str(payload.vid),
    accessToken,
    refreshToken: str(payload.refreshToken),
    deviceId,
    name: str(user.name),
    updatedAt: Date.now(),
  }
}

/** 完整的扫码换凭据一步（wxticket 与 uuid 已就绪时只做 exchange）。 */
export async function exchangeQrCode(
  http: QrFlowHttp, wxCode: string, ids: { deviceId: string; installId: string }, now: () => number = Date.now,
): Promise<WereadCredentials> {
  const payload = await http.post(
    `${WEREAD_BASE}/login`,
    buildLoginBody({ wxCode, deviceId: ids.deviceId, installId: ids.installId, random: Math.floor(Math.random() * 1000), timestampMs: now() }),
    { ...LOGIN_CONTENT_HEADERS },
  )
  return parseLoginResponse(payload, ids.deviceId)
}

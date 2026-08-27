// electron/services/weread-auth.ts
// 微信读书登录的编排层：扫码全流程、凭据续期、WereadClient 工厂。
// 依赖全部可注入（deps），核心纯逻辑在 src/core/weread/qr-flow.ts，本层只做装配。
import { join } from 'node:path'
import { WereadCredsStore, refreshWereadCreds } from '../../src/core/weread/creds-store'
import {
  buildPollUrl, exchangeQrCode, newDeviceId, newInstallId, parseQrPoll, startQrLogin,
  WEREAD_VERSION_HEADERS, type QrFlowHttp,
} from '../../src/core/weread/qr-flow'
import { WereadClient } from '../../src/core/weread/client'
import type { WereadCredentials, WereadQrPoll } from '../../src/core/weread/types'
import type { ArticleRef } from '../../src/core/mp-types'
import { MpAuthExpired } from '../../src/core/mp-errors'
import { readWereadCredsFile, wereadCredsPath } from './weread-transport'

export interface WereadLoginDeps {
  /** 扫码全流程整体走一次保护闸（内部轮询不受间隔档限制——长轮询是协议本身） */
  runAction: <T>(task: () => Promise<T>) => Promise<T>
  http?: QrFlowHttp
  now?: () => number
  /** 轮询间隔与超时；测试注入缩小 */
  pollIntervalMs?: number
  pollTimeoutMs?: number
}

/** Node fetch 版 QrFlowHttp：扫码链路的请求身份是「设备 App」，与业务请求同构。 */
export function nodeQrHttp(): QrFlowHttp {
  const getJson = async (url: string, headers?: Record<string, string>) => {
    const res = await fetch(url, {
      headers: { ...WEREAD_VERSION_HEADERS, ...headers },
      signal: AbortSignal.timeout(25_000),
    })
    if (!res.ok) throw new Error(`weread qr-flow HTTP ${res.status}: ${url.slice(0, 80)}`)
    return await res.json() as Record<string, unknown>
  }
  return {
    get: getJson,
    post: async (url, body, headers) => {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=UTF-8', ...WEREAD_VERSION_HEADERS, ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(25_000),
      })
      const payload = await res.json().catch(() => { throw new Error(`weread login 响应非 JSON（HTTP ${res.status}）`) })
      return payload as Record<string, unknown>
    },
  }
}

export class WereadLoginCancelled extends Error {
  constructor() { super('用户取消了微信读书扫码登录'); this.name = 'WereadLoginCancelled' }
}

/**
 * 扫码登录全流程。onState 暴露轮询状态（GUI 显示「已扫，请确认」/CLI 打印进度）。
 * 取消靠 cancel() 返回 true 的瞬间中断循环。二维码过期（402）自动换码重试一次链路。
 */
export async function runWereadLogin(
  store: WereadCredsStore,
  deps: WereadLoginDeps,
  hooks: {
    onQr?: (qr: { uuid: string; confirmUrl: string }) => void
    onState?: (s: WereadQrPoll['state']) => void
    cancel?: () => boolean
  } = {},
): Promise<WereadCredentials> {
  const http = deps.http ?? nodeQrHttp()
  const interval = deps.pollIntervalMs ?? 2_000
  const deadline = (deps.now ?? Date.now)() + (deps.pollTimeoutMs ?? 10 * 60_000)

  return deps.runAction(async () => {
    for (;;) {   // 402 过期 → 换码重来（外层循环）
      const qr = await startQrLogin(http)
      hooks.onQr?.(qr)
      let last: string | null = null
      for (;;) { // 单个二维码的生命周期
        if (hooks.cancel?.()) throw new WereadLoginCancelled()
        if ((deps.now ?? Date.now)() > deadline) throw new Error('微信读书扫码超时未确认，请重试')
        let poll: WereadQrPoll
        try {
          const payload = await http.get(buildPollUrl(qr.uuid, last), { 'User-Agent': 'Mozilla/5.0' })
          poll = parseQrPoll(payload)
        } catch (e) {
          if (hooks.cancel?.()) throw new WereadLoginCancelled()
          throw e
        }
        if (poll.state === 'confirmed') {
          const creds = await exchangeQrCode(http, poll.wxCode, { deviceId: newDeviceId(), installId: newInstallId() }, deps.now)
          await store.write(creds)
          return creds
        }
        if (poll.state === 'expired') break        // 换新码（外层重来）
        if (poll.state === 'declined') throw new MpAuthExpired('你在微信中取消了登录，请重新发起')
        last = (poll as { wxSid?: string }).wxSid ?? last
        hooks.onState?.(poll.state)
        await new Promise((r) => setTimeout(r, interval))
      }
    }
  })
}

/** 读凭据并尝试 refreshToken 续期一次（失败不覆盖本地，抛 MpAuthExpired 引导重扫）。 */
export async function ensureFreshWereadCreds(
  store: WereadCredsStore,
  http: QrFlowHttp = nodeQrHttp(),
): Promise<WereadCredentials> {
  const creds = await store.read()
  if (!creds) throw new MpAuthExpired('尚未登录微信读书，请先扫码登录')
  if (!creds.refreshToken) return creds   // 无法续期就按现状用，业务报错时再引导
  try {
    const next = await refreshWereadCreds(http, creds)
    await store.write(next)
    return next
  } catch {
    // 续期失败不等于凭据立即失效——旧 accessToken 可能仍在有效期内，交由业务请求检验
    return creds
  }
}

export function wereadCredsStore(userDataDir: string): WereadCredsStore {
  return new WereadCredsStore(join(userDataDir, 'weread-creds.json'))
}

/** 业务客户端工厂：列表/详情请求逐次过 gateway 的 weread-list 档。 */
export function makeWereadClient(
  gatewayRequest: (path: string, params: Record<string, string | number>) => Promise<unknown>,
): WereadClient {
  return new WereadClient(gatewayRequest)
}

export function wereadListUrl(path: string, params: Record<string, string | number>): string {
  const u = new URL(`https://i.weread.qq.com${path}`)
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v))
  return u.toString()
}

/**
 * 订阅检查/批量下载共用的列表取件装配：读凭据文件判断登录态，
 * 未登录返回 null（调用方走 no-session 路径），已登录返回绑定 weread 客户端的函数。
 */
export async function wereadListFn(
  userDataDir: string,
  requestWeread: (url: string) => Promise<unknown>,
): Promise<((fakeid: string, watermark: number) => Promise<ArticleRef[]>) | null> {
  const creds = await readWereadCredsFile(wereadCredsPath(userDataDir))
  if (!creds) return null
  const client = makeWereadClient((path, params) => requestWeread(wereadListUrl(path, params)))
  return (fakeid, watermark) => client.listChaptersSince(fakeid, watermark)
}

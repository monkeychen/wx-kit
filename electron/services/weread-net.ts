// electron/services/weread-net.ts
// 微信读书网络层：走 Electron 内嵌 Chromium 网络栈（session.fetch）。
// 关键结论（2026-08-27 实测）：微信读书按「登录/请求发起端的网络栈指纹」给会话分级——
// 真 Chrome 的 TLS/H2 发起的登录拿到完整权限会话；Node fetch（undici）即使 UA/Origin 全仿，
// 拿到的也是降级会话：cover/shelf 等放行，web/mp/articles 列表恒 -2041。
// 同一份降级 Cookie 用真 Chromium 栈发请求列表立即回 20 条 —— 故登录与业务必须同栈。
import { session } from 'electron'
import type { QrFlowHttp } from '../../src/core/weread/qr-flow'

export const WEREAD_PARTITION = 'persist:weread'
export const WEREAD_ORIGIN = 'https://weread.qq.com/'

export function getWereadElectronSession() {
  return session.fromPartition(WEREAD_PARTITION)
}

const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

function baseHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    Origin: WEREAD_ORIGIN,
    Referer: WEREAD_ORIGIN,
    ...extra,
  }
}

/** 读取 Chromium 分区 cookie jar，拼成请求可用的 Cookie 头（凭据落盘/导出也用它）。 */
export async function wereadCookieHeader(): Promise<string> {
  const jar = await getWereadElectronSession().cookies.get({ url: WEREAD_ORIGIN })
  return jar.map((c) => `${c.name}=${c.value}`).join('; ')
}

/**
 * 登录链路专用 QrFlowHttp：全部经 session.fetch（Chromium 栈），Cookie 由分区 jar 自动携带与回写。
 * 二维码确认页在本会话里没有真实页面加载也无妨——getLoginInfo 成功时服务端经 Set-Cookie
 * 把 wr_skey/wr_rt 直接写进 jar，登录成功后用 wereadCookieHeader() 导出全量即可。
 */
export function buildWereadQrFlowHttp(timeoutMs = 25_000): QrFlowHttp {
  const ses = getWereadElectronSession()
  const get = async (url: string, headers?: Record<string, string>) => {
    const res = await ses.fetch(url, {
      method: 'GET',
      credentials: 'include',
      headers: baseHeaders(headers),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) throw new Error(`weread qr-flow HTTP ${res.status}: ${url.slice(0, 80)}`)
    return await res.json() as Record<string, unknown>
  }
  return {
    get,
    post: async (url, body, headers) => {
      const res = await ses.fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: baseHeaders({ 'Content-Type': 'application/json; charset=UTF-8', ...headers }),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      })
      const payload = await res.json().catch(() => { throw new Error(`weread login 响应非 JSON（HTTP ${res.status}）`) })
      return payload as Record<string, unknown>
    },
    getCookieHeader: () => undefined, // 登录完成后由 wereadCookieHeader() 异步读取
    getCookie: () => undefined,
  }
}

/** 业务传输用：Chromium 栈的 fetch 注入件（签名对齐全局 fetch，便于替换 WereadNodeTransport）。 */
export type SessionFetch = (url: string, init?: RequestInit) => Promise<Response>

export function wereadSessionFetch(timeoutMs = 30_000): SessionFetch {
  const ses = getWereadElectronSession()
  return (url, init) => ses.fetch(url, {
    ...init,
    credentials: 'include',
    headers: { 'User-Agent': BROWSER_UA, ...(init?.headers as Record<string, string> | undefined) },
    signal: init?.signal ?? AbortSignal.timeout(timeoutMs),
  }) as unknown as Promise<Response>
}

/** 非 Electron 环境（纯 Node 单测/脚本）的兜底判定。 */
export function chromiumStackAvailable(): boolean {
  try { return !!getWereadElectronSession() } catch { return false }
}

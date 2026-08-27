// electron/services/weread-transport.ts
// 微信读书域名的传输实现：Node fetch + 墨水屏设备版本头 + accessToken/vid 鉴权头。
// 不走 Chromium session——微信读书移动端接口的身份是「设备 App」而非浏览器 Cookie，
// Chromium 指纹（UA/Cookie/sec-ch-*）反而与声称的客户端画像自相矛盾。
// 凭据每次请求时读盘（weread-creds.json 很小；跨进程写换新后立即生效，不做内存缓存）。
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { MpJson } from '../../src/core/mp-types'
import type { MpRequestTransport } from './mp-request-gateway'
import { WEREAD_VERSION_HEADERS } from '../../src/core/weread/qr-flow'
import type { WereadCredentials } from '../../src/core/weread/types'

export const WEREAD_HOST_SUFFIXES = ['weread.qq.com'] as const

export function isWereadUrl(raw: string): boolean {
  try {
    const host = new URL(raw).hostname.toLowerCase()
    return WEREAD_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))
  } catch { return false }
}

export function wereadCredsPath(userDataDir: string): string {
  return join(userDataDir, 'weread-creds.json')
}

export async function readWereadCredsFile(path: string): Promise<WereadCredentials | null> {
  let raw: string
  try { raw = await readFile(path, 'utf-8') } catch { return null }
  try {
    const v = JSON.parse(raw) as WereadCredentials
    return v && typeof v.accessToken === 'string' && v.accessToken ? v : null
  } catch { return null }
}

export class WereadNodeTransport {
  constructor(private readonly credsPath: string) {}

  private async headers(): Promise<Record<string, string>> {
    const creds = await readWereadCredsFile(this.credsPath)
    const h: Record<string, string> = {
      ...WEREAD_VERSION_HEADERS,
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    }
    // 凭据缺失也放行——扫码流程（wxticket/qrconnect/login）本就不需要登录态，
    // 业务请求缺凭据时服务端会回 -2012，由 core 层翻译引导重扫。
    if (creds) { h.accessToken = creds.accessToken; h.vid = creds.vid }
    return h
  }

  async json(url: string, timeoutMs: number, signal?: AbortSignal): Promise<MpJson> {
    const timeout = AbortSignal.timeout(timeoutMs)
    const sig = signal ? AbortSignal.any([signal, timeout]) : timeout
    const res = await fetch(url, { headers: await this.headers(), signal: sig })
    if (res.status === 401 || res.status === 403) {
      throw Object.assign(new Error(`微信读书 HTTP ${res.status}（登录态可能失效）`), { status: res.status })
    }
    if (!res.ok) throw Object.assign(new Error(`微信读书请求 HTTP ${res.status}: ${url}`), { status: res.status })
    return await res.json() as MpJson
  }
}

/**
 * 按域名路由的复合 transport：weread.qq.com* → Node 设备传输；其余（mp.weixin 文章页/资源）
 * → Chromium session。gateway 零改动即同时服务两条链路。
 */
export class RoutingTransport implements MpRequestTransport {
  private readonly weread: WereadNodeTransport

  constructor(credsPath: string, private readonly fallback: MpRequestTransport) {
    this.weread = new WereadNodeTransport(credsPath)
  }

  async json(url: string, timeoutMs: number, signal?: AbortSignal): Promise<MpJson> {
    return isWereadUrl(url)
      ? this.weread.json(url, timeoutMs, signal)
      : this.fallback.json(url, timeoutMs, signal)
  }

  async text(url: string, timeoutMs: number, signal?: AbortSignal): Promise<string> {
    return this.fallback.text(url, timeoutMs, signal)
  }

  async binary(url: string, timeoutMs: number, signal?: AbortSignal): Promise<{ data: Buffer; contentType: string }> {
    return this.fallback.binary(url, timeoutMs, signal)
  }
}

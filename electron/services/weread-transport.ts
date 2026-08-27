// electron/services/weread-transport.ts
// 微信读书域名的传输实现：路由分发至 Node fetch，按移动端/Web端组装不同的设备与凭据请求头。
// 凭据每次请求时读盘（weread-creds.json 很小；跨进程写换新后立即生效，不做内存缓存）。
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { MpJson } from '../../src/core/mp-types'
import type { MpRequestTransport } from './mp-request-gateway'
import type { WereadCredentials } from '../../src/core/weread/types'

export const WEREAD_HOST_SUFFIXES = ['weread.qq.com'] as const

export function isWereadUrl(raw: string): boolean {
  try {
    const host = new URL(raw).hostname.toLowerCase()
    if (WEREAD_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))) return true
  } catch { return false }
  // e2e：WXKIT_WEREAD_BASE 把 weread 接口指到本地 mock 时，这些请求也要走 Node 设备传输。
  // Chromium 传输会给 json 注入 mp.weixin 的 Referer，而 Chromium 对 https→http 的跨源
  // Referer 直接取消请求，mock 收不到；Node fetch 无 Referer、无此限制。
  const base = process.env.WXKIT_WEREAD_BASE
  if (!base) return false
  try { return raw.startsWith(new URL(base).origin) } catch { return false }
}

export function wereadCredsPath(userDataDir: string): string {
  return join(userDataDir, 'weread-creds.json')
}

export async function readWereadCredsFile(path: string): Promise<WereadCredentials | null> {
  let raw: string
  try { raw = await readFile(path, 'utf-8') } catch { return null }
  try {
    const v = JSON.parse(raw) as WereadCredentials
    const hasLong = typeof v?.refreshToken === 'string' && !!v.refreshToken
    const hasShort = typeof v?.accessToken === 'string' && !!v.accessToken
    return v && typeof v.vid === 'string' && v.vid && (hasLong || hasShort) ? v : null
  } catch { return null }
}

export class WereadNodeTransport {
  constructor(private readonly credsPath: string) {}

  private async headers(_url: string): Promise<Record<string, string>> {
    const creds = await readWereadCredsFile(this.credsPath)
    const h: Record<string, string> = {
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    }
    if (creds) {
      const shortSkey = creds.accessToken?.trim() || ''
      const longRt = creds.refreshToken?.trim() || ''
      if (shortSkey) {
        h.Cookie = `wr_vid=${creds.vid}; wr_skey=${shortSkey};`
        if (longRt) h.Cookie += ` wr_rt=${encodeURIComponent(longRt)};`
      } else if (longRt) {
        h.Cookie = `wr_vid=${creds.vid}; wr_skey=${longRt};`
      }
    }
    return h
  }

  async json(url: string, timeoutMs: number, signal?: AbortSignal): Promise<MpJson> {
    const timeout = AbortSignal.timeout(timeoutMs)
    const sig = signal ? AbortSignal.any([signal, timeout]) : timeout
    const res = await fetch(url, { headers: await this.headers(url), signal: sig })
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

  constructor(
    credsPath: string,
    private readonly fallback: MpRequestTransport,
  ) {
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

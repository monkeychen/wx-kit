import type { Session } from 'electron'
import type { MpJson } from '../../src/core/mp-types'
import type { MpRequestTransport } from './mp-request-gateway'
import { assertWechatNetworkAllowed, isWechatNetworkUrl } from './wechat-network-freeze'

export class MpHttpError extends Error {
  constructor(public readonly status: number, url: string) {
    super(`微信请求 HTTP ${status}: ${safeUrl(url)}`)
    this.name = 'MpHttpError'
  }
}

type SessionFetch = Pick<Session, 'fetch'>

/**
 * 用 Electron Chromium 的网络栈和 Cookie Jar 发请求。
 * 刻意不写 User-Agent/Cookie/sec-ch-*：这些协议身份由同一 Session 自然生成，
 * 不再出现“Windows + Electron 42 却声称 macOS Chrome 124”的自相矛盾。
 */
export class ChromiumMpTransport implements MpRequestTransport {
  constructor(
    private readonly ses: SessionFetch,
    private readonly beforeRequest: () => Promise<void> = async () => {},
  ) {}

  async json(url: string, timeoutMs: number, signal?: AbortSignal): Promise<MpJson> {
    const response = await this.fetch(url, timeoutMs, signal, {
      Accept: 'application/json, text/plain, */*',
      Referer: 'https://mp.weixin.qq.com/',
    })
    return await response.json() as MpJson
  }

  async text(url: string, timeoutMs: number, signal?: AbortSignal): Promise<string> {
    const response = await this.fetch(url, timeoutMs, signal, {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9',
    })
    return response.text()
  }

  async binary(url: string, timeoutMs: number, signal?: AbortSignal): Promise<{ data: Buffer; contentType: string }> {
    const response = await this.fetch(url, timeoutMs, signal, {
      Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      ...(isWechatNetworkUrl(url) ? { Referer: 'https://mp.weixin.qq.com/' } : {}),
    })
    return {
      data: Buffer.from(await response.arrayBuffer()),
      contentType: response.headers.get('content-type') ?? '',
    }
  }

  private async fetch(
    url: string, timeoutMs: number, externalSignal: AbortSignal | undefined, headers: Record<string, string>,
  ): Promise<Response> {
    assertWechatNetworkAllowed(url)
    await this.beforeRequest()
    const timeout = AbortSignal.timeout(timeoutMs)
    const signal = externalSignal ? AbortSignal.any([externalSignal, timeout]) : timeout
    const response = await this.ses.fetch(url, {
      method: 'GET', credentials: 'include', redirect: 'follow', headers, signal,
    })
    if (!response.ok) throw new MpHttpError(response.status, url)
    return response
  }
}

function safeUrl(raw: string): string {
  try { const u = new URL(raw); return `${u.origin}${u.pathname}` }
  catch { return 'invalid-url' }
}

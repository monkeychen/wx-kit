import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChromiumMpTransport, MpHttpError } from '../../electron/services/mp-chromium-transport'
import { WechatNetworkBlockedError } from '../../electron/services/wechat-network-freeze'

const sessionWith = (response: Response) => ({
  fetch: vi.fn(async (_url: string, _init?: RequestInit) => response),
})

afterEach(() => { delete process.env.WX_KIT_BLOCK_WECHAT_NETWORK })

describe('ChromiumMpTransport', () => {
  it('uses Session.fetch without hand-written User-Agent or Cookie', async () => {
    const ses = sessionWith(new Response(JSON.stringify({ base_resp: { ret: 0 } }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }))
    const t = new ChromiumMpTransport(ses as never)
    await t.json('https://mp.weixin.qq.com/cgi-bin/searchbiz?q=x', 20_000)

    const [url, init] = ses.fetch.mock.calls[0]
    expect(url).toContain('searchbiz?q=x')
    const headers = new Headers(init?.headers)
    expect(headers.has('User-Agent')).toBe(false)
    expect(headers.has('Cookie')).toBe(false)
    expect(init?.credentials).toBe('include')
  })

  it('returns binary bytes and content type', async () => {
    const ses = sessionWith(new Response(Uint8Array.from([1, 2, 3]), {
      status: 200, headers: { 'content-type': 'image/png' },
    }))
    const out = await new ChromiumMpTransport(ses as never).binary('https://mmbiz.qpic.cn/a.png', 30_000)
    expect([...out.data]).toEqual([1, 2, 3])
    expect(out.contentType).toBe('image/png')
  })

  it('does not attach a WeChat referrer to local or third-party assets', async () => {
    const ses = sessionWith(new Response(Uint8Array.from([1]), { status: 200 }))
    await new ChromiumMpTransport(ses as never).binary('http://127.0.0.1:1234/pic.png', 30_000)
    const headers = new Headers(ses.fetch.mock.calls[0][1]?.headers)
    expect(headers.has('Referer')).toBe(false)
  })

  it('surfaces HTTP status for the gateway circuit breaker', async () => {
    const ses = sessionWith(new Response('slow down', { status: 429 }))
    await expect(new ChromiumMpTransport(ses as never).text('https://mp.weixin.qq.com/s/X', 30_000))
      .rejects.toBeInstanceOf(MpHttpError)
  })

  it('network freeze blocks WeChat before Session.fetch', async () => {
    process.env.WX_KIT_BLOCK_WECHAT_NETWORK = '1'
    const ses = sessionWith(new Response('should not happen'))
    await expect(new ChromiumMpTransport(ses as never).text('https://mp.weixin.qq.com/s/X', 30_000))
      .rejects.toBeInstanceOf(WechatNetworkBlockedError)
    expect(ses.fetch).not.toHaveBeenCalled()
  })

  it('network freeze still allows local fixture traffic', async () => {
    process.env.WX_KIT_BLOCK_WECHAT_NETWORK = '1'
    const ses = sessionWith(new Response('fixture'))
    expect(await new ChromiumMpTransport(ses as never).text('http://127.0.0.1:1234/article/a', 30_000)).toBe('fixture')
    expect(ses.fetch).toHaveBeenCalledTimes(1)
  })
})

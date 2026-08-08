import { describe, expect, it, vi } from 'vitest'
import { ChromiumMpTransport, MpHttpError } from '../../electron/services/mp-chromium-transport'

const sessionWith = (response: Response) => ({
  fetch: vi.fn(async (_url: string, _init?: RequestInit) => response),
})

describe('ChromiumMpTransport', () => {
  it('uses Session.fetch without hand-written User-Agent or Cookie', async () => {
    const ses = sessionWith(new Response('<html>ok</html>', { status: 200 }))
    const t = new ChromiumMpTransport(ses as never)
    await t.text('https://mp.weixin.qq.com/s/X', 20_000)

    const [url, init] = ses.fetch.mock.calls[0]
    expect(url).toContain('mp.weixin.qq.com/s/X')
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
})

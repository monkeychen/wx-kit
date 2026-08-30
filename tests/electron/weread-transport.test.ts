// tests/electron/weread-transport.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  isWereadUrl, wereadCredsPath, readWereadCredsFile, WereadNodeTransport, RoutingTransport,
} from '../../electron/services/weread-transport'

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'wxkit-wt-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

describe('isWereadUrl', () => {
  it('weread.qq.com 及其子域', () => {
    expect(isWereadUrl('https://i.weread.qq.com/mp/chapters?bookId=x')).toBe(true)
    expect(isWereadUrl('https://weread.qq.com/web/shelf/sync')).toBe(true)
  })
  it('mp.weixin / open.weixin 不算 weread 域', () => {
    expect(isWereadUrl('https://mp.weixin.qq.com/s/abc')).toBe(false)
    expect(isWereadUrl('https://open.weixin.qq.com/connect/sdk/qrconnect')).toBe(false)
  })
  it('坏 URL → false', () => {
    expect(isWereadUrl('not a url')).toBe(false)
  })
  it('WXKIT_WEREAD_BASE 覆盖时，本地 mock 也算 weread 路由（走 Node 传输）', () => {
    const prev = process.env.WXKIT_WEREAD_BASE
    try {
      process.env.WXKIT_WEREAD_BASE = 'http://127.0.0.1:9999'
      expect(isWereadUrl('http://127.0.0.1:9999/api/mp/cover?bookId=x')).toBe(true)
      expect(isWereadUrl('https://weread.qq.com/api/mp/cover?bookId=x')).toBe(true)
      expect(isWereadUrl('https://mp.weixin.qq.com/s/abc')).toBe(false)
    } finally {
      if (prev === undefined) delete process.env.WXKIT_WEREAD_BASE
      else process.env.WXKIT_WEREAD_BASE = prev
    }
  })
})

describe('readWereadCredsFile', () => {
  it('合法凭据读回；accessToken 缺失视为无凭据', async () => {
    const p = join(dir, 'c.json')
    await writeFile(p, JSON.stringify({ vid: '1', accessToken: 'AT', refreshToken: 'R', deviceId: 'd', name: '', updatedAt: 0 }), 'utf-8')
    expect((await readWereadCredsFile(p))?.accessToken).toBe('AT')
    await writeFile(p, JSON.stringify({ vid: '1' }), 'utf-8')
    expect(await readWereadCredsFile(p)).toBeNull()
  })
  it('文件不存在 → null', async () => {
    expect(await readWereadCredsFile(join(dir, 'missing.json'))).toBeNull()
  })
})

describe('WereadNodeTransport.json', () => {
  it('带 Cookie 凭据头（wr_skey 短值 + wr_rt 长值）', async () => {
    const p = join(dir, 'creds.json')
    await writeFile(p, JSON.stringify({ vid: '77', accessToken: 'AT', refreshToken: 'R', deviceId: 'd', name: '', updatedAt: 0 }), 'utf-8')
    const origFetch = globalThis.fetch
    let seen: { url: string; headers: Record<string, string> } | null = null
    const stub = (async (url: string | URL, init?: RequestInit) => {
      seen = { url: String(url), headers: init!.headers as Record<string, string> }
      return new Response(JSON.stringify({ errCode: 0, data: [] }), { status: 200 })
    }) as typeof fetch
    const t = new WereadNodeTransport(p, stub)
    try {
      const json = await t.json('https://weread.qq.com/api/mp/cover?bookId=x', 5000)
      expect(json.errCode).toBe(0)
      expect(seen!.headers.Cookie).toContain('wr_vid=77')
      expect(seen!.headers.Cookie).toContain('wr_skey=AT')
      expect(seen!.headers.Cookie).toContain('wr_rt=')
    } finally { globalThis.fetch = origFetch }
  })
  it('无凭据也放行（扫码链路不需要登录态）', async () => {
    const origFetch = globalThis.fetch
    let headers: Record<string, string> | null = null
    const stub = (async (_u: string | URL, init?: RequestInit) => {
      headers = init!.headers as Record<string, string>
      return new Response('{}', { status: 200 })
    }) as typeof fetch
    const t = new WereadNodeTransport(join(dir, 'none.json'), stub)
    try {
      await t.json('https://i.weread.qq.com/wxticket?nonceStr=weread', 5000)
      expect(headers!.accessToken).toBeUndefined()
    } finally { globalThis.fetch = origFetch }
  })
  it('HTTP 401/403 → 带 status 的错误（登录态失效语义）', async () => {
    const origFetch = globalThis.fetch
    const stub = (async () => new Response('', { status: 401 })) as typeof fetch
    const t = new WereadNodeTransport(join(dir, 'none.json'), stub)
    try {
      await expect(t.json('https://i.weread.qq.com/mp/chapters', 5000)).rejects.toMatchObject({ status: 401 })
    } finally { globalThis.fetch = origFetch }
  })
  it('仅成功响应后同步 Chromium Cookie 快照，401 不覆盖凭据', async () => {
    const p = join(dir, 'creds.json')
    await writeFile(p, JSON.stringify({ vid: '77', accessToken: 'AT', refreshToken: 'RT', name: '', updatedAt: 0, cookie: 'old=1' }), 'utf-8')
    const sync = vi.fn(async () => {})
    const ok = new WereadNodeTransport(p, (async () => new Response('{"errCode":0}', { status: 200 })) as typeof fetch, sync)
    await ok.json('https://weread.qq.com/api/mp/cover?bookId=x', 5000)
    expect(sync).toHaveBeenCalledTimes(1)
    const denied = new WereadNodeTransport(p, (async () => new Response('', { status: 401 })) as typeof fetch, sync)
    await expect(denied.json('https://weread.qq.com/api/mp/cover?bookId=x', 5000)).rejects.toMatchObject({ status: 401 })
    expect(sync).toHaveBeenCalledTimes(1)
  })
  it('Cookie 快照落盘失败不把已经成功的业务请求改判失败', async () => {
    const sync = vi.fn(async () => { throw new Error('disk full') })
    const t = new WereadNodeTransport(join(dir, 'none.json'), (async () => new Response('{"errCode":0}', { status: 200 })) as typeof fetch, sync)
    await expect(t.json('https://weread.qq.com/api/mp/cover?bookId=x', 5000)).resolves.toMatchObject({ errCode: 0 })
  })
})

describe('RoutingTransport', () => {
  const mkFallback = () => ({
    json: async (u: string) => ({ via: 'chromium', u } as unknown as import('../../src/core/mp-types').MpJson),
    text: async (u: string) => `chromium-text:${u}`,
    binary: async () => { throw new Error('not used') },
  })

  it('weread 域名的 json 走 Node 设备传输（无凭据时也能到达 fetch）', async () => {
    let called = false
    const stub = (async () => { called = true; return new Response('{"errCode":0}', { status: 200 }) }) as unknown as typeof fetch
    const t = new RoutingTransport(wereadCredsPath(dir), mkFallback(), new WereadNodeTransport(wereadCredsPath(dir), stub))
    await t.json('https://i.weread.qq.com/mp/chapters?bookId=x', 5000)
    expect(called).toBe(true)
  })
  it('mp.weixin 的 json/text 走 Chromium fallback', async () => {
    const t = new RoutingTransport(wereadCredsPath(dir), mkFallback())
    const json = await t.json('https://mp.weixin.qq.com/cgi-bin/home?t=home', 5000)
    expect(json).toMatchObject({ via: 'chromium' })
    expect(await t.text('https://mp.weixin.qq.com/s/abc', 5000)).toContain('chromium-text')
  })
})

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
  it('带设备版本头与凭据头（有凭据时）', async () => {
    const p = join(dir, 'creds.json')
    await writeFile(p, JSON.stringify({ vid: '77', accessToken: 'AT', refreshToken: 'R', deviceId: 'd', name: '', updatedAt: 0 }), 'utf-8')
    const t = new WereadNodeTransport(p)
    const origFetch = globalThis.fetch
    let seen: { url: string; headers: Record<string, string> } | null = null
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      seen = { url: String(url), headers: init!.headers as Record<string, string> }
      return new Response(JSON.stringify({ errCode: 0, data: [] }), { status: 200 })
    }) as typeof fetch
    try {
      const json = await t.json('https://i.weread.qq.com/book/info?bookId=x', 5000)
      expect(json.errCode).toBe(0)
      expect(seen!.headers.accessToken).toBe('AT')
      expect(seen!.headers.vid).toBe('77')
      expect(seen!.headers.appver).toBe('2.1.2.10245900')
    } finally { globalThis.fetch = origFetch }
  })
  it('无凭据也放行（扫码链路不需要登录态）', async () => {
    const t = new WereadNodeTransport(join(dir, 'none.json'))
    const origFetch = globalThis.fetch
    let headers: Record<string, string> | null = null
    globalThis.fetch = (async (_u: string | URL, init?: RequestInit) => {
      headers = init!.headers as Record<string, string>
      return new Response('{}', { status: 200 })
    }) as typeof fetch
    try {
      await t.json('https://i.weread.qq.com/wxticket?nonceStr=weread', 5000)
      expect(headers!.accessToken).toBeUndefined()
    } finally { globalThis.fetch = origFetch }
  })
  it('HTTP 401/403 → 带 status 的错误（登录态失效语义）', async () => {
    const t = new WereadNodeTransport(join(dir, 'none.json'))
    const origFetch = globalThis.fetch
    globalThis.fetch = (async () => new Response('', { status: 401 })) as typeof fetch
    try {
      await expect(t.json('https://i.weread.qq.com/mp/chapters', 5000)).rejects.toMatchObject({ status: 401 })
    } finally { globalThis.fetch = origFetch }
  })
})

describe('RoutingTransport', () => {
  const mkFallback = () => ({
    json: async (u: string) => ({ via: 'chromium', u } as unknown as import('../../src/core/mp-types').MpJson),
    text: async (u: string) => `chromium-text:${u}`,
    binary: async () => { throw new Error('not used') },
  })

  it('weread 域名的 json 走 Node 设备传输（无凭据时也能到达 fetch）', async () => {
    const t = new RoutingTransport(wereadCredsPath(dir), mkFallback())
    const origFetch = globalThis.fetch
    let called = false
    globalThis.fetch = (async () => { called = true; return new Response('{"errCode":0}', { status: 200 }) }) as typeof fetch
    try {
      await t.json('https://i.weread.qq.com/mp/chapters?bookId=x', 5000)
      expect(called).toBe(true)
    } finally { globalThis.fetch = origFetch }
  })
  it('mp.weixin 的 json/text 走 Chromium fallback', async () => {
    const t = new RoutingTransport(wereadCredsPath(dir), mkFallback())
    const json = await t.json('https://mp.weixin.qq.com/cgi-bin/home?t=home', 5000)
    expect(json).toMatchObject({ via: 'chromium' })
    expect(await t.text('https://mp.weixin.qq.com/s/abc', 5000)).toContain('chromium-text')
  })
})

import { describe, expect, it, vi } from 'vitest'
import { activeRequestState, type MpRequestState } from '../../src/core/mp-request-governor'
import { MpRateLimited } from '../../src/core/mp-errors'
import {
  MpRequestGateway,
  MpRequestProtectionError,
  type MpRequestTransport,
} from '../../electron/services/mp-request-gateway'
import type { MpRequestStateStore, MpStateUpdate } from '../../electron/services/mp-request-state'

class MemoryStore implements MpRequestStateStore {
  constructor(public state: MpRequestState) {}
  async read() { return this.state }
  async update<T>(fn: (state: MpRequestState) => MpStateUpdate<T> | Promise<MpStateUpdate<T>>): Promise<T> {
    const result = await fn(this.state)
    this.state = result.state
    return result.value
  }
}

const transport = (json: unknown = { base_resp: { ret: 0 } }) => ({
  json: vi.fn(async () => json as never),
  text: vi.fn(async () => '<html>ok</html>'),
  binary: vi.fn(async () => ({ data: Buffer.from('x'), contentType: 'image/png' })),
}) satisfies MpRequestTransport

describe('MpRequestGateway', () => {
  it('paused state performs zero transport calls', async () => {
    const store = new MemoryStore({
      ...activeRequestState(0), mode: 'user-paused', pausedReason: '冻结期',
    })
    const t = transport()
    const gateway = new MpRequestGateway({ store, transport: t })
    await expect(gateway.requestJson('account-search', 'https://mp.weixin.qq.com/cgi-bin/searchbiz', {}))
      .rejects.toMatchObject({ code: 'MP_GOVERNOR_PAUSED' })
    expect(t.json).not.toHaveBeenCalled()
  })

  it('all request kinds share one reservation timeline', async () => {
    let now = 1_000
    const waits: number[] = []
    const t = transport()
    const gateway = new MpRequestGateway({
      store: new MemoryStore(activeRequestState(now)), transport: t,
      now: () => now, rng: () => 0,
      wait: async (ms) => { waits.push(ms); now += ms },
    })
    await gateway.requestJson('account-search', 'https://mp.weixin.qq.com/cgi-bin/searchbiz', {})
    await gateway.fetchText('article-page', 'https://mp.weixin.qq.com/s/X', 60_000)
    expect(t.json).toHaveBeenCalledTimes(1)
    expect(t.text).toHaveBeenCalledTimes(1)
    expect(waits.reduce((a, b) => a + b, 0)).toBe(8_000)
  })

  it('ret 200013 trips a persistent global circuit and never retries', async () => {
    const store = new MemoryStore(activeRequestState(0))
    const t = transport({ base_resp: { ret: 200013 } })
    const gateway = new MpRequestGateway({ store, transport: t, now: () => 10 })
    await expect(gateway.requestJson('article-list', 'https://mp.weixin.qq.com/cgi-bin/appmsgpublish', {}))
      .rejects.toBeInstanceOf(MpRateLimited)
    expect(t.json).toHaveBeenCalledTimes(1)
    expect(store.state.mode).toBe('rate-limited')
    await expect(gateway.fetchText('article-page', 'https://mp.weixin.qq.com/s/X', 60_000))
      .rejects.toMatchObject({ code: 'MP_RATE_LIMITED' })
    expect(t.text).not.toHaveBeenCalled()
  })

  it('HTTP 429 and high-confidence verification pages trip the same circuit', async () => {
    for (const failure of [
      Object.assign(new Error('too many'), { status: 429 }),
      '当前环境异常，请稍后再试',
    ]) {
      const store = new MemoryStore(activeRequestState(0))
      const t = transport()
      if (typeof failure === 'string') t.text.mockResolvedValueOnce(failure)
      else t.text.mockRejectedValueOnce(failure)
      const gateway = new MpRequestGateway({ store, transport: t, now: () => 10 })
      await expect(gateway.fetchText('article-page', 'https://mp.weixin.qq.com/s/X', 60_000)).rejects.toThrow()
      expect(t.text).toHaveBeenCalledTimes(1)
      expect(store.state.mode).toBe('rate-limited')
    }
  })

  it('ordinary transport errors do not trip the circuit or retry', async () => {
    const store = new MemoryStore(activeRequestState(0))
    const t = transport()
    t.text.mockRejectedValueOnce(new Error('timeout'))
    const gateway = new MpRequestGateway({ store, transport: t, now: () => 10 })
    await expect(gateway.fetchText('article-page', 'https://mp.weixin.qq.com/s/X', 60_000)).rejects.toThrow('timeout')
    expect(t.text).toHaveBeenCalledTimes(1)
    expect(store.state.mode).toBe('active')
  })

  it('audit events never contain query tokens or signed asset parameters', async () => {
    const events: unknown[] = []
    const gateway = new MpRequestGateway({
      store: new MemoryStore(activeRequestState(0)), transport: transport(), now: () => 10,
      audit: (event) => { events.push(event) },
    })
    await gateway.fetchText('article-page', 'https://mp.weixin.qq.com/s/X?token=SECRET&auth_key=SIGNED', 60_000)
    const serialized = JSON.stringify(events)
    expect(serialized).toContain('mp.weixin.qq.com/s/X')
    expect(serialized).not.toContain('SECRET')
    expect(serialized).not.toContain('SIGNED')
    expect(serialized).not.toContain('token=')
  })

  it('an aborted queued request never reaches transport', async () => {
    const state = { ...activeRequestState(0), nextAllowedAt: 10_000 }
    const t = transport()
    const abort = new AbortController()
    const gateway = new MpRequestGateway({
      store: new MemoryStore(state), transport: t, now: () => 0,
      wait: async () => { abort.abort() },
    })
    await expect(gateway.fetchText('article-page', 'https://mp.weixin.qq.com/s/X', 60_000, abort.signal))
      .rejects.toMatchObject({ code: 'MP_REQUEST_CANCELLED' })
    expect(t.text).not.toHaveBeenCalled()
  })

  it('pause/resume are local state actions and do not probe network', async () => {
    const store = new MemoryStore(activeRequestState(0))
    const t = transport()
    const gateway = new MpRequestGateway({ store, transport: t, now: () => 10 })
    await gateway.pause('手动暂停')
    expect((await gateway.status()).mode).toBe('user-paused')
    await gateway.resume()
    expect((await gateway.status()).mode).toBe('active')
    expect(t.json).not.toHaveBeenCalled()
    expect(t.text).not.toHaveBeenCalled()
    expect(t.binary).not.toHaveBeenCalled()
  })

  it('exports stable structured protection errors', () => {
    expect(new MpRequestProtectionError('MP_COOLDOWN', 'wait').code).toBe('MP_COOLDOWN')
  })
})

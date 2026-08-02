import { describe, it, expect, vi } from 'vitest'
import { checkSubscriptions } from '../../src/core/check-subscriptions'
import { MpRateLimited, MpAuthExpired } from '../../src/core/mp-errors'
import type { SubscribedAccount } from '../../src/core/subscriptions'
import type { ArticleRef } from '../../src/core/mp-types'

const acc = (fakeid: string, watermark: number): SubscribedAccount =>
  ({ fakeid, nickname: fakeid, subscribed: true, watermark, lastCheckedAt: null, newRefs: [] })
const ref = (createTime: number): ArticleRef => ({ url: 'u' + createTime, title: 't' + createTime, createTime })
const fastSleep = async () => {}
const fetchStub = (async () => ({})) as never

describe('checkSubscriptions', () => {
  it('returns only refs newer than watermark, newest first, and advances latest', async () => {
    const listFn = vi.fn(async () => [ref(90), ref(120), ref(110)])
    const [r] = await checkSubscriptions([acc('f1', 100)], { mpFetch: fetchStub, token: 't', listFn, sleep: fastSleep })
    expect(r.ok).toBe(true)
    expect(r.newRefs.map((x) => x.createTime)).toEqual([120, 110])
    expect(r.latest).toBe(120)
  })

  it('passes the account watermark to the list function (翻到水位为止的接缝契约)', async () => {
    const listFn = vi.fn(async () => [] as ArticleRef[])
    await checkSubscriptions([acc('f1', 12345)], { mpFetch: fetchStub, token: 't', listFn: listFn as never, sleep: fastSleep })
    expect(listFn).toHaveBeenCalledWith(fetchStub, 't', 'f1', 12345, expect.anything())
  })

  it('no new articles → empty newRefs, latest stays at observed max', async () => {
    const listFn = vi.fn(async () => [ref(50), ref(80)])
    const [r] = await checkSubscriptions([acc('f1', 100)], { mpFetch: fetchStub, token: 't', listFn, sleep: fastSleep })
    expect(r.newRefs).toEqual([])
    expect(r.latest).toBe(100)
  })

  it('does NOT retry/backoff on rate-limit — aborts the whole run', async () => {
    const listFn = vi.fn(async () => { throw new MpRateLimited('rl') })
    const sleep = vi.fn(async () => {})
    await expect(checkSubscriptions([acc('f1', 100)], { mpFetch: fetchStub, token: 't', listFn, sleep }))
      .rejects.toBeInstanceOf(MpRateLimited)
    expect(listFn).toHaveBeenCalledTimes(1)   // 不退避重试,只试一次
    expect(sleep).not.toHaveBeenCalled()      // 没有 30/60/90s 退避等待
  })

  it('per-account isolation: one generic failure does not stop the rest', async () => {
    const listFn = vi.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce([ref(200)])
    // 注入恒等 shuffle 保持 f1→f2 顺序，让 mockOnce 序列可预期。
    const res = await checkSubscriptions([acc('f1', 100), acc('f2', 100)], { mpFetch: fetchStub, token: 't', listFn, sleep: fastSleep, shuffle: (a) => a })
    expect(res[0]).toMatchObject({ fakeid: 'f1', ok: false })
    expect(res[1]).toMatchObject({ fakeid: 'f2', ok: true })
  })

  // —— 去规律化（C：账号顺序每轮打乱，破坏「固定 fakeid 序列」指纹）——
  it('shuffles account order each run via the injected shuffle', async () => {
    const seen: string[] = []
    const listFn = vi.fn(async (_mp: unknown, _t: unknown, fakeid: string) => { seen.push(fakeid); return [] })
    const reverse = <T,>(a: T[]): T[] => [...a].reverse()
    const res = await checkSubscriptions([acc('f1', 0), acc('f2', 0), acc('f3', 0)],
      { mpFetch: fetchStub, token: 't', listFn: listFn as never, sleep: fastSleep, shuffle: reverse })
    expect(seen).toEqual(['f3', 'f2', 'f1'])                 // 按打乱后的顺序查询
    expect(res.map((r) => r.fakeid)).toEqual(['f3', 'f2', 'f1'])
  })

  it('does not own an inter-account sleep; the global gateway owns all timing', async () => {
    const delays: number[] = []
    const sleep = vi.fn(async (ms: number) => { delays.push(ms) })
    const listFn = vi.fn(async () => [])
    await checkSubscriptions([acc('f1', 0), acc('f2', 0)],
      { mpFetch: fetchStub, token: 't', listFn, sleep, shuffle: (a) => a })
    expect(delays).toEqual([])
  })

  it('auth-expired aborts the whole check', async () => {
    const listFn = vi.fn(async () => { throw new MpAuthExpired('expired') })
    await expect(checkSubscriptions([acc('f1', 100)], { mpFetch: fetchStub, token: 't', listFn, sleep: fastSleep }))
      .rejects.toBeInstanceOf(MpAuthExpired)
  })
})

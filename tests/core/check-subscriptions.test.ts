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

  it('no new articles → empty newRefs, latest stays at observed max', async () => {
    const listFn = vi.fn(async () => [ref(50), ref(80)])
    const [r] = await checkSubscriptions([acc('f1', 100)], { mpFetch: fetchStub, token: 't', listFn, sleep: fastSleep })
    expect(r.newRefs).toEqual([])
    expect(r.latest).toBe(100)
  })

  it('does NOT retry/backoff on rate-limit — records the account as failed and moves on', async () => {
    const listFn = vi.fn(async () => { throw new MpRateLimited('rl') })
    const sleep = vi.fn(async () => {})
    const [r] = await checkSubscriptions([acc('f1', 100)], { mpFetch: fetchStub, token: 't', listFn, sleep })
    expect(listFn).toHaveBeenCalledTimes(1)   // 不退避重试,只试一次
    expect(sleep).not.toHaveBeenCalled()      // 没有 30/60/90s 退避等待
    expect(r).toMatchObject({ fakeid: 'f1', ok: false, latest: 100 })
    expect(r.error).toBeTruthy()
  })

  it('per-account isolation: one generic failure does not stop the rest', async () => {
    const listFn = vi.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce([ref(200)])
    const res = await checkSubscriptions([acc('f1', 100), acc('f2', 100)], { mpFetch: fetchStub, token: 't', listFn, sleep: fastSleep })
    expect(res[0]).toMatchObject({ fakeid: 'f1', ok: false })
    expect(res[1]).toMatchObject({ fakeid: 'f2', ok: true })
  })

  it('auth-expired aborts the whole check', async () => {
    const listFn = vi.fn(async () => { throw new MpAuthExpired('expired') })
    await expect(checkSubscriptions([acc('f1', 100)], { mpFetch: fetchStub, token: 't', listFn, sleep: fastSleep }))
      .rejects.toBeInstanceOf(MpAuthExpired)
  })
})

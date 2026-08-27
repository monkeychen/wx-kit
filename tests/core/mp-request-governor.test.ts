import { describe, expect, it } from 'vitest'
import {
  activeRequestState,
  beginRequest,
  completeRequest,
  pauseRequests,
  planRequest,
  reserveRequest,
  resumeRequests,
  tripRateLimit,
} from '../../src/core/mp-request-governor'

describe('mp request governor', () => {
  it('reserves one global window shared by every request kind', () => {
    const now = 1_000
    const first = reserveRequest(activeRequestState(now), 'account-search', now, () => 0)
    expect(first.lastRequestAt).toBe(now)
    expect(first.nextAllowedAt).toBeGreaterThan(now)

    const second = planRequest(first, now + 1)
    expect(second).toEqual({ action: 'wait', waitMs: first.nextAllowedAt - now - 1, until: first.nextAllowedAt })
  })

  it('uses injected randomness and keeps values inside the policy range', () => {
    const now = 5_000
    const min = reserveRequest(activeRequestState(now), 'article-list', now, () => 0)
    const max = reserveRequest(activeRequestState(now), 'article-list', now, () => 1)
    expect(min.nextAllowedAt - now).toBe(6_000)
    expect(max.nextAllowedAt - now).toBe(12_000)
  })

  it('rejects user-paused state without scheduling a probe', () => {
    const state = pauseRequests(activeRequestState(1), '用户主动暂停', 2)
    expect(planRequest(state, 99)).toMatchObject({
      action: 'reject', code: 'MP_GOVERNOR_PAUSED', reason: '用户主动暂停',
    })
  })

  it('rate-limit trip survives time passing and only explicit resume reopens it', () => {
    const limited = tripRateLimit(activeRequestState(1), 'ret=200013', 10)
    expect(planRequest(limited, Number.MAX_SAFE_INTEGER)).toMatchObject({
      action: 'reject', code: 'MP_RATE_LIMITED', reason: 'ret=200013',
    })
    const resumed = resumeRequests(limited, 20)
    expect(planRequest(resumed, 20)).toEqual({ action: 'allow' })
  })

  it('asset requests are governed too, but use a small resource-stage interval', () => {
    const state = reserveRequest(activeRequestState(0), 'article-asset', 10, () => 0)
    expect(state.nextAllowedAt - 10).toBe(250)
  })

  it('weread kinds have their own intervals (list paced near the community-tested 2s floor)', () => {
    // rng=0 → 取区间下界；weread-list 下界 2.5s（社区实测最小安全间隔 2s + 余量）
    const list = reserveRequest(activeRequestState(0), 'weread-list', 10, () => 0)
    expect(list.nextAllowedAt - 10).toBe(2_500)
    const auth = reserveRequest(activeRequestState(0), 'weread-auth', 10, () => 0)
    expect(auth.nextAllowedAt - 10).toBe(8_000)
    // 上界（rng=1）：登录类动作与 MP 后台保守档一致
    const authMax = reserveRequest(activeRequestState(0), 'weread-auth', 10, () => 1)
    expect(authMax.nextAllowedAt - 10).toBe(15_000)
  })

  it('weread requests share the same global window as MP requests (no second pacing track)', () => {
    const afterList = reserveRequest(activeRequestState(0), 'weread-list', 0, () => 0)
    // 微信读书请求之后，MP 文章页请求也要等同一个窗口打开
    expect(planRequest(afterList, 1_000)).toMatchObject({ action: 'wait' })
  })

  it('keeps requests globally serial while another process owns an in-flight lease', () => {
    const state = beginRequest(activeRequestState(0), 'p1', 'article-list', 100, 5_000)
    expect(planRequest(state, 200)).toEqual({ action: 'wait', waitMs: 4_900, until: 5_100 })
    expect(completeRequest(state, 'other', 300).inFlight?.id).toBe('p1')
    expect(planRequest(completeRequest(state, 'p1', 300), 300)).toEqual({ action: 'allow' })
  })
})

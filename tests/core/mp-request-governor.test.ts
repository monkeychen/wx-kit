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

  it('keeps requests globally serial while another process owns an in-flight lease', () => {
    const state = beginRequest(activeRequestState(0), 'p1', 'article-list', 100, 5_000)
    expect(planRequest(state, 200)).toEqual({ action: 'wait', waitMs: 4_900, until: 5_100 })
    expect(completeRequest(state, 'other', 300).inFlight?.id).toBe('p1')
    expect(planRequest(completeRequest(state, 'p1', 300), 300)).toEqual({ action: 'allow' })
  })
})

import { describe, expect, it } from 'vitest'
import {
  PRIVATE_API_FEATURE_ENABLED,
  RETIRED_PRIVATE_API_COMMANDS,
  isRetiredPrivateRequest,
  retiredPrivateApiResponse,
} from '../../src/core/retired-private-api'

describe('M49 private API retirement boundary', () => {
  it('cannot be re-enabled by runtime state', () => {
    expect(PRIVATE_API_FEATURE_ENABLED).toBe(false)
  })

  it('covers every legacy CLI group and private request kind', () => {
    expect([...RETIRED_PRIVATE_API_COMMANDS]).toEqual([
      'search', 'crawl', 'login', 'auth-status', 'session', 'subscription', 'protection',
    ])
    expect(isRetiredPrivateRequest('auth-verify')).toBe(true)
    expect(isRetiredPrivateRequest('account-search')).toBe(true)
    expect(isRetiredPrivateRequest('article-list')).toBe(true)
    expect(isRetiredPrivateRequest('article-page')).toBe(false)
    expect(isRetiredPrivateRequest('article-asset')).toBe(false)
  })

  it('returns one stable user-facing contract', () => {
    expect(retiredPrivateApiResponse()).toMatchObject({
      ok: false,
      error: { code: 'MP_BACKEND_UNAVAILABLE', alternative: expect.stringContaining('download --url') },
    })
  })
})

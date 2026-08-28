import { describe, expect, it } from 'vitest'
import {
  PRIVATE_API_FEATURE_ENABLED,
  RETIRED_PRIVATE_API_COMMANDS,
  RETIRED_PRIVATE_API_SETTING_KEYS,
  isRetiredPrivateRequest,
  retiredPrivateApiResponse,
} from '../../src/core/retired-private-api'

// v0.10.0（M52）：按公众号下载与订阅经微信读书后端复活。命令与设置集合清空，
// 但 MP 后台私有请求类别的 transport 前拦截必须保留——那是 M49 的不可回退约束，
// 与微信读书链路无关。
describe('M52 weread revival boundary', () => {
  it('feature flag is enabled again', () => {
    expect(PRIVATE_API_FEATURE_ENABLED).toBe(true)
  })

  it('crawl command re-retired (2026-08-28, server-side list gating); setting keys stay clear', () => {
    expect([...RETIRED_PRIVATE_API_COMMANDS]).toEqual(['crawl'])
    expect([...RETIRED_PRIVATE_API_SETTING_KEYS]).toEqual([])
  })

  it('MP backend private kinds remain blocked at the gateway (M49 constraint untouched)', () => {
    expect(isRetiredPrivateRequest('auth-verify')).toBe(true)
    expect(isRetiredPrivateRequest('account-search')).toBe(true)
    expect(isRetiredPrivateRequest('article-list')).toBe(true)
    // 微信读书与公开文章链路不拦
    expect(isRetiredPrivateRequest('article-page')).toBe(false)
    expect(isRetiredPrivateRequest('article-asset')).toBe(false)
    expect(isRetiredPrivateRequest('weread-auth')).toBe(false)
    expect(isRetiredPrivateRequest('weread-list')).toBe(false)
  })

  it('legacy response contract kept for any future retirement', () => {
    expect(retiredPrivateApiResponse()).toMatchObject({
      ok: false,
      error: { code: 'MP_BACKEND_UNAVAILABLE', alternative: expect.stringContaining('download --url') },
    })
  })
})

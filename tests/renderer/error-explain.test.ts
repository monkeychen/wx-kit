// tests/renderer/error-explain.test.ts
import { describe, it, expect } from 'vitest'
import { explainError } from '../../src/renderer/error-explain'
import { MpRateLimited, MpAuthExpired, MpApiError } from '../../src/core/mp-errors'

describe('explainError', () => {
  it('maps rate-limit (by code and by message)', () => {
    expect(explainError(new MpRateLimited('微信频率限制（200013）')).title).toBe('微信访问太频繁')
    expect(explainError(new Error('mp ret 200013')).title).toBe('微信访问太频繁')
  })

  it('maps auth-expired (class, AUTH_REQUIRED string, 200040)', () => {
    expect(explainError(new MpAuthExpired('登录态失效（200040）')).title).toBe('登录已过期')
    expect(explainError(new Error('AUTH_REQUIRED')).title).toBe('登录已过期')
  })

  it('maps fetch timeout', () => {
    const ex = explainError(new Error('fetch timeout after 20000ms: https://mp.weixin.qq.com/s/x'))
    expect(ex.title).toBe('网络超时')
    expect(ex.hint).toContain('网络')
  })

  it('maps generic network failures', () => {
    expect(explainError(new Error('fetch failed')).title).toBe('网络异常')
    expect(explainError(new Error('getaddrinfo ENOTFOUND mp.weixin.qq.com')).title).toBe('网络异常')
  })

  it('maps deleted/invalid article', () => {
    const ex = explainError(new Error('invalid or unavailable article (no title parsed): https://x'))
    expect(ex.title).toBe('文章无法访问')
  })

  it('maps other mp api errors', () => {
    expect(explainError(new MpApiError(99, 'boom')).title).toBe('微信接口出错')
  })

  it('falls back for unknown errors but always keeps raw', () => {
    const ex = explainError(new Error('totally unexpected'))
    expect(ex.title).toBe('下载失败')
    expect(ex.raw).toBe('totally unexpected')
  })

  it('accepts non-Error values', () => {
    expect(explainError('plain string').raw).toBe('plain string')
  })
})

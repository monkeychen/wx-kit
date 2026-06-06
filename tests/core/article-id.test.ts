// tests/core/article-id.test.ts
import { describe, it, expect } from 'vitest'
import { articleId } from '../../src/core/article-id'

describe('articleId', () => {
  it('uses mid/idx/sn when present', () => {
    const url = 'https://mp.weixin.qq.com/s?__biz=AA&mid=2247483&idx=1&sn=abc123&chksm=zz&scene=27'
    expect(articleId(url)).toBe('2247483_1_abc123')
  })
  it('is stable regardless of volatile params order/extra', () => {
    const a = articleId('https://mp.weixin.qq.com/s?mid=1&idx=2&sn=x&scene=1')
    const b = articleId('https://mp.weixin.qq.com/s?scene=99&sn=x&idx=2&mid=1&key=zzz')
    expect(a).toBe(b)
  })
  it('falls back to hash for short-link style urls', () => {
    const id = articleId('https://mp.weixin.qq.com/s/AbCdEfGhIjK')
    expect(id).toMatch(/^h_[0-9a-f]{16}$/)
  })
})

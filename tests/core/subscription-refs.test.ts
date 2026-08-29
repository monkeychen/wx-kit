import { describe, expect, it } from 'vitest'
import { sourceUrlKey } from '../../src/core/subscription-refs'

describe('sourceUrlKey', () => {
  it('treats tilde and underscore variants of a WeChat short link as the same article', () => {
    expect(sourceUrlKey('https://mp.weixin.qq.com/s/ilzdL-DgdLxsY50qb~JCnw'))
      .toBe(sourceUrlKey('https://mp.weixin.qq.com/s/ilzdL-DgdLxsY50qb_JCnw'))
  })
})

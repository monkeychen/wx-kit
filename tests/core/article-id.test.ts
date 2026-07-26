// tests/core/article-id.test.ts
import { describe, it, expect } from 'vitest'
import { articleId, canonicalId } from '../../src/core/article-id'

describe('articleId', () => {
  it('用 mid+idx 作标识 —— 不含 sn(M36 起)', () => {
    // sn 是防伪/追踪参数,同一篇文章在不同分享链接里会变;mid+idx 才是微信的文章主键。
    // 含 sn 会让「同一篇的两个分享链接」被当成两篇,也让短链永远匹配不上长链。
    const url = 'https://mp.weixin.qq.com/s?__biz=AA&mid=2247483&idx=1&sn=abc123&chksm=zz&scene=27'
    expect(articleId(url)).toBe('2247483_1')
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
  it('没有 sn 也能算(mid+idx 就够)', () => {
    expect(articleId('https://mp.weixin.qq.com/s?mid=1&idx=1')).toBe('1_1')
  })
  it('缺 idx 时回退哈希(单靠 mid 不足以定位到具体某条)', () => {
    expect(articleId('https://mp.weixin.qq.com/s?mid=1')).toMatch(/^h_[0-9a-f]{16}$/)
  })
})

describe('跨 URL 形态的去重(M36 回归)', () => {
  // 同一篇文章:后台列表给短链、分享/旧接口给长链。M36 换列表接口后,
  // 短链算出的 id 与库里长链存的 id 对不上 → 已下过的文章被重下一遍。
  const LONG = 'http://mp.weixin.qq.com/s?__biz=Mzk1Nzg=&mid=2247494658&idx=2&sn=2f7dd1db0ad45055&chksm=xx#rd'
  const SHORT = 'https://mp.weixin.qq.com/s/9APk0OGkpfVXGvOkH641Qw'

  it('列表给了主键时,短链也能算出与长链一致的标识', () => {
    expect(articleId(SHORT, { appmsgid: 2247494658, itemidx: 2 })).toBe('2247494658_2')
    expect(canonicalId(articleId(LONG))).toBe('2247494658_2')
  })

  it('老库的 mid_idx_sn 与新的 mid_idx 归一后相等(不必迁移 library.json)', () => {
    expect(canonicalId('2247494658_2_2f7dd1db0ad45055')).toBe('2247494658_2')
    expect(canonicalId('2247494658_2')).toBe('2247494658_2')
  })

  it('短链哈希形态原样保留(没有主键可依据时不瞎归一)', () => {
    const h = articleId(SHORT)
    expect(h.startsWith('h_')).toBe(true)
    expect(canonicalId(h)).toBe(h)
  })

  it('idx 不同 = 不同文章(同一次群发的头条与次条)', () => {
    expect(articleId(SHORT, { appmsgid: 100, itemidx: 1 }))
      .not.toBe(articleId(SHORT, { appmsgid: 100, itemidx: 2 }))
  })
})

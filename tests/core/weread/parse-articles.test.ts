// tests/core/weread/parse-articles.test.ts
import { describe, it, expect } from 'vitest'
import { parseCover, urlFromReviewId, checkWereadError } from '../../../src/core/weread/parse-articles'
import { MpAuthExpired, MpApiError } from '../../../src/core/mp-errors'

const BOOK = 'MP_WXS_3634850725'

describe('parseCover · 当前 Web 端 /api/mp/cover 形态', () => {
  const payload = {
    avatar: 'http://wx.qlogo.cn/mmhead/123/0',
    name: '雷一言',
    title: '我给微信接上了自己的知识库',
    pic: 'https://mmbiz.qpic.cn/sz_mmbiz_jpg/xxx',
    reviewId: `${BOOK}_ASnNRsaFFzxgK1-8AblYhw`,
  }

  it('解析最新文章并拼接正确的原文 URL', () => {
    const cover = parseCover(payload, BOOK)
    expect(cover).not.toBeNull()
    expect(cover!.title).toBe('我给微信接上了自己的知识库')
    expect(cover!.accountName).toBe('雷一言')
    expect(cover!.coverUrl).toBe('https://mmbiz.qpic.cn/sz_mmbiz_jpg/xxx')
    expect(cover!.url).toBe('https://mp.weixin.qq.com/s/ASnNRsaFFzxgK1-8AblYhw')
  })

  it('缺 reviewId 或 title 时返回 null', () => {
    expect(parseCover({ title: 'T' }, BOOK)).toBeNull()
    expect(parseCover({ reviewId: 'R' }, BOOK)).toBeNull()
  })
})

describe('错误码翻译', () => {
  it('-2041/-2012/-2010 → MpAuthExpired（零重试语义）', () => {
    for (const code of [-2041, -2012, -2010]) {
      expect(() => checkWereadError({ errCode: code, errMsg: 'bad' })).toThrow(MpAuthExpired)
    }
  })
  it('其他非零 errCode → MpApiError', () => {
    expect(() => checkWereadError({ errCode: -5, errMsg: 'nope' })).toThrow(MpApiError)
  })
  it('errCode 0 / 缺省 / 字符串数字 都放行', () => {
    expect(() => checkWereadError({ errCode: 0 })).not.toThrow()
    expect(() => checkWereadError({})).not.toThrow()
    expect(() => checkWereadError({ errCode: '-2041' })).toThrow(MpAuthExpired)
  })
})

describe('urlFromReviewId · reviewId 末段兜底', () => {
  it('剥掉 bookId 前缀取 token', () => {
    expect(urlFromReviewId(`${BOOK}_4OcS7_rrtk2Lwe4P0YPiGg`, BOOK)).toBe('https://mp.weixin.qq.com/s/4OcS7_rrtk2Lwe4P0YPiGg')
  })
  it('token 里的 `~` 归一为 `_`（微信读书形态 → 微信原生短链形态，v0.10.6 实录：`~` 形态打不开）', () => {
    expect(urlFromReviewId(`${BOOK}_H7-G~vszhDe8tLaNuC4jZA`, BOOK)).toBe('https://mp.weixin.qq.com/s/H7-G_vszhDe8tLaNuC4jZA')
  })
  it('无前缀时取最后一段', () => {
    expect(urlFromReviewId('SOMEOTHER_123_tok', BOOK)).toBe('https://mp.weixin.qq.com/s/tok')
  })
  it('空串安全', () => {
    expect(urlFromReviewId('', BOOK)).toBe('')
  })
})

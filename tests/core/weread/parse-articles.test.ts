// tests/core/weread/parse-articles.test.ts
import { describe, it, expect } from 'vitest'
import { parseChapters, articleUrlFromEntry, urlFromReviewId, checkWereadError } from '../../../src/core/weread/parse-articles'
import { MpAuthExpired, MpApiError } from '../../../src/core/mp-errors'

const BOOK = 'MP_WXS_3634850725'

describe('parseChapters · 当前移动端 {data:[…]} 形态', () => {
  const payload = {
    errCode: 0,
    errMsg: '',
    data: [
      {
        reviewId: `${BOOK}_4OcS7~rrtk2Lwe4P0YPiGg`,
        title: '第一篇',
        createTime: 1787000000,
        mpInfo: { title: '第一篇', readNum: 1234, likeNum: 56, originalId: '4OcS7~rrtk2Lwe4P0YPiGg', content: '摘要', pic_url: 'https://pic/x.jpg' },
      },
      { reviewId: 'x', title: '' },   // 无 title → 跳过
      'garbage',                       // 非对象 → 跳过
    ],
  }

  it('解析条目并带出阅读/点赞数', () => {
    const list = parseChapters(payload, BOOK)
    expect(list).toHaveLength(1)
    expect(list[0].title).toBe('第一篇')
    expect(list[0].readNum).toBe(1234)
    expect(list[0].likeNum).toBe(56)
    expect(list[0].url).toBe('https://mp.weixin.qq.com/s/4OcS7~rrtk2Lwe4P0YPiGg')
    expect(list[0].createTime).toBe(1787000000)
  })

  it('mpInfo.time 优先于条目 createTime', () => {
    const list = parseChapters({ data: [{ reviewId: 'r1', title: 't', createTime: 1, mpInfo: { time: 99, originalId: 'a' } }] }, BOOK)
    expect(list[0].createTime).toBe(99)
  })

  it('阅读数缺省时字段缺省（不是 0——0 和「没给」含义不同）', () => {
    const list = parseChapters({ data: [{ reviewId: 'r1', title: 't', mpInfo: {} }] }, BOOK)
    expect(list[0].readNum).toBeUndefined()
    expect(list[0].likeNum).toBeUndefined()
  })
})

describe('parseChapters · 旧版 reviews[].subReviews[] 形态', () => {
  const payload = {
    reviews: [
      {
        createTime: 1787000500,
        subReviews: [
          { review: { reviewId: 'rev-1', title: '旧版篇', mpInfo: { readNum: 7, likeNum: 2, originalId: '/s?__biz=AAA&mid=1&idx=1' } } },
          { review: { reviewId: 'rev-2', title: '组时间兜底', createTime: 0, mpInfo: {} } },
        ],
      },
    ],
  }

  it('嵌套解析 + 组时间兜底 + __biz 查询串拼长链', () => {
    const list = parseChapters(payload, BOOK)
    expect(list).toHaveLength(2)
    expect(list[0].url).toBe('https://mp.weixin.qq.com/s?__biz=AAA&mid=1&idx=1')
    expect(list[0].readNum).toBe(7)
    expect(list[1].createTime).toBe(1787000500)
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
  it('parseChapters 直接拿到错误码也翻译', () => {
    expect(() => parseChapters({ errCode: -2012 }, BOOK)).toThrow(MpAuthExpired)
  })
})

describe('articleUrlFromEntry · URL 候选顺序', () => {
  it('doc_url/docUrl/url 优先直用', () => {
    expect(articleUrlFromEntry({ doc_url: 'https://mp.weixin.qq.com/s/a' }, {})).toBe('https://mp.weixin.qq.com/s/a')
    expect(articleUrlFromEntry({ docUrl: 'https://x/s/b' }, {})).toBe('https://x/s/b')
  })
  it('originalId 四形态：完整 URL / "/s…" / "__biz=…" / 裸 token（~ 保留）', () => {
    expect(articleUrlFromEntry({ originalId: 'https://mp.weixin.qq.com/s/z' }, {})).toBe('https://mp.weixin.qq.com/s/z')
    expect(articleUrlFromEntry({ originalId: '/s/abc' }, {})).toBe('https://mp.weixin.qq.com/s/abc')
    expect(articleUrlFromEntry({ originalId: '__biz=AA&mid=2&idx=3' }, {})).toBe('https://mp.weixin.qq.com/s?__biz=AA&mid=2&idx=3')
    expect(articleUrlFromEntry({ originalId: '4OcS7~rrtk2' }, {})).toBe('https://mp.weixin.qq.com/s/4OcS7~rrtk2')
  })
  it('什么都没有 → 空串（调用方走 reviewId 兜底）', () => {
    expect(articleUrlFromEntry({}, {})).toBe('')
  })
})

describe('urlFromReviewId · reviewId 末段兜底', () => {
  it('剥掉 bookId 前缀取 token', () => {
    expect(urlFromReviewId(`${BOOK}_4OcS7~rrtk2Lwe4P0YPiGg`, BOOK)).toBe('https://mp.weixin.qq.com/s/4OcS7~rrtk2Lwe4P0YPiGg')
  })
  it('无前缀时取最后一段', () => {
    expect(urlFromReviewId('SOMEOTHER_123_tok', BOOK)).toBe('https://mp.weixin.qq.com/s/tok')
  })
  it('空串安全', () => {
    expect(urlFromReviewId('', BOOK)).toBe('')
  })
})

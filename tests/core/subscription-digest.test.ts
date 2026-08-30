import { describe, expect, it } from 'vitest'
import { subscriptionDigest } from '../../src/core/subscription-digest'
import type { ArticleMeta } from '../../src/core/types'

const article = (id: string, publishTime: string, account = '测试号'): ArticleMeta => ({
  id, publishTime, account, title: id, author: '', sourceUrl: `https://mp.weixin.qq.com/s/${id}`,
  downloadTime: '2026-08-30T03:00:00Z', digest: '', coverUrl: '', formats: ['md'], dir: `/library/${id}`,
})
const accounts = [{ fakeid: 'MP_WXS_1', nickname: '测试号' }]

describe('本地发表日期日报', () => {
  it('按发表时间查询且 ISO 时区归入北京时间，忽略下载日期和其它账号', async () => {
    const result = await subscriptionDigest({ accounts, date: '2026-08-30', library: [
      article('old', '2026-08-29 21:00'), article('new', '2026-08-30 10:00'),
      article('utc', '2026-08-29T16:30:00Z'), article('other', '2026-08-30 11:00', '其它号'),
    ] })
    expect(result.articles.map((a) => a.id)).toEqual(['new', 'utc'])
    expect(result.articles.every((a) => a.downloaded)).toBe(true)
    expect(result.articles[0].contentPath).toBeUndefined()
    expect(result.coverageNote).toContain('本地')
  })
  it('未知时间统计覆盖所选账号，不把无效日期滚入下一天', async () => {
    const result = await subscriptionDigest({ accounts, date: '2026-03-02', library: [
      article('empty', ''), article('invalid', '2026-02-30 09:00'),
      article('other', '', '其它号'), article('valid', '2026-03-02'),
    ] })
    expect(result.unknownPublishTimeCount).toBe(2)
    expect(result.articles.map((a) => a.id)).toEqual(['valid'])
    expect(result.warnings?.join('')).toContain('2')
  })
})

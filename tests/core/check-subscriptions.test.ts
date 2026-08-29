import { describe, expect, it } from 'vitest'
import { checkSubscriptions } from '../../src/core/check-subscriptions'
import type { ArticleRef } from '../../src/core/mp-types'
import type { SubscribedAccount } from '../../src/core/subscriptions'

const account = (over: Partial<SubscribedAccount> = {}): SubscribedAccount => ({
  fakeid: 'MP_WXS_1', nickname: '测试号', subscribed: true, watermark: 100,
  lastCheckedAt: null, newRefs: [], ...over,
})

const cover = (reviewId: string, createTime: number): ArticleRef => ({
  url: `https://mp.weixin.qq.com/s/${reviewId}`,
  title: '最新文章',
  createTime,
  sourceId: reviewId,
}) as ArticleRef

describe('checkSubscriptions cover 身份游标', () => {
  it('同一 reviewId 的发现时间变晚时不重复报新', async () => {
    const results = await checkSubscriptions([account({ latestArticleId: 'review-1' })], {
      list: async () => [cover('review-1', 200)],
      shuffle: (items) => items,
    })

    expect(results[0]).toMatchObject({ ok: true, newRefs: [] })
  })
})

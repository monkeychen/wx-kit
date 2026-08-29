import { describe, expect, it, vi } from 'vitest'
import { runSubscriptionCheck } from '../../electron/services/subscription-check'
import type { SubscribedAccount, Subscriptions } from '../../src/core/subscriptions'

const account: SubscribedAccount = {
  fakeid: 'MP_WXS_1', nickname: '测试号', subscribed: true, watermark: 100,
  lastCheckedAt: null, newRefs: [],
}

describe('runSubscriptionCheck 旧订阅迁移', () => {
  it('没有 identity 游标但当前 cover 已在文库时建立游标且不重复报新', async () => {
    const updateWatermark = vi.fn(async () => {})
    const addNewRefs = vi.fn(async () => {})
    const subs = { list: async () => [account], updateWatermark, addNewRefs, setLastRunAt: async () => {} } as unknown as Subscriptions
    const result = await runSubscriptionCheck('manual', {
      subs,
      settings: { defaultFormats: ['md'], subscriptionNewArticleAction: 'notify' },
      list: async () => [],
      check: async () => [{ fakeid: account.fakeid, ok: true, latest: 200, latestArticleId: 'review-1', newRefs: [{ url: 'https://mp.weixin.qq.com/s/x', title: '旧文', createTime: 200, sourceId: 'review-1' }] }],
      isRefDownloaded: async () => true,
      downloadRefs: async () => ({ ok: true, total: 0, succeeded: 0, failed: 0, skipped: 0, items: [] }),
      log: async () => {},
    })

    expect(result).toMatchObject({ newFound: 0, results: [{ newFound: 0 }] })
    expect(addNewRefs).not.toHaveBeenCalled()
    expect(updateWatermark).toHaveBeenCalledWith(account.fakeid, 200, 'review-1')
  })
})

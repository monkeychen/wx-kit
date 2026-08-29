import { describe, expect, it } from 'vitest'
import { collectPendingDownloads } from '../../src/core/subscription-batch'
import type { SubscribedAccount } from '../../src/core/subscriptions'

const account = (fakeid: string, refs: number, subscribed = true): SubscribedAccount => ({
  fakeid, nickname: fakeid, subscribed, watermark: 0, lastCheckedAt: null,
  newRefs: Array.from({ length: refs }, (_, i) => ({ url: `https://mp.weixin.qq.com/s/${fakeid}-${i}`, title: String(i), createTime: i })),
})

describe('collectPendingDownloads', () => {
  it('只收集已订阅且有待处理文章的账号，并保留账号和文章顺序', () => {
    const groups = collectPendingDownloads([
      account('a', 2), account('b', 0), account('c', 1, false), account('d', 1),
    ])

    expect(groups.map((g) => [g.fakeid, g.refs.length])).toEqual([['a', 2], ['d', 1]])
  })
})

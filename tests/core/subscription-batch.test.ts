import { describe, expect, it } from 'vitest'
import { collectPendingDownloads, toAccountDownloadLog, countDownloadOutcomes } from '../../src/core/subscription-batch'
import type { AccountDownloadLog, SubscribedAccount } from '../../src/core/subscriptions'
import type { DownloadSummary } from '../../src/core/types'

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

describe('toAccountDownloadLog（M56 手动批量明细）', () => {
  it('组身份 + 逐篇四状态；标题缺省按 url 从组 refs 补；cancelled 不产出', () => {
    const group = collectPendingDownloads([account('a', 3)])[0]
    const summary: DownloadSummary = {
      ok: false, total: 3, succeeded: 1, failed: 2, skipped: 1,
      items: [
        { url: group.refs[0].url, ok: true },                   // downloaded，标题从 refs 补
        { url: group.refs[1].url, ok: true, skipped: true },     // exists
        { url: group.refs[2].url, ok: false, cancelled: true },  // 未尝试 → 不产出
      ],
    }

    // M58 起明细带 url/refId——断言改 toMatchObject 聚焦状态语义
    expect(toAccountDownloadLog(group, summary)).toMatchObject({
      fakeid: 'a', nickname: 'a',
      items: [
        { title: '0', status: 'downloaded' },
        { title: '1', status: 'exists' },
      ],
    })
  })

  it('失败项带 error.message 时透传为 error 字段', () => {
    const group = collectPendingDownloads([account('a', 1)])[0]
    const summary: DownloadSummary = {
      ok: false, total: 1, succeeded: 0, failed: 1, skipped: 0,
      items: [{ url: group.refs[0].url, ok: false, error: { code: 'DOWNLOAD_FAILED', message: 'boom' } }],
    }

    expect(toAccountDownloadLog(group, summary).items[0]).toMatchObject({ title: '0', status: 'failed', error: 'boom' })
  })
})

describe('countDownloadOutcomes（M56 与明细同源的计数）', () => {
  it('跨号累计 downloaded/exists；failed/unavailable 不计入；空明细为 0', () => {
    const details: AccountDownloadLog[] = [
      { fakeid: 'a', nickname: 'a', items: [
        { title: 'x', status: 'downloaded' }, { title: 'y', status: 'exists' },
        { title: 'z', status: 'unavailable' }, { title: 'w', status: 'failed', error: 'e' },
      ] },
      { fakeid: 'b', nickname: 'b', items: [
        { title: 'p', status: 'downloaded' }, { title: 'q', status: 'downloaded' },
      ] },
    ]

    expect(countDownloadOutcomes(details)).toEqual({ downloaded: 3, existed: 1 })
    expect(countDownloadOutcomes([])).toEqual({ downloaded: 0, existed: 0 })
  })

  it('与 DownloadQueue 汇总口径一致：downloaded=succeeded、existed=skipped（锁死两条口径不漂移）', () => {
    const group = collectPendingDownloads([account('b', 4)])[0]
    const summary: DownloadSummary = {
      ok: false, total: 4, succeeded: 2, failed: 2, skipped: 1, unavailable: 1,
      items: [
        { url: group.refs[0].url, ok: true },
        { url: group.refs[1].url, ok: true },
        { url: group.refs[2].url, ok: true, skipped: true },
        { url: group.refs[3].url, ok: false, unavailable: true },
      ],
    }

    expect(countDownloadOutcomes([toAccountDownloadLog(group, summary)]))
      .toEqual({ downloaded: summary.succeeded, existed: summary.skipped })
  })
})

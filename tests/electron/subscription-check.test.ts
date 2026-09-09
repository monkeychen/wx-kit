import { describe, expect, it, vi } from 'vitest'
import { runSubscriptionCheck } from '../../electron/services/subscription-check'
import { formatCheckLogLine, type CheckLogEntry, type SubscribedAccount, type Subscriptions } from '../../src/core/subscriptions'
import type { DownloadSummary } from '../../src/core/types'

const account: SubscribedAccount = {
  fakeid: 'MP_WXS_1', nickname: '测试号', subscribed: true, watermark: 100,
  lastCheckedAt: null, newRefs: [],
}

/** M56 下载交付落盘测试共用的待处理文章（url 与 summary.items 的 url 对得上） */
const mkRefs = (n: number) => Array.from({ length: n }, (_, i) => ({
  url: `https://mp.weixin.qq.com/s/u${i + 1}`, title: `待处理${i + 1}`, createTime: 200 + i, sourceId: `r${i + 1}`,
}))

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

  it('same cover identity removes an already-downloaded historical pending item', async () => {
    const removeNewRefs = vi.fn(async () => {})
    const existing = {
      ...account,
      latestArticleId: 'review-1',
      newRefs: [{ url: 'https://mp.weixin.qq.com/s/token~x', title: '旧文', createTime: 200, sourceId: 'review-1' }],
    }
    const subs = {
      list: async () => [existing], updateWatermark: async () => {}, removeNewRefs,
      setLastRunAt: async () => {},
    } as unknown as Subscriptions
    await runSubscriptionCheck('manual', {
      subs,
      settings: { defaultFormats: ['md'], subscriptionNewArticleAction: 'download' },
      list: async () => [],
      check: async () => [{ fakeid: existing.fakeid, ok: true, latest: 200, latestArticleId: 'review-1', newRefs: [] }],
      isRefDownloaded: async () => true,
      downloadRefs: async () => ({ ok: true, total: 0, succeeded: 0, failed: 0, skipped: 0, items: [] }),
      log: async () => {},
    })

    expect(removeNewRefs).toHaveBeenCalledWith(existing.fakeid, ['https://mp.weixin.qq.com/s/token_x'])
  })
})

describe('runSubscriptionCheck 下载交付落盘（M56）', () => {
  it('download 策略：落 kind=check 的逐号逐篇明细，downloaded/existed 与四状态一致，待处理保留语义不变', async () => {
    const refs = mkRefs(5)
    const summary: DownloadSummary = {
      ok: false, total: 5, succeeded: 1, failed: 3, skipped: 1, unavailable: 1,
      items: [
        { url: refs[0].url, ok: true, title: '文章一' },                                            // downloaded
        { url: refs[1].url, ok: true, skipped: true, title: '文章二' },                              // exists
        { url: refs[2].url, ok: false, unavailable: true },                                        // unavailable（标题从 refs 补）
        { url: refs[3].url, ok: false, error: { code: 'DOWNLOAD_FAILED', message: 'boom' } },        // failed
        { url: refs[4].url, ok: false, cancelled: true },                                           // 未尝试 → 不产出日志
      ],
    }
    const setPendingRefs = vi.fn(async () => {})
    const logged: CheckLogEntry[] = []
    const subs = {
      list: async () => [account], updateWatermark: async () => {}, addNewRefs: async () => {},
      setPendingRefs, clearNewRefs: async () => {}, setLastRunAt: async () => {},
    } as unknown as Subscriptions
    const result = await runSubscriptionCheck('manual', {
      subs,
      settings: { defaultFormats: ['md'], subscriptionNewArticleAction: 'download' },
      list: async () => [],
      check: async () => [{ fakeid: account.fakeid, ok: true, latest: 300, latestArticleId: 'review-9', newRefs: refs }],
      downloadRefs: vi.fn(async () => summary),
      log: async (e) => { logged.push(e) },
    })

    const entry = logged.at(-1)!
    expect(entry).toMatchObject({
      trigger: 'manual', accounts: 1, newFound: 5, failed: 0,
      kind: 'check', downloaded: 1, existed: 1,
    })
    // M58 起明细带 url/refId——断言改 toMatchObject 聚焦状态语义
    expect(entry.downloadDetail).toMatchObject([
      {
        fakeid: account.fakeid, nickname: account.nickname,
        items: [
          { title: '文章一', status: 'downloaded' },
          { title: '文章二', status: 'exists' },
          { title: '待处理3', status: 'unavailable' },
          { title: '待处理4', status: 'failed', error: 'boom' },
        ],
      },
    ])
    // 「真故障/未尝试留在待处理」语义不变：u1/u2/u3 处理完清掉，u4(故障)/u5(取消)留下
    expect(setPendingRefs).toHaveBeenCalledWith(account.fakeid, [refs[3], refs[4]])
    // PerAccountResult 的 downloaded 仍取 summary.succeeded
    expect(result.results[0]).toMatchObject({ newFound: 5, downloaded: 1 })
    // M56 T5:行结果挂逐篇明细 articles,与落盘的 downloadDetail 同源（一份收集、两处消费），
    // CLI check-now 经 outJson 透传后即 results[].articles
    expect(result.results[0].articles).toEqual(entry.downloadDetail![0].items)
  })

  it('仅提示策略：entry 不写 kind/downloaded/existed（缺省而非 0）；M58 起 downloadDetail 落 pending 明细', async () => {
    const downloadRefs = vi.fn(async () => { throw new Error('notify 策略不应下载') })
    const logged: CheckLogEntry[] = []
    const subs = {
      list: async () => [account], updateWatermark: async () => {}, addNewRefs: async () => {},
      setLastRunAt: async () => {},
    } as unknown as Subscriptions
    const result = await runSubscriptionCheck('auto', {
      subs,
      settings: { defaultFormats: ['md'], subscriptionNewArticleAction: 'notify' },
      list: async () => [],
      check: async () => [{ fakeid: account.fakeid, ok: true, latest: 300, latestArticleId: 'review-9', newRefs: mkRefs(2) }],
      downloadRefs, log: async (e) => { logged.push(e) },
    })

    const entry = logged.at(-1)!
    expect(entry.newFound).toBe(2)
    expect('kind' in entry).toBe(false)
    expect('downloaded' in entry).toBe(false)
    expect('existed' in entry).toBe(false)
    // M58:downloadDetail 全号落条目(提示策略 = pending 明细),单行字段纪律不变
    expect(entry.downloadDetail?.[0]).toMatchObject({ fakeid: account.fakeid })
    expect(entry.downloadDetail?.[0].items.every((i) => i.status === 'pending')).toBe(true)
    expect(downloadRefs).not.toHaveBeenCalled()
    // M56 T5:无下载动作的行结果不写 articles 字段（缺省而非空数组）
    expect(result.results[0]).toMatchObject({ newFound: 2, downloaded: 0 })
    expect('articles' in result.results[0]).toBe(false)
  })

  it('fakeids 入参按身份归一匹配（CLI list 输出 MP_WXS_ 形态 vs 磁盘 base64 形态）', async () => {
    // v0.10.4 实录：subscription list 输出归一后的 MP_WXS_ fakeid，check-now --accounts
    // 按它传入却在字面比对磁盘里的 base64 形态 → 永远 accounts:0
    const legacy: SubscribedAccount = { ...account, fakeid: 'MzI2NDU4OTExOQ==' } // base64 ⇄ MP_WXS_3264589119
    const subs = {
      list: async () => [legacy],
      updateWatermark: async () => {}, setPendingRefs: async () => {},
      clearNewRefs: async () => {}, setLastRunAt: async () => {},
    } as unknown as Subscriptions
    const seenAccounts: string[] = []
    await runSubscriptionCheck('manual', {
      subs,
      settings: { defaultFormats: ['md'], subscriptionNewArticleAction: 'notify' },
      list: async () => [],
      fakeids: ['MP_WXS_3264589119'],
      check: async (accs) => {
        seenAccounts.push(...accs.map((a) => a.fakeid))
        return [{ fakeid: legacy.fakeid, ok: true, latest: 300, newRefs: [] }]
      },
      downloadRefs: vi.fn(async () => ({ ok: true, total: 0, succeeded: 0, failed: 0, skipped: 0, items: [] })),
      log: async () => {},
    })
    expect(seenAccounts).toEqual(['MzI2NDU4OTExOQ=='])
  })

  it('manual + fakeids 子集 + download 策略：同样落明细，明细收集对 trigger 无感', async () => {
    const other: SubscribedAccount = { ...account, fakeid: 'MP_WXS_2', nickname: '二号' }
    const refs = mkRefs(2)
    const summary: DownloadSummary = {
      ok: true, total: 2, succeeded: 2, failed: 0, skipped: 0,
      items: refs.map((r) => ({ url: r.url, ok: true, title: r.title })),
    }
    const seenAccounts: string[] = []
    const logged: CheckLogEntry[] = []
    const subs = {
      list: async () => [account, other], updateWatermark: async () => {},
      setPendingRefs: async () => {}, clearNewRefs: async () => {}, setLastRunAt: async () => {},
    } as unknown as Subscriptions
    await runSubscriptionCheck('manual', {
      subs,
      settings: { defaultFormats: ['md'], subscriptionNewArticleAction: 'download' },
      list: async () => [],
      fakeids: [account.fakeid],
      check: async (accs) => {
        seenAccounts.push(...accs.map((a) => a.fakeid))
        return [{ fakeid: account.fakeid, ok: true, latest: 300, latestArticleId: 'review-9', newRefs: refs }]
      },
      downloadRefs: vi.fn(async () => summary),
      log: async (e) => { logged.push(e) },
    })

    expect(seenAccounts).toEqual([account.fakeid]) // 子集只查这一个号，不查 other
    const entry = logged.at(-1)!
    expect(entry).toMatchObject({ trigger: 'manual', accounts: 1, kind: 'check', downloaded: 2, existed: 0 })
    expect(entry.downloadDetail).toMatchObject([
      {
        fakeid: account.fakeid, nickname: account.nickname,
        items: [
          { title: '待处理1', status: 'downloaded' },
          { title: '待处理2', status: 'downloaded' },
        ],
      },
    ])
  })

  it('落盘的新 entry 经 formatCheckLogLine 单行含 downloaded=N existed=N（检查记录日志可读）', async () => {
    const refs = mkRefs(2)
    const summary: DownloadSummary = {
      ok: true, total: 2, succeeded: 1, failed: 0, skipped: 1,
      items: [
        { url: refs[0].url, ok: true, title: '文章一' },
        { url: refs[1].url, ok: true, skipped: true, title: '文章二' },
      ],
    }
    const logged: CheckLogEntry[] = []
    const subs = {
      list: async () => [account], updateWatermark: async () => {},
      setPendingRefs: async () => {}, clearNewRefs: async () => {}, setLastRunAt: async () => {},
    } as unknown as Subscriptions
    await runSubscriptionCheck('manual', {
      subs,
      settings: { defaultFormats: ['md'], subscriptionNewArticleAction: 'download' },
      list: async () => [],
      check: async () => [{ fakeid: account.fakeid, ok: true, latest: 300, latestArticleId: 'review-9', newRefs: refs }],
      downloadRefs: async () => summary,
      log: async (e) => { logged.push(e) },
    })

    expect(formatCheckLogLine(logged.at(-1)!)).toMatch(/MANUAL accounts=1 new=2 failed=0 downloaded=1 existed=1$/)
  })
})

describe('runSubscriptionCheck · 全号落明细 (M58)', () => {
  const mkSubs = () => {
    const logged: CheckLogEntry[] = []
    const subs = {
      list: async () => [account], updateWatermark: async () => {},
      addNewRefs: async () => {}, setPendingRefs: async () => {}, clearNewRefs: async () => {},
      setLastRunAt: async () => {},
      appendCheckLog: async (e: CheckLogEntry) => { logged.unshift(e) },
    } as unknown as Subscriptions
    return { logged, subs }
  }

  it('提示策略：downloadDetail 落 pending 明细（带 url/refId），不再只认 download 策略', async () => {
    const { logged, subs } = mkSubs()
    const refs = mkRefs(2)
    await runSubscriptionCheck('manual', {
      subs,
      settings: { defaultFormats: ['md'], subscriptionNewArticleAction: 'notify' },
      list: async () => [],
      check: async () => [{ fakeid: account.fakeid, ok: true, latest: 300, latestArticleId: 'review-9', newRefs: refs }],
      downloadRefs: async () => ({ ok: true, total: 0, succeeded: 0, failed: 0, skipped: 0, items: [] }),
      log: async (e) => { logged.unshift(e) },
    })
    const detail = logged[0].downloadDetail?.find((d) => d.fakeid === account.fakeid)
    expect(detail?.items).toEqual([
      { title: '待处理1', status: 'pending', url: refs[0].url, refId: expect.stringMatching(/.+/) },
      { title: '待处理2', status: 'pending', url: refs[1].url, refId: expect.stringMatching(/.+/) },
    ])
  })

  it('无新文章的号落空 items 条目（显式「查过、无新」）', async () => {
    const { logged, subs } = mkSubs()
    await runSubscriptionCheck('manual', {
      subs,
      settings: { defaultFormats: ['md'], subscriptionNewArticleAction: 'download' },
      list: async () => [],
      check: async () => [{ fakeid: account.fakeid, ok: true, latest: 300, latestArticleId: 'review-9', newRefs: [] }],
      isRefDownloaded: async () => false,
      downloadRefs: async () => ({ ok: true, total: 0, succeeded: 0, failed: 0, skipped: 0, items: [] }),
      log: async (e) => { logged.unshift(e) },
    })
    expect(logged[0].downloadDetail).toEqual([{ fakeid: account.fakeid, nickname: account.nickname, items: [] }])
  })

  it('articleId 直接取下载结果自带的 id（跨 URL 形态不可靠，按 id 不按 url 反查）', async () => {
    const { logged, subs } = mkSubs()
    const refs = mkRefs(2)
    await runSubscriptionCheck('manual', {
      subs,
      settings: { defaultFormats: ['md'], subscriptionNewArticleAction: 'download' },
      list: async () => [],
      check: async () => [{ fakeid: account.fakeid, ok: true, latest: 300, latestArticleId: 'review-9', newRefs: refs }],
      isRefDownloaded: async () => false,
      downloadRefs: async () => ({
        ok: true, total: 2, succeeded: 1, failed: 0, skipped: 1,
        items: [
          { url: refs[0].url, ok: true, title: '待处理1', id: 'art-1' },
          { url: refs[1].url, ok: true, skipped: true, title: '待处理2', id: 'art-2' },
        ],
      }),
      log: async (e) => { logged.unshift(e) },
    })
    const items = logged[0].downloadDetail?.[0].items ?? []
    expect(items[0]).toMatchObject({ status: 'downloaded', articleId: 'art-1' })
    expect(items[1]).toMatchObject({ status: 'exists', articleId: 'art-2' })
  })
})

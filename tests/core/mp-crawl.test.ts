// tests/core/mp-crawl.test.ts
import { describe, it, expect, vi } from 'vitest'
import { crawlAccount, filterRefsByTitle } from '../../src/core/mp-crawl'
import { ArticleUnavailableError } from '../../src/core/download-article'
import { MpRateLimited } from '../../src/core/mp-errors'
import type { ArticleRef, CrawlItemEvent } from '../../src/core/mp-types'
import type { DownloadItemResult } from '../../src/core/types'

const refs = (urls: string[]): ArticleRef[] => urls.map((u) => ({ url: u, title: u, createTime: 0 }))
const noSleep = async () => {}

describe('crawlAccount', () => {
  it('downloads serially and rolls up a summary', async () => {
    const order: string[] = []
    const downloadOne = async (url: string): Promise<DownloadItemResult> => { order.push(url); return { url, ok: true, id: url } }
    const out = await crawlAccount('FID', { count: 3 }, {
      listFn: async () => refs(['a', 'b', 'c']),
      mpFetch: (async () => ({})) as never, token: 'T', downloadOne, sleep: noSleep,
    })
    expect(order).toEqual(['a', 'b', 'c'])
    expect(out).toMatchObject({ ok: true, fakeid: 'FID', listed: 3, total: 3, succeeded: 3, failed: 0, skipped: 0 })
  })

  it('continues past a single failure and counts skips', async () => {
    const downloadOne = async (url: string): Promise<DownloadItemResult> => {
      if (url === 'b') throw new Error('boom')
      if (url === 'c') return { url, ok: true, skipped: true, id: url }
      return { url, ok: true, id: url }
    }
    const out = await crawlAccount('FID', { count: 3 }, {
      listFn: async () => refs(['a', 'b', 'c']),
      mpFetch: (async () => ({})) as never, token: 'T', downloadOne, sleep: noSleep,
    })
    expect(out).toMatchObject({ succeeded: 1, failed: 1, skipped: 1 })
  })

  it('backs off and retries when listing is rate-limited', async () => {
    const sleep = vi.fn(async () => {})
    let calls = 0
    const listFn = async () => { if (calls++ === 0) throw new MpRateLimited('rl'); return refs(['a']) }
    const out = await crawlAccount('FID', { count: 1 }, {
      listFn, mpFetch: (async () => ({})) as never, token: 'T',
      downloadOne: async (url) => ({ url, ok: true, id: url }), sleep,
    })
    expect(out.succeeded).toBe(1)
    expect(sleep).toHaveBeenCalledWith(30000) // 第一次退避 30s
  })

  it('aborts the rate-limit backoff wait the moment cancel fires (does not retry)', async () => {
    const controller = new AbortController()
    let calls = 0
    // 退避等待用「永不自行 resolve」的 sleep 模拟还卡在 30s 退避里；只有取消能让它返回。
    const sleep = vi.fn(() => new Promise<void>(() => {}))
    const listFn = async () => { calls++; throw new MpRateLimited('rl') }
    const out = await crawlAccount('FID', { count: 1 }, {
      listFn, mpFetch: (async () => ({})) as never, token: 'T',
      downloadOne: async (url) => ({ url, ok: true, id: url }), sleep,
      signal: controller.signal,
      // onBackoff 在进入退避等待时触发 → 立刻取消，验证等待被即时打断、不再 retry。
      onBackoff: () => controller.abort(),
    })
    expect(sleep).toHaveBeenCalledWith(30000) // 退避仍以 30s 发起（契约不变）
    expect(calls).toBe(1)                      // 取消后没有第二次 listFn 重试
    expect(out.listed).toBe(0)                 // 列表阶段被取消，无文章
  })

  it('reports each backoff so the UI can show「退避中」(R5)', async () => {
    const sleep = vi.fn(async () => {})
    const onBackoff = vi.fn()
    let calls = 0
    // 头两次频控、第三次成功 → 退避两次（30s、60s）。
    const listFn = async () => { if (calls++ < 2) throw new MpRateLimited('rl'); return refs(['a']) }
    const out = await crawlAccount('FID', { count: 1 }, {
      listFn, mpFetch: (async () => ({})) as never, token: 'T',
      downloadOne: async (url) => ({ url, ok: true, id: url }), sleep, onBackoff,
    })
    expect(out.succeeded).toBe(1)
    expect(onBackoff.mock.calls.map((c) => c[0])).toEqual([
      { attempt: 1, waitMs: 30000, reason: 'rate-limit' },
      { attempt: 2, waitMs: 60000, reason: 'rate-limit' },
    ])
  })
})

describe('crawlAccount reporting & cancel', () => {
  it('emits onListed once then per-item statuses in order', async () => {
    const listedCalls: string[][] = []
    const events: CrawlItemEvent[] = []
    const downloadOne = async (url: string) => {
      if (url === 'b') throw new Error('x')
      return { url, ok: true, skipped: url === 'c', id: url }
    }
    await crawlAccount('FID', { count: 3 }, {
      listFn: async () => refs(['a', 'b', 'c']),
      mpFetch: (async () => ({})) as never, token: 'T', downloadOne, sleep: noSleep,
      onListed: (r) => listedCalls.push(r.map((x) => x.url)),
      onItem: (e) => events.push(e),
    })
    expect(listedCalls).toEqual([['a', 'b', 'c']])
    expect(events).toEqual([
      { index: 0, status: 'downloading' }, { index: 0, status: 'ok' },
      { index: 1, status: 'downloading' }, { index: 1, status: 'failed', error: 'x' },
      { index: 2, status: 'downloading' }, { index: 2, status: 'skipped' },
    ])
  })

  it('stops remaining items when shouldContinue is false', async () => {
    const seen: string[] = []
    let n = 0
    const out = await crawlAccount('FID', { count: 3 }, {
      listFn: async () => refs(['a', 'b', 'c']),
      mpFetch: (async () => ({})) as never, token: 'T', sleep: noSleep,
      downloadOne: async (url) => { seen.push(url); return { url, ok: true, id: url } },
      shouldContinue: () => { n++; return n <= 1 },
    })
    expect(seen).toEqual(['a'])
    expect(out.succeeded).toBe(1)
    // 取消后未下载的 b、c 仍登记进 items（标记 cancelled），供历史列出 + 单篇补下。
    expect(out.items).toHaveLength(3)
    expect(out.items.slice(1)).toEqual([
      { url: 'b', ok: false, title: 'b', cancelled: true },
      { url: 'c', ok: false, title: 'c', cancelled: true },
    ])
    expect(out.items.filter((i) => i.cancelled)).toHaveLength(2)
  })
})

describe('filterRefsByTitle (M24 · issue #1 关键词过滤)', () => {
  const mk = (titles: string[]): ArticleRef[] => titles.map((t, i) => ({ url: `u${i}`, title: t, createTime: i }))

  it('include keeps only titles containing any keyword', () => {
    const out = filterRefsByTitle(mk(['AI 周报', '生活随笔', '谈 AI 落地']), { include: ['AI'] })
    expect(out.map((r) => r.title)).toEqual(['AI 周报', '谈 AI 落地'])
  })

  it('exclude drops titles containing any keyword', () => {
    const out = filterRefsByTitle(mk(['AI 周报', '广告合作', '随笔']), { exclude: ['广告'] })
    expect(out.map((r) => r.title)).toEqual(['AI 周报', '随笔'])
  })

  it('include then exclude — exclude wins on conflict', () => {
    const out = filterRefsByTitle(mk(['AI 周报', 'AI 广告专场', '随笔']), { include: ['AI'], exclude: ['广告'] })
    expect(out.map((r) => r.title)).toEqual(['AI 周报'])
  })

  it('matching is case-insensitive', () => {
    const out = filterRefsByTitle(mk(['openai 观察', 'OpenAI 发布会', '其他']), { include: ['OpenAI'] })
    expect(out).toHaveLength(2)
  })

  it('blank/empty keywords are ignored; empty filter keeps all', () => {
    const all = mk(['a', 'b'])
    expect(filterRefsByTitle(all, { include: ['', '  '], exclude: ['   '] })).toEqual(all)
    expect(filterRefsByTitle(all, {})).toEqual(all)
    expect(filterRefsByTitle(all, undefined)).toEqual(all)
  })
})

describe('crawlAccount with keywords', () => {
  it('filters before onListed/download and reports filteredOut', async () => {
    const listed: ArticleRef[][] = []
    const order: string[] = []
    const downloadOne = async (url: string): Promise<DownloadItemResult> => { order.push(url); return { url, ok: true, id: url } }
    const out = await crawlAccount('FID', { count: 4 }, {
      listFn: async () => [
        { url: 'a', title: 'AI 周报', createTime: 1 },
        { url: 'b', title: '广告', createTime: 2 },
        { url: 'c', title: '谈 AI', createTime: 3 },
        { url: 'd', title: '随笔', createTime: 4 },
      ],
      keywords: { include: ['AI'] },
      onListed: (r) => { listed.push(r) },
      mpFetch: (async () => ({})) as never, token: 'T', downloadOne, sleep: noSleep,
    })
    expect(listed[0].map((r) => r.url)).toEqual(['a', 'c'])   // UI 铺行即过滤后列表
    expect(order).toEqual(['a', 'c'])
    expect(out).toMatchObject({ listed: 2, total: 2, succeeded: 2, filteredOut: 2 })
  })

  it('no keywords → summary carries no filteredOut field', async () => {
    const out = await crawlAccount('FID', { count: 1 }, {
      listFn: async () => refs(['a']),
      mpFetch: (async () => ({})) as never, token: 'T',
      downloadOne: async (url) => ({ url, ok: true, id: url }), sleep: noSleep,
    })
    expect(out).not.toHaveProperty('filteredOut')
  })
})

describe('文章主键透传给下载(M36)', () => {
  it('downloadOne 收到列表给的 appmsgid/itemidx —— 否则短链判不了重', async () => {
    const seen: Array<{ url: string; hint?: unknown }> = []
    const refs = [
      { url: 'https://mp.weixin.qq.com/s/AAA', title: 'a', createTime: 2, appmsgid: 100, itemidx: 1 },
      { url: 'https://mp.weixin.qq.com/s/BBB', title: 'b', createTime: 1, appmsgid: 101, itemidx: 2 },
    ]
    await crawlAccount('FID', { count: 2 }, {
      mpFetch: (async () => ({})) as never, token: 'T',
      downloadOne: async (url: string, hint?: unknown) => { seen.push({ url, hint }); return { url, ok: true } },
      listFn: async () => refs,
      sleep: async () => {},
    } as never)
    // hint 只含主键，不该夹带 title/createTime 之类
    expect(seen.map((s) => s.hint)).toEqual([
      { appmsgid: 100, itemidx: 1 },
      { appmsgid: 101, itemidx: 2 },
    ])
  })
})

describe('不可访问文章的上报(M38)', () => {
  const refsOf = (n: number) => Array.from({ length: n }, (_, i) => ({
    url: `u${i}`, title: `t${i}`, createTime: 1000 - i, appmsgid: 100 + i, itemidx: 1,
  }))
  const run = async (range: never, listed: number, hidden: number) => crawlAccount('FID', range, {
    mpFetch: (async () => ({})) as never, token: 'T',
    downloadOne: async (url: string) => ({ url, ok: true }),
    listFn: async (_f: never, _t: never, _id: never, _r: never, opts?: { onHidden?: (n: number) => void }) => {
      opts?.onHidden?.(hidden)
      return refsOf(listed)
    },
    sleep: async () => {},
  } as never)

  it('count 补齐成功 → 不算不及预期(渲染层据此保持沉默)', async () => {
    const s = await run({ count: 3 } as never, 3, 2)
    expect(s.unavailable).toBe(2)        // 数据层仍带着,agent 可读
    expect(s.shortfall).toBe(false)      // 但「无需解释」
  })

  it('count 补不齐 → 算不及预期(必须说明少在哪)', async () => {
    const s = await run({ count: 5 } as never, 2, 3)
    expect(s).toMatchObject({ unavailable: 3, shortfall: true })
  })

  it('日期范围模式:窗口内少了就算不及预期(没有补齐一说)', async () => {
    const s = await run({ from: '2026-01-01', to: '2026-12-31' } as never, 4, 1)
    expect(s).toMatchObject({ unavailable: 1, shortfall: true })
  })

  it('没有不可访问的文章 → 字段整个缺省,不给下游添噪', async () => {
    const s = await run({ count: 2 } as never, 2, 0)
    expect(s.unavailable).toBeUndefined()
    expect(s.shortfall).toBeUndefined()
  })
})

describe('两类失败在汇总里分开(M38)', () => {
  it('下载阶段发现的不可见与列表阶段过滤的合并,failed 只留真故障', async () => {
    const refs = [0, 1, 2].map((i) => ({ url: `u${i}`, title: `t${i}`, createTime: 100 - i }))
    const s = await crawlAccount('FID', { count: 3 } as never, {
      mpFetch: (async () => ({})) as never, token: 'T',
      downloadOne: async (url: string) => {
        if (url === 'u1') throw new ArticleUnavailableError('读者不可见')
        if (url === 'u2') throw new Error('socket hang up')
        return { url, ok: true }
      },
      listFn: async (_f: never, _t: never, _i: never, _r: never, opts?: { onHidden?: (n: number) => void }) => {
        opts?.onHidden?.(1)      // 列表阶段还滤掉了 1 篇
        return refs
      },
      sleep: async () => {},
    } as never)
    expect(s.unavailable).toBe(2)     // 列表 1 + 下载时发现 1
    expect(s.realFailures).toBe(1)    // 只有 socket hang up 才是真故障
    expect(s.shortfall).toBe(true)    // 要 3 篇只拿到 1 篇
  })
})

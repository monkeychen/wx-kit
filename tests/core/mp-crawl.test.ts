// tests/core/mp-crawl.test.ts
import { describe, it, expect, vi } from 'vitest'
import { crawlAccount } from '../../src/core/mp-crawl'
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
  })
})

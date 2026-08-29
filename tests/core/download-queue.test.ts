// tests/core/download-queue.test.ts
import { describe, it, expect } from 'vitest'
import { DownloadQueue, type DownloadOne } from '../../src/core/download-queue'
import { ArticleUnavailableError } from '../../src/core/download-article'
import type { ProgressEvent } from '../../src/core/types'

describe('DownloadQueue', () => {
  it('processes urls serially in order and reports progress', async () => {
    const order: string[] = []
    const events: ProgressEvent[] = []
    const downloadOne: DownloadOne = async (url) => {
      order.push(url)
      return { url, ok: true, id: url, dir: `/d/${url}`, formats: ['md'] }
    }
    const q = new DownloadQueue(downloadOne, e => events.push(e))
    const summary = await q.run(['a', 'b', 'c'])

    expect(order).toEqual(['a', 'b', 'c'])
    expect(summary).toMatchObject({ total: 3, succeeded: 3, failed: 0, skipped: 0, ok: true })
    expect(events.some(e => e.phase === 'done' && e.completed === 3)).toBe(true)
  })

  it('isolates failures without stopping the queue', async () => {
    const downloadOne: DownloadOne = async (url) => {
      if (url === 'bad') throw new Error('boom')
      return { url, ok: true, id: url }
    }
    const q = new DownloadQueue(downloadOne, () => {})
    const summary = await q.run(['ok1', 'bad', 'ok2'])

    expect(summary).toMatchObject({ total: 3, succeeded: 2, failed: 1, ok: false })
    const bad = summary.items.find(i => i.url === 'bad')!
    expect(bad.ok).toBe(false)
    expect(bad.error?.message).toContain('boom')
  })

  it('stops before unsent items after a global protection signal and preserves its code', async () => {
    const seen: string[] = []
    const q = new DownloadQueue(async (url) => {
      seen.push(url)
      if (url === 'limited') throw Object.assign(new Error('微信频控'), { code: 'RATE_LIMITED' })
      return { url, ok: true }
    })
    const summary = await q.run(['ok', 'limited', 'never-send'])
    expect(seen).toEqual(['ok', 'limited'])
    expect(summary.items[1]).toMatchObject({ error: { code: 'RATE_LIMITED' } })
    expect(summary.items).toHaveLength(2)
  })

  it('counts skipped (dedup) items as ok', async () => {
    const downloadOne: DownloadOne = async (url) => ({ url, ok: true, skipped: url === 'dup', id: url })
    const q = new DownloadQueue(downloadOne, () => {})
    const summary = await q.run(['new', 'dup'])
    expect(summary).toMatchObject({ succeeded: 1, skipped: 1, failed: 0, ok: true })
  })

  it('emits failed phase for failures and save for successes', async () => {
    const events: ProgressEvent[] = []
    const downloadOne: DownloadOne = async (url) => {
      if (url === 'bad') throw new Error('x')
      return { url, ok: true, id: url }
    }
    const q = new DownloadQueue(downloadOne, e => events.push(e))
    await q.run(['ok1', 'bad'])
    expect(events.some(e => e.currentUrl === 'bad' && e.phase === 'failed')).toBe(true)
    expect(events.some(e => e.currentUrl === 'ok1' && e.phase === 'save')).toBe(true)
  })

  it('forwards an article sub-stage before the item completes', async () => {
    const events: ProgressEvent[] = []
    const q = new DownloadQueue(async (url, _hint, report) => {
      report?.({ phase: 'images', message: '下载图片 1/2' })
      return { url, ok: true }
    }, (event) => events.push(event))
    await q.run(['article'])
    expect(events).toContainEqual(expect.objectContaining({ phase: 'images', message: '下载图片 1/2', completed: 0 }))
  })

  it('handles empty url list', async () => {
    const q = new DownloadQueue(async (u) => ({ url: u, ok: true }), () => {})
    expect(await q.run([])).toMatchObject({ ok: true, total: 0, succeeded: 0, failed: 0, skipped: 0 })
  })
})

describe('DownloadQueue cancel', () => {
  it('stops before the next item when shouldContinue returns false', async () => {
    const seen: string[] = []
    const q = new DownloadQueue(async (u) => { seen.push(u); return { url: u, ok: true, id: u } })
    let calls = 0
    const summary = await q.run(['a', 'b', 'c'], () => { calls++; return calls <= 1 })
    expect(seen).toEqual(['a'])
    expect(summary.items).toHaveLength(1)
    expect(summary.total).toBe(3)
  })
})

describe('队列条目可带文章主键(M36)', () => {
  // 短链认不出与长链是同一篇,判重要靠列表给的 appmsgid/itemidx —— 队列必须把它透传下去
  it('传对象形态时,hint 透传给 downloadOne', async () => {
    const seen: Array<{ url: string; hint?: unknown }> = []
    const q = new DownloadQueue(async (url, hint) => {
      seen.push({ url, hint })
      return { url, ok: true }
    })
    await q.run([
      { url: 'https://mp.weixin.qq.com/s/AAA', appmsgid: 100, itemidx: 1 },
      { url: 'https://mp.weixin.qq.com/s/BBB', appmsgid: 101, itemidx: 2 },
    ])
    expect(seen).toEqual([
      { url: 'https://mp.weixin.qq.com/s/AAA', hint: { appmsgid: 100, itemidx: 1 } },
      { url: 'https://mp.weixin.qq.com/s/BBB', hint: { appmsgid: 101, itemidx: 2 } },
    ])
  })

  it('传字符串数组仍然可用(向后兼容,老调用方不必改)', async () => {
    const seen: unknown[] = []
    const q = new DownloadQueue(async (url, hint) => { seen.push(hint); return { url, ok: true } })
    const s = await q.run(['a', 'b'])
    expect(s.succeeded).toBe(2)
    expect(seen).toEqual([{}, {}])   // 没有主键就是空 hint,不是 undefined 混着 object
  })

  it('字符串与对象混用不报错', async () => {
    const q = new DownloadQueue(async (url) => ({ url, ok: true }))
    const s = await q.run(['a', { url: 'b', appmsgid: 1, itemidx: 1 }])
    expect(s).toMatchObject({ ok: true, total: 2, succeeded: 2 })
  })

  it('带主键的条目失败时,错误里仍带正确的 url', async () => {
    const q = new DownloadQueue(async () => { throw new Error('boom') })
    const s = await q.run([{ url: 'https://x/AAA', appmsgid: 1, itemidx: 1 }])
    expect(s.items[0]).toMatchObject({ url: 'https://x/AAA', ok: false })
  })
})

describe('读者打不开 ≠ 下载失败(M38)', () => {
  it('ArticleUnavailableError 单独计数,错误码也不同', async () => {
    const q = new DownloadQueue(async (url) => {
      if (url === 'gone') throw new ArticleUnavailableError('该文章审核未通过，读者不可见（无法下载）')
      if (url === 'broken') throw new Error('socket hang up')
      return { url, ok: true }
    })
    const s = await q.run(['ok1', 'gone', 'broken'])
    expect(s).toMatchObject({ succeeded: 1, failed: 2, unavailable: 1 })
    expect(s.items[1]).toMatchObject({ ok: false, unavailable: true, error: { code: 'ARTICLE_UNAVAILABLE' } })
    // 真故障保持原样,不被误标
    expect(s.items[2]).toMatchObject({ ok: false, error: { code: 'DOWNLOAD_FAILED' } })
    expect(s.items[2].unavailable).toBeUndefined()
  })

  it('没有不可见文章时不带该字段(不给下游添噪)', async () => {
    const q = new DownloadQueue(async (url) => ({ url, ok: true }))
    expect((await q.run(['a'])).unavailable).toBeUndefined()
  })
})

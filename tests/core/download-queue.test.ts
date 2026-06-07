// tests/core/download-queue.test.ts
import { describe, it, expect } from 'vitest'
import { DownloadQueue, type DownloadOne } from '../../src/core/download-queue'
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

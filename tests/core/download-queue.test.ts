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
})

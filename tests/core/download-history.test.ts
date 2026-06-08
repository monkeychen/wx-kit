// tests/core/download-history.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  History, pruneEvents, eventFromSummary, DEFAULT_RETENTION_DAYS,
  type HistoryEvent,
} from '../../src/core/download-history'
import type { DownloadSummary } from '../../src/core/types'

const DAY = 86_400_000
const ev = (id: string, time: number): HistoryEvent => ({
  id, time, source: { kind: 'url', count: 1 }, formats: ['md'],
  total: 1, succeeded: 1, skipped: 0, failed: 0,
  items: [{ id: 'a', url: 'u', title: 't', status: 'ok', formats: ['md'] }],
})

describe('pruneEvents', () => {
  const now = 1_000 * DAY
  it('drops events older than retention and sorts newest-first', () => {
    const out = pruneEvents([ev('old', now - 400 * DAY), ev('a', now - 1 * DAY), ev('b', now - 3 * DAY)], now, 365)
    expect(out.map((e) => e.id)).toEqual(['a', 'b'])
  })
})

describe('eventFromSummary', () => {
  it('maps statuses (ok/skipped/failed) and falls back title to url', () => {
    const s: DownloadSummary = {
      ok: false, total: 3, succeeded: 1, skipped: 1, failed: 1,
      items: [
        { url: 'u1', ok: true, id: 'i1', title: '标题1', formats: ['md'] },
        { url: 'u2', ok: true, id: 'i2', skipped: true, title: '标题2' },
        { url: 'u3', ok: false, error: { code: 'X', message: '登录已过期' } },
      ],
    }
    const e = eventFromSummary('e1', 123, { kind: 'url', count: 3 }, ['md'], s)
    expect(e.items.map((i) => i.status)).toEqual(['ok', 'skipped', 'failed'])
    expect(e.items[2].title).toBe('u3')          // 失败无 title → 回退 url
    expect(e.items[2].error).toBe('登录已过期')
    expect(e).toMatchObject({ total: 3, succeeded: 1, skipped: 1, failed: 1 })
  })
})

describe('History (file)', () => {
  let root: string
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'wxk-hist-')) })

  it('missing file → empty list', async () => {
    expect((await new History(root).list()).events).toEqual([])
  })

  it('append prepends and list paginates newest-first', async () => {
    const h = new History(root)
    await h.append(ev('a', 100), 1000)
    await h.append(ev('b', 200), 1000)
    await h.append(ev('c', 300), 1000)
    const page1 = await h.list(0, 2, 1000)
    expect(page1.total).toBe(3)
    expect(page1.events.map((e) => e.id)).toEqual(['c', 'b'])
    const page2 = await h.list(2, 2, 1000)
    expect(page2.events.map((e) => e.id)).toEqual(['a'])
  })

  it('append prunes expired by retention', async () => {
    const now = 1000 * DAY
    const h = new History(root, 30)
    await h.append(ev('old', now - 100 * DAY), now)
    await h.append(ev('new', now - 1 * DAY), now)
    const r = await h.list(0, 10, now)
    expect(r.events.map((e) => e.id)).toEqual(['new'])
  })

  it('removeEvent drops one record by id, keeps the rest', async () => {
    const h = new History(root)
    await h.append(ev('a', 100), 1000)
    await h.append(ev('b', 200), 1000)
    await h.removeEvent('a')
    const r = await h.list(0, 10, 1000)
    expect(r.total).toBe(1)
    expect(r.events.map((e) => e.id)).toEqual(['b'])
  })

  it('clear empties records', async () => {
    const h = new History(root)
    await h.append(ev('a', 100), 1000)
    await h.clear()
    expect((await h.list()).total).toBe(0)
  })

  it('markDeleted flags items referencing the id but keeps the record', async () => {
    const h = new History(root)
    await h.append(ev('e', 100), 1000)
    await h.markDeleted('a')
    const item = (await h.list(0, 10, 1000)).events[0].items[0]
    expect(item.deleted).toBe(true)
    expect(item.id).toBeUndefined()
  })

  it('DEFAULT_RETENTION_DAYS is 365', () => {
    expect(DEFAULT_RETENTION_DAYS).toBe(365)
  })
})

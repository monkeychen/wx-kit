import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Subscriptions, accountsFromHistory, mergeAccounts } from '../../src/core/subscriptions'
import type { HistoryEvent } from '../../src/core/download-history'

describe('Subscriptions store', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'wxk-subs-')) })

  it('empty when no file', async () => {
    const s = new Subscriptions(dir)
    expect(await s.list()).toEqual([])
    expect(await s.getLastRunAt()).toBeNull()
  })

  it('addAccount adds, and re-add updates identity but keeps newRefs', async () => {
    const s = new Subscriptions(dir)
    await s.addAccount({ fakeid: 'f1', nickname: '甲', subscribed: true, watermark: 100 })
    await s.setNewRefs('f1', [{ url: 'u', title: 't', createTime: 200 }])
    await s.addAccount({ fakeid: 'f1', nickname: '甲改名', subscribed: true, watermark: 150 })
    const [a] = await s.list()
    expect(a).toMatchObject({ fakeid: 'f1', nickname: '甲改名', subscribed: true, watermark: 150 })
    expect(a.newRefs).toHaveLength(1)   // 重加不抹掉已发现的新文章
  })

  it('setSubscribed / updateWatermark / setNewRefs / clearNewRefs', async () => {
    const s = new Subscriptions(dir)
    await s.addAccount({ fakeid: 'f1', nickname: '甲', subscribed: false, watermark: 0 })
    await s.setSubscribed('f1', true)
    await s.updateWatermark('f1', 300)
    await s.setNewRefs('f1', [{ url: 'u', title: 't', createTime: 400 }])
    let [a] = await s.list()
    expect(a).toMatchObject({ subscribed: true, watermark: 300 })
    expect(a.newRefs).toHaveLength(1)
    await s.clearNewRefs('f1')
    ;[a] = await s.list()
    expect(a.newRefs).toEqual([])
  })

  it('persists lastRunAt across instances', async () => {
    const s = new Subscriptions(dir)
    await s.setLastRunAt(1234)
    expect(await new Subscriptions(dir).getLastRunAt()).toBe(1234)
  })
})

describe('accountsFromHistory', () => {
  it('extracts distinct account-kind {fakeid,nickname}, latest nickname wins', () => {
    const evs = [
      { source: { kind: 'account', fakeid: 'f1', nickname: '甲', range: { count: 1 } } },
      { source: { kind: 'url', count: 2 } },
      { source: { kind: 'account', fakeid: 'f1', nickname: '甲新', range: { count: 1 } } },
      { source: { kind: 'account', fakeid: 'f2', nickname: '乙', range: { count: 1 } } },
    ] as unknown as HistoryEvent[]
    expect(accountsFromHistory(evs)).toEqual([{ fakeid: 'f1', nickname: '甲新' }, { fakeid: 'f2', nickname: '乙' }])
  })
})

describe('mergeAccounts', () => {
  it('stored wins; history-only appear unsubscribed with empty state', () => {
    const stored = [{ fakeid: 'f1', nickname: '甲', subscribed: true, watermark: 100, lastCheckedAt: 9, newRefs: [] }]
    const merged = mergeAccounts([{ fakeid: 'f1', nickname: 'X' }, { fakeid: 'f2', nickname: '乙' }], stored)
    expect(merged.find((a) => a.fakeid === 'f1')).toMatchObject({ nickname: '甲', subscribed: true, watermark: 100 })
    expect(merged.find((a) => a.fakeid === 'f2')).toMatchObject({ nickname: '乙', subscribed: false, watermark: 0, lastCheckedAt: null, newRefs: [] })
  })
})

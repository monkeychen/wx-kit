// tests/core/subscriptions.test.ts
// 订阅核心纯函数与存储：双形态 fakeid 归一去重（2026-08-28 用户实测同名重复行）、删除标记。
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Subscriptions, mergeAccounts, accountsFromHistory, normalizeAccountKey, type SubscribedAccount } from '../../src/core/subscriptions'
import type { HistoryEvent } from '../../src/core/download-history'

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'wxkit-subs-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

describe('normalizeAccountKey', () => {
  it('base64 老形态 → MP_WXS_ 新形态；已是新形态原样', () => {
    expect(normalizeAccountKey('MzE5ODk2NjUwOA==')).toBe('MP_WXS_3198966508')
    expect(normalizeAccountKey('MP_WXS_3198966508')).toBe('MP_WXS_3198966508')
    expect(normalizeAccountKey('3198966508')).toBe('MP_WXS_3198966508')
  })
  it('非法形态原样返回（不让脏数据炸列表）', () => {
    expect(normalizeAccountKey('not-valid!!')).toBe('not-valid!!')
  })
})

describe('双形态去重', () => {
  const acc = (fakeid: string, over: Partial<SubscribedAccount> = {}): SubscribedAccount => ({
    fakeid, nickname: '猫笔刀', subscribed: true, watermark: 100, lastCheckedAt: null, newRefs: [], ...over,
  })
  it('mergeAccounts：base64 与 MP_WXS_ 视为同一号', () => {
    const merged = mergeAccounts(
      [{ fakeid: 'MzE5ODk2NjUwOA==', nickname: '猫笔刀' }],
      [acc('MP_WXS_3198966508')],
    )
    expect(merged).toHaveLength(1)
    expect(merged[0].fakeid).toBe('MP_WXS_3198966508')
  })
  it('accountsFromHistory 归一 fakeid', () => {
    const ev = { id: 'e1', time: 0, source: { kind: 'account', fakeid: 'MzE5ODk2NjUwOA==', nickname: '猫笔刀', range: { count: 1 } }, formats: ['md'], items: [] } as unknown as HistoryEvent
    expect(accountsFromHistory([ev])).toEqual([{ fakeid: 'MP_WXS_3198966508', nickname: '猫笔刀' }])
  })
})

describe('Subscriptions.removeAccount（删除标记持久化）', () => {
  it('remove 后 list 不含该号；addAccount 重新订阅可撤销标记', async () => {
    const subs = new Subscriptions(dir)
    await subs.addAccount({ fakeid: 'MzE5ODk2NjUwOA==', nickname: '猫笔刀', subscribed: true, watermark: 5 })
    expect((await subs.list()).map((a) => a.fakeid)).toEqual(['MP_WXS_3198966508'])
    await subs.removeAccount('MP_WXS_3198966508')
    expect(await subs.list()).toEqual([])
    expect(await subs.removedFakeids()).toEqual(['MP_WXS_3198966508'])
    await subs.addAccount({ fakeid: 'MP_WXS_3198966508', nickname: '猫笔刀', subscribed: true, watermark: 9 })
    expect((await subs.list()).map((a) => a.fakeid)).toEqual(['MP_WXS_3198966508'])
    expect(await subs.removedFakeids()).toEqual([])
  })
  it('删除标记按归一 id 生效（老形态存档也能删掉新形态行）', async () => {
    const subs = new Subscriptions(dir)
    await subs.addAccount({ fakeid: 'MP_WXS_3198966508', nickname: '猫笔刀', subscribed: true, watermark: 5 })
    await subs.removeAccount('MzE5ODk2NjUwOA==')
    expect(await subs.list()).toEqual([])
  })
  it('list 读入时合并历史双形态重复：水位取 max、newRefs 合并', async () => {
    const p = join(dir, 'subscriptions.json')
    await writeFile(p, JSON.stringify({
      version: 1, lastRunAt: null,
      accounts: [
        { fakeid: 'MzE5ODk2NjUwOA==', nickname: '', subscribed: false, watermark: 50, lastCheckedAt: 10, newRefs: [] },
        { fakeid: 'MP_WXS_3198966508', nickname: '猫笔刀', subscribed: true, watermark: 80, lastCheckedAt: 20, newRefs: [{ url: 'https://mp.weixin.qq.com/s/x', title: 'x', createTime: 1 }] },
      ],
      checkLog: [],
    }), 'utf-8')
    const rows = await new Subscriptions(dir).list()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ fakeid: 'MP_WXS_3198966508', nickname: '猫笔刀', subscribed: true, watermark: 80, lastCheckedAt: 20 })
    expect(rows[0].newRefs).toHaveLength(1)
  })
  it('mergeAccounts 过滤被显式删除的历史派生行', () => {
    const merged = mergeAccounts(
      [{ fakeid: 'MP_WXS_3198966508', nickname: '猫笔刀' }],
      [], ['MP_WXS_3198966508'],
    )
    expect(merged).toEqual([])
  })
})

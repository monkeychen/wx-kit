// tests/core/subscriptions.test.ts
// 订阅核心纯函数与存储：双形态 fakeid 归一去重（2026-08-28 用户实测同名重复行）、删除标记。
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Subscriptions, mergeAccounts, accountsFromHistory, normalizeAccountKey, initialWatermark, formatCheckLogLine, toDownloadItemLogs, type SubscribedAccount, type CheckLogEntry } from '../../src/core/subscriptions'
import type { HistoryEvent } from '../../src/core/download-history'
import type { DownloadItemResult } from '../../src/core/types'

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

describe('initialWatermark（新订阅首检可见最新一篇）', () => {
  it('有最新一篇：水位 = createTime - 1，严格 > 比较能放行最新一篇', () => {
    expect(initialWatermark(1787878950, 100)).toBe(1787878949)
    // 检查侧语义：最新一篇(1787878950) > 水位(1787878949) → 被投递；更早的(1787792518)被滤掉
    const watermark = initialWatermark(1787878950, 100)
    expect(1787878950 > watermark).toBe(true)
    expect(1787792518 > watermark).toBe(false)
  })
  it('取不到最新一篇（null/undefined）：用「现在」，不回灌存量', () => {
    expect(initialWatermark(null, 1787910912)).toBe(1787910912)
    expect(initialWatermark(undefined, 1787910912)).toBe(1787910912)
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
        { fakeid: 'MP_WXS_3198966508', nickname: '猫笔刀', subscribed: true, watermark: 80, latestArticleId: 'review-1', lastCheckedAt: 20, newRefs: [{ url: 'https://mp.weixin.qq.com/s/x', title: 'x', createTime: 1 }] },
      ],
      checkLog: [],
    }), 'utf-8')
    const rows = await new Subscriptions(dir).list()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ fakeid: 'MP_WXS_3198966508', nickname: '猫笔刀', subscribed: true, watermark: 80, latestArticleId: 'review-1', lastCheckedAt: 20 })
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

// ---- M56：订阅自动下载结果可感知（数据层） ----

describe('toDownloadItemLogs（四状态映射）', () => {
  const refs = [
    { url: 'https://mp.weixin.qq.com/s/a', title: '文章A' },
    { url: 'https://mp.weixin.qq.com/s/b', title: '文章B' },
  ]
  const item = (over: Partial<DownloadItemResult>): DownloadItemResult =>
    ({ url: 'https://mp.weixin.qq.com/s/a', ok: true, ...over })
  it("ok && !skipped → 'downloaded'", () => {
    expect(toDownloadItemLogs([item({ title: '文章A' })], refs))
      .toEqual([{ title: '文章A', status: 'downloaded' }])
  })
  it("ok && skipped → 'exists'（不把「文库已有」伪装成「刚下载」）", () => {
    expect(toDownloadItemLogs([item({ skipped: true, title: '文章A' })], refs))
      .toEqual([{ title: '文章A', status: 'exists' }])
  })
  it("!ok && unavailable → 'unavailable'", () => {
    expect(toDownloadItemLogs([item({ ok: false, unavailable: true, title: '文章A' })], refs))
      .toEqual([{ title: '文章A', status: 'unavailable' }])
  })
  it("其余 → 'failed' 且 error 透传 error.message", () => {
    expect(toDownloadItemLogs([item({ ok: false, title: '文章A', error: { code: 'E_PARSE', message: 'parse failed' } })], refs))
      .toEqual([{ title: '文章A', status: 'failed', error: 'parse failed' }])
  })
  it('失败项标题缺省时按 url 从 refs 补全（列表本来就给标题）', () => {
    expect(toDownloadItemLogs([item({ ok: false })], refs))
      .toEqual([{ title: '文章A', status: 'failed' }])
  })
  it('cancelled 不产出日志条目（未尝试下载，没有下载动作）', () => {
    expect(toDownloadItemLogs([item({ ok: false, cancelled: true }), item({ url: 'https://mp.weixin.qq.com/s/b', title: '文章B' })], refs))
      .toEqual([{ title: '文章B', status: 'downloaded' }])
  })
  it('item.title 优先于 refs；两者都无则空串', () => {
    expect(toDownloadItemLogs([item({ title: '以条目为准' })], refs))
      .toEqual([{ title: '以条目为准', status: 'downloaded' }])
    expect(toDownloadItemLogs([item({ ok: false, url: 'https://mp.weixin.qq.com/s/unknown' })], refs))
      .toEqual([{ title: '', status: 'failed' }])
  })
})

describe('formatCheckLogLine（M56 扩展）', () => {
  it('旧格式条目输出与改动前逐字节一致（锁住原样例）', () => {
    const full: CheckLogEntry = {
      time: 1786000000000, trigger: 'auto', accounts: 3, newFound: 5, failed: 1,
      note: 'no-session', failures: [{ nickname: '猫笔刀', error: 'list blocked' }],
    }
    expect(formatCheckLogLine(full))
      .toBe('[2026-08-06T07:06:40.000Z] AUTO accounts=3 new=5 failed=1 note=no-session [猫笔刀: list blocked]')
    const bare: CheckLogEntry = { time: 1786000000000, trigger: 'manual', accounts: 1, newFound: 0, failed: 0 }
    expect(formatCheckLogLine(bare)).toBe('[2026-08-06T07:06:40.000Z] MANUAL accounts=1 new=0 failed=0')
  })
  it('新条目追加 downloaded=N existed=N；downloadDetail 不进单行', () => {
    const e: CheckLogEntry = {
      time: 1786000000000, trigger: 'auto', accounts: 3, newFound: 5, failed: 0,
      downloaded: 2, existed: 1,
      downloadDetail: [{ fakeid: 'MP_WXS_3198966508', nickname: '猫笔刀', items: [{ title: '文章A', status: 'downloaded' }] }],
    }
    expect(formatCheckLogLine(e))
      .toBe('[2026-08-06T07:06:40.000Z] AUTO accounts=3 new=5 failed=0 downloaded=2 existed=1')
  })
  it('downloaded/existed 仅在非 undefined 时各自追加', () => {
    const e: CheckLogEntry = { time: 1786000000000, trigger: 'manual', accounts: 1, newFound: 0, failed: 0, downloaded: 3 }
    expect(formatCheckLogLine(e)).toBe('[2026-08-06T07:06:40.000Z] MANUAL accounts=1 new=0 failed=0 downloaded=3')
  })
  it("kind:'download' → DOWNLOAD 标签；缺省或 'check' 保持 AUTO/MANUAL", () => {
    const base = { time: 1786000000000, accounts: 1, newFound: 0, failed: 0 }
    expect(formatCheckLogLine({ ...base, trigger: 'auto', kind: 'download', downloaded: 1 }))
      .toBe('[2026-08-06T07:06:40.000Z] DOWNLOAD accounts=1 new=0 failed=0 downloaded=1')
    expect(formatCheckLogLine({ ...base, trigger: 'auto', kind: 'check' }))
      .toBe('[2026-08-06T07:06:40.000Z] AUTO accounts=1 new=0 failed=0')
    expect(formatCheckLogLine({ ...base, trigger: 'manual' }))
      .toBe('[2026-08-06T07:06:40.000Z] MANUAL accounts=1 new=0 failed=0')
  })
})

// tests/renderer/subscription-view.test.ts
// M56 T3：行内摘要的 checkLog 派生与话术纯函数。
import { describe, it, expect } from 'vitest'
import {
  latestResultByAccount, latestItemsForAccount, summaryPhrase, triggerLabel, formatShortTime,
  itemStatusTag, detailModalTitle,
} from '../../src/renderer/subscription-view'
import type { CheckLogEntry, DownloadItemLog } from '../../src/core/subscriptions'

const entry = (over: Partial<CheckLogEntry>): CheckLogEntry => ({
  time: 0, trigger: 'manual', accounts: 1, newFound: 0, failed: 0, ...over,
})
const items = (...sts: DownloadItemLog['status'][]): DownloadItemLog[] =>
  sts.map((status) => ({ title: `t-${status}`, status }))

describe('latestResultByAccount', () => {
  it('每个 fakeid 取 time 最近的含该号的 downloadDetail 条目', () => {
    const old = entry({ time: 100, downloadDetail: [{ fakeid: 'A', nickname: '甲', items: items('downloaded') }] })
    const newer = entry({
      time: 200, trigger: 'auto',
      downloadDetail: [
        { fakeid: 'A', nickname: '甲', items: items('downloaded', 'exists') },
        { fakeid: 'B', nickname: '乙', items: items('failed') },
      ],
    })
    const map = latestResultByAccount([newer, old]) // 落盘顺序：新条目在前
    expect(map.get('A')?.entry.time).toBe(200)
    expect(map.get('A')?.detail.items).toHaveLength(2)
    expect(map.get('B')?.entry.time).toBe(200)
  })
  it('输入乱序仍按 time 取最近，不依赖数组顺序', () => {
    const old = entry({ time: 100, downloadDetail: [{ fakeid: 'A', nickname: '甲', items: items('exists') }] })
    const newer = entry({ time: 200, downloadDetail: [{ fakeid: 'A', nickname: '甲', items: items('downloaded') }] })
    expect(latestResultByAccount([old, newer]).get('A')?.entry.time).toBe(200)
  })
  it('老记录（无 downloadDetail）不产生归属；空输入返回空 map', () => {
    expect(latestResultByAccount([]).size).toBe(0)
    const legacy = entry({ time: 300, newFound: 5, failures: [{ nickname: '甲', error: '频控' }] })
    expect(latestResultByAccount([legacy]).size).toBe(0)
  })
  it('kind=download（补下载）记录同样按 fakeid 归属', () => {
    const e = entry({
      time: 400, kind: 'download', downloaded: 2, existed: 1,
      downloadDetail: [{ fakeid: 'C', nickname: '丙', items: items('downloaded', 'downloaded', 'exists') }],
    })
    const map = latestResultByAccount([e])
    expect(map.get('C')?.entry.kind).toBe('download')
    expect(map.get('C')?.detail.items).toHaveLength(3)
  })
})

describe('summaryPhrase', () => {
  it('downloaded>0 → 发现 N 篇，已下载 M 篇（并存 exists 时也不展开第三句）', () => {
    expect(summaryPhrase(items('downloaded', 'downloaded', 'exists'))).toBe('发现 3 篇，已下载 2 篇')
  })
  it('existed>0 且 downloaded=0 → 发现 N 篇，M 篇文库已有', () => {
    expect(summaryPhrase(items('exists', 'exists', 'failed'))).toBe('发现 3 篇，2 篇文库已有')
  })
  it('无交付（全 failed/unavailable 或空）→ 只说发现 N 篇', () => {
    expect(summaryPhrase(items('failed', 'unavailable'))).toBe('发现 2 篇')
    expect(summaryPhrase([])).toBe('发现 0 篇')
  })
  // kind='download'（补下载）：纯交付动作，newFound 恒 0——话术不得出现「发现」（PRD §4 发现与交付可区分）
  it("kind='download' downloaded>0 → 纯交付话术「已下载 M 篇」，无「发现」", () => {
    expect(summaryPhrase(items('downloaded', 'downloaded', 'exists'), 'download')).toBe('已下载 2 篇')
  })
  it("kind='download' 全 exists → 只说文库已有，无「发现」", () => {
    expect(summaryPhrase(items('exists', 'failed'), 'download')).toBe('1 篇文库已有')
  })
  it("kind='download' 无一交付 → 「N 篇未成功」（细节走弹窗）", () => {
    expect(summaryPhrase(items('failed', 'unavailable'), 'download')).toBe('2 篇未成功')
  })
  it("kind='check' 显式传参与缺省逐字一致（缺省即检查语义）", () => {
    expect(summaryPhrase(items('downloaded', 'exists'), 'check'))
      .toBe(summaryPhrase(items('downloaded', 'exists')))
  })
})

describe('triggerLabel', () => {
  it('kind=download → 补下载；否则按 trigger 显示 自动/手动', () => {
    expect(triggerLabel(entry({ kind: 'download' }))).toBe('补下载')
    expect(triggerLabel(entry({ trigger: 'auto' }))).toBe('自动')
    expect(triggerLabel(entry({ trigger: 'manual' }))).toBe('手动')
  })
})

describe('formatShortTime', () => {
  it('MM-DD HH:mm（本地时区，个位补零）', () => {
    expect(formatShortTime(new Date(2026, 8, 4, 9, 5).getTime())).toBe('09-04 09:05')
    expect(formatShortTime(new Date(2026, 11, 31, 23, 59).getTime())).toBe('12-31 23:59')
  })
})

describe('itemStatusTag', () => {
  it('四状态 → 标签 + 颜色', () => {
    expect(itemStatusTag('downloaded')).toEqual({ label: '已下载', color: 'green' })
    expect(itemStatusTag('exists')).toEqual({ label: '文库已有', color: 'default' })
    expect(itemStatusTag('failed')).toEqual({ label: '失败', color: 'red' })
    expect(itemStatusTag('unavailable')).toEqual({ label: '不可访问', color: 'orange' })
  })
})

describe('detailModalTitle', () => {
  it('补下载记录标题带「补下载」；trigger 与时间入标题', () => {
    const t = new Date(2026, 8, 4, 9, 5).getTime()
    expect(detailModalTitle(entry({ time: t, kind: 'download', trigger: 'manual' })))
      .toBe('补下载明细（09-04 09:05 · 手动）')
    expect(detailModalTitle(entry({ time: t, trigger: 'auto' }))).toBe('检查明细（09-04 09:05 · 自动）')
  })
})

describe('latestItemsForAccount（M58 行内本轮检查文章列表）', () => {
  const entry = (time: number, fakeid: string, statuses: DownloadItemLog['status'][]) => ({
    time, trigger: 'manual' as const, accounts: 1, newFound: statuses.length, failed: 0,
    downloadDetail: [{ fakeid, nickname: '号', items: statuses.map((s, i) => ({ title: `文${i}`, status: s, url: `u-${fakeid}-${i}`, refId: `r${i}` })) }],
  })
  it('取最近一条含该号的条目；该号不在最新记录时回落更旧的', () => {
    const log = [
      entry(3, 'B', ['pending']),
      entry(2, 'A', ['downloaded', 'pending']),
      entry(1, 'A', ['downloaded']),
    ]
    const a = latestItemsForAccount(log as never, 'A')
    expect(a?.items).toHaveLength(2)          // A 不在最新(3)记录,回落 time=2 那条
    const b = latestItemsForAccount(log as never, 'B')
    expect(b?.items).toHaveLength(1)          // B 取最新
    expect(latestItemsForAccount(log as never, 'C')).toBeNull()
  })
  it('空 items 也是有效条目（查过、无新 → 行内清空）', () => {
    const log = [{ time: 5, trigger: 'manual' as const, accounts: 1, newFound: 0, failed: 0,
      downloadDetail: [{ fakeid: 'A', nickname: '号', items: [] }] }]
    expect(latestItemsForAccount(log as never, 'A')?.items).toEqual([])
  })
  it('summaryPhrase：全 pending 显示「待下载」', () => {
    const items = [{ title: 'a', status: 'pending' as const }, { title: 'b', status: 'pending' as const }]
    expect(summaryPhrase(items as never)).toBe('发现 2 篇，待下载')
  })
})

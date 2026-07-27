import { describe, it, expect } from 'vitest'
import { resolveDigestDate } from '../../src/core/digest-date'

// 2026-07-28 12:00 本地时间
const NOW = new Date(2026, 6, 28, 12, 0, 0).getTime()

describe('resolveDigestDate', () => {
  it('显式日期原样接受，并给出当天的时间窗', () => {
    const r = resolveDigestDate('2026-07-23', NOW)
    expect(r.date).toBe('2026-07-23')
    expect(new Date(r.fromTs * 1000).getHours()).toBe(0)
    expect(new Date(r.toTs * 1000).getHours()).toBe(23)
    expect(r.toTs - r.fromTs).toBe(86399)
  })

  it('today / yesterday 按本机时区算（大小写不敏感）', () => {
    expect(resolveDigestDate('today', NOW).date).toBe('2026-07-28')
    expect(resolveDigestDate('TODAY', NOW).date).toBe('2026-07-28')
    expect(resolveDigestDate('yesterday', NOW).date).toBe('2026-07-27')
  })

  it('自然语言一律报错——猜错会静默给出另一天的结果，比报错糟得多', () => {
    for (const bad of ['7月23日', '昨天', 'last monday', '']) {
      expect(() => resolveDigestDate(bad, NOW)).toThrow(/YYYY-MM-DD/)
    }
  })

  it('形似但不合法的写法也报错，不做宽容解析', () => {
    for (const bad of ['2026-7-3', '20260723', '2026/07/23', '2026-07-23T10:00']) {
      expect(() => resolveDigestDate(bad, NOW)).toThrow(/YYYY-MM-DD/)
    }
  })

  it('不存在的日历日报错（Date.parse 会静默滚到下个月，必须显式挡）', () => {
    expect(() => resolveDigestDate('2026-02-30', NOW)).toThrow()
    expect(() => resolveDigestDate('2026-13-01', NOW)).toThrow()
  })

  it('跨月/跨年的 yesterday 算得对', () => {
    expect(resolveDigestDate('yesterday', new Date(2026, 0, 1, 9).getTime()).date).toBe('2025-12-31')
    expect(resolveDigestDate('yesterday', new Date(2026, 2, 1, 9).getTime()).date).toBe('2026-02-28')
  })
})

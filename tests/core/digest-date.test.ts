import { describe, expect, it } from 'vitest'
import { resolveDigestDate } from '../../src/core/digest-date'

describe('digest 北京时间日期', () => {
  it('today/yesterday 使用北京时间，边界不依赖机器时区', () => {
    const now = Date.parse('2026-08-29T16:15:00Z')
    expect(resolveDigestDate('today', now)).toEqual({
      date: '2026-08-30', fromTs: 1788019200, toTs: 1788105599,
    })
    expect(resolveDigestDate('yesterday', now).date).toBe('2026-08-29')
  })
  it.each(['2026-02-30', '2026-13-01', 'tomorrow', ''])('拒绝不存在或含糊的日期 %s', (input) => {
    expect(() => resolveDigestDate(input)).toThrow()
  })
})

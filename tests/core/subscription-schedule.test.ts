import { describe, it, expect } from 'vitest'
import { shouldCheckNow } from '../../src/core/subscription-schedule'

// 用本地时间构造「某天 09:00」的工具
const at = (y: number, mo: number, d: number, h: number, mi: number) => new Date(y, mo - 1, d, h, mi, 0, 0).getTime()

describe('shouldCheckNow', () => {
  const base = { checkTime: '09:00' }
  it('false when autoCheck off', () => {
    expect(shouldCheckNow({ ...base, now: at(2026, 6, 16, 10, 0), lastCheckedAt: null, autoCheck: false })).toBe(false)
  })
  it('false before the scheduled time', () => {
    expect(shouldCheckNow({ ...base, now: at(2026, 6, 16, 8, 59), lastCheckedAt: null, autoCheck: true })).toBe(false)
  })
  it('true after scheduled time, never checked', () => {
    expect(shouldCheckNow({ ...base, now: at(2026, 6, 16, 9, 1), lastCheckedAt: null, autoCheck: true })).toBe(true)
  })
  it('false when already checked today (after scheduled)', () => {
    expect(shouldCheckNow({ ...base, now: at(2026, 6, 16, 12, 0), lastCheckedAt: at(2026, 6, 16, 9, 1), autoCheck: true })).toBe(false)
  })
  it('true (launch catch-up) when last check was before today’s slot', () => {
    expect(shouldCheckNow({ ...base, now: at(2026, 6, 16, 10, 0), lastCheckedAt: at(2026, 6, 15, 9, 1), autoCheck: true })).toBe(true)
  })
})

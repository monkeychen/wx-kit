import { describe, it, expect } from 'vitest'
import { shouldCheckNow, lastScheduledInstant, nextScheduledInstant } from '../../src/core/subscription-schedule'

const at = (y: number, mo: number, d: number, h: number, mi: number) => new Date(y, mo - 1, d, h, mi, 0, 0).getTime()
const daily = { mode: 'daily' as const, checkTime: '09:00', intervalHours: 6 }
const interval = (n: number) => ({ mode: 'interval' as const, checkTime: '09:00', intervalHours: n })

describe('shouldCheckNow · daily', () => {
  it('false when autoCheck off', () => {
    expect(shouldCheckNow({ now: at(2026, 6, 16, 10, 0), lastCheckedAt: null, autoCheck: false, config: daily })).toBe(false)
  })
  it('false before the scheduled time', () => {
    expect(shouldCheckNow({ now: at(2026, 6, 16, 8, 59), lastCheckedAt: null, autoCheck: true, config: daily })).toBe(false)
  })
  it('true after scheduled time, never checked', () => {
    expect(shouldCheckNow({ now: at(2026, 6, 16, 9, 1), lastCheckedAt: null, autoCheck: true, config: daily })).toBe(true)
  })
  it('false when already checked today', () => {
    expect(shouldCheckNow({ now: at(2026, 6, 16, 12, 0), lastCheckedAt: at(2026, 6, 16, 9, 1), autoCheck: true, config: daily })).toBe(false)
  })
  it('true (launch catch-up) when last check was before today’s slot', () => {
    expect(shouldCheckNow({ now: at(2026, 6, 16, 10, 0), lastCheckedAt: at(2026, 6, 15, 9, 1), autoCheck: true, config: daily })).toBe(true)
  })
})

describe('shouldCheckNow · interval (grid anchored at midnight)', () => {
  it('fires at the latest grid slot when never checked', () => {
    // N=6 → slots 0/6/12/18; now 13:00 → slot 12:00 reached
    expect(shouldCheckNow({ now: at(2026, 6, 16, 13, 0), lastCheckedAt: null, autoCheck: true, config: interval(6) })).toBe(true)
  })
  it('false when already checked since the latest slot', () => {
    expect(shouldCheckNow({ now: at(2026, 6, 16, 13, 0), lastCheckedAt: at(2026, 6, 16, 12, 30), autoCheck: true, config: interval(6) })).toBe(false)
  })
  it('true when last check predates the latest slot', () => {
    expect(shouldCheckNow({ now: at(2026, 6, 16, 13, 0), lastCheckedAt: at(2026, 6, 16, 11, 0), autoCheck: true, config: interval(6) })).toBe(true)
  })
})

describe('lastScheduledInstant', () => {
  it('daily returns null before the time, the slot after', () => {
    expect(lastScheduledInstant(at(2026, 6, 16, 8, 0), daily)).toBeNull()
    expect(lastScheduledInstant(at(2026, 6, 16, 9, 30), daily)).toBe(at(2026, 6, 16, 9, 0))
  })
  it('interval snaps to the latest midnight-anchored slot', () => {
    expect(lastScheduledInstant(at(2026, 6, 16, 13, 0), interval(6))).toBe(at(2026, 6, 16, 12, 0))
    expect(lastScheduledInstant(at(2026, 6, 16, 1, 0), interval(6))).toBe(at(2026, 6, 16, 0, 0))
  })
})

describe('nextScheduledInstant', () => {
  it('daily → today if before, tomorrow if after', () => {
    expect(nextScheduledInstant(at(2026, 6, 16, 8, 0), daily)).toBe(at(2026, 6, 16, 9, 0))
    expect(nextScheduledInstant(at(2026, 6, 16, 10, 0), daily)).toBe(at(2026, 6, 17, 9, 0))
  })
  it('interval → next grid slot, divisor case', () => {
    expect(nextScheduledInstant(at(2026, 6, 16, 13, 0), interval(6))).toBe(at(2026, 6, 16, 18, 0))
  })
  it('interval → non-divisor last segment collapses to next midnight', () => {
    // N=5 → slots 0/5/10/15/20; now 22:00 → next is next-day 0:00 (not 25:00)
    expect(nextScheduledInstant(at(2026, 6, 16, 22, 0), interval(5))).toBe(at(2026, 6, 17, 0, 0))
  })
})

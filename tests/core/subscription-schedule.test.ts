import { describe, it, expect } from 'vitest'
import {
  shouldCheckNow, lastScheduledInstant, nextScheduledInstant,
  scheduleJitterMs, shouldRunCheck, nextCheckAt,
} from '../../src/core/subscription-schedule'

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

// —— 去规律化（B：触发时刻按时段确定性顺延，破坏「每天同一秒」指纹）——
describe('scheduleJitterMs', () => {
  const slot = at(2026, 6, 16, 9, 0)
  it('is deterministic for a given slot (stable across polls)', () => {
    expect(scheduleJitterMs(slot)).toBe(scheduleJitterMs(slot))
  })
  it('stays within [0, maxJitterMs)', () => {
    for (let d = 0; d < 30; d++) {
      const v = scheduleJitterMs(slot + d * 86400_000, 30 * 60_000)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(30 * 60_000)
    }
  })
  it('varies across slots (different days/segments → different offsets)', () => {
    const vals = new Set<number>()
    for (let d = 0; d < 20; d++) vals.add(scheduleJitterMs(slot + d * 86400_000))
    expect(vals.size).toBeGreaterThan(10) // 不要求全异，但应明显分散
  })
})

describe('shouldRunCheck (= shouldCheckNow + jitter gate)', () => {
  it('with zero jitter behaves exactly like shouldCheckNow', () => {
    const inputs = [
      { now: at(2026, 6, 16, 8, 59), lastCheckedAt: null, autoCheck: true, config: daily },
      { now: at(2026, 6, 16, 9, 1), lastCheckedAt: null, autoCheck: true, config: daily },
      { now: at(2026, 6, 16, 12, 0), lastCheckedAt: at(2026, 6, 16, 9, 1), autoCheck: true, config: daily },
      { now: at(2026, 6, 16, 13, 0), lastCheckedAt: null, autoCheck: true, config: interval(6) },
    ]
    for (const i of inputs) expect(shouldRunCheck(i, 0)).toBe(shouldCheckNow(i))
  })
  it('does not fire until the slot’s jittered instant has passed', () => {
    const inst = at(2026, 6, 16, 9, 0)
    const j = scheduleJitterMs(inst)
    expect(shouldRunCheck({ now: inst + j - 1, lastCheckedAt: null, autoCheck: true, config: daily })).toBe(false)
    expect(shouldRunCheck({ now: inst + j, lastCheckedAt: null, autoCheck: true, config: daily })).toBe(true)
  })
  it('still dedups once checked this slot (no double fire)', () => {
    const inst = at(2026, 6, 16, 9, 0)
    const j = scheduleJitterMs(inst)
    expect(shouldRunCheck({ now: inst + j + 1000, lastCheckedAt: inst + j, autoCheck: true, config: daily })).toBe(false)
  })
})

describe('nextCheckAt (display, jitter-aware)', () => {
  it('before today’s slot → today slot + its jitter', () => {
    const now = at(2026, 6, 16, 8, 0)
    const slot = at(2026, 6, 16, 9, 0)
    expect(nextCheckAt(now, null, daily)).toBe(slot + scheduleJitterMs(slot))
  })
  it('after slot and already checked → tomorrow slot + its jitter', () => {
    const now = at(2026, 6, 16, 12, 0)
    const slot = at(2026, 6, 17, 9, 0)
    expect(nextCheckAt(now, at(2026, 6, 16, 9, 5), daily)).toBe(slot + scheduleJitterMs(slot))
  })
  it('in the jitter window of an unfired slot → this slot + its jitter', () => {
    const slot = at(2026, 6, 16, 9, 0)
    const now = slot + 1 // 已过 9:00 但还没到顺延点、本时段未跑
    expect(nextCheckAt(now, null, daily)).toBe(slot + scheduleJitterMs(slot))
  })
})

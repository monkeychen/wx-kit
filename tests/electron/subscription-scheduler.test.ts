import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SubscriptionScheduler } from '../../electron/services/subscription-scheduler'
import type { SchedulerDeps } from '../../electron/services/subscription-scheduler'

// 固定在计划点之后足够远(避开确定性抖动窗口:最多顺延 30 分钟),保证 shouldRunCheck 恒真
const NOW = Date.parse('2026-07-16T12:00:00+08:00')

function makeDeps(runCheck: () => Promise<void>): SchedulerDeps {
  return {
    settings: { get: async () => ({ subscriptionAutoCheck: true, subscriptionScheduleMode: 'daily', subscriptionCheckTime: '00:00', subscriptionIntervalHours: 2 }) } as never,
    subsFor: async () => ({ getLastRunAt: async () => null }) as never,
    runCheck,
    now: () => NOW,
  }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('SubscriptionScheduler 防重入', () => {
  it('a check still in flight suppresses further ticks (no concurrent duplicate)', async () => {
    let resolveCheck!: () => void
    const runCheck = vi.fn(() => new Promise<void>((r) => { resolveCheck = r }))
    const sch = new SubscriptionScheduler(makeDeps(runCheck))
    sch.start()                                   // 启动即 tick:触发第一次检查(挂起中)
    await vi.advanceTimersByTimeAsync(3 * 60_000) // 检查未结束,再过 3 个 tick
    expect(runCheck).toHaveBeenCalledTimes(1)     // 不重入
    resolveCheck()
    sch.stop()
  })

  it('after the check finishes the guard is released (next due slot fires again)', async () => {
    let lastRun: number | null = null
    const runCheck = vi.fn(async () => { lastRun = null /* 保持「从未跑过」,让下一 tick 仍判定该跑 */ })
    const deps = makeDeps(runCheck)
    deps.subsFor = async () => ({ getLastRunAt: async () => lastRun }) as never
    const sch = new SubscriptionScheduler(deps)
    sch.start()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(runCheck.mock.calls.length).toBeGreaterThanOrEqual(2)   // 守卫不粘死
    sch.stop()
  })

  it('does nothing when autoCheck is off', async () => {
    const runCheck = vi.fn(async () => {})
    const deps = makeDeps(runCheck)
    deps.settings = { get: async () => ({ subscriptionAutoCheck: false }) } as never
    const sch = new SubscriptionScheduler(deps)
    sch.start()
    await vi.advanceTimersByTimeAsync(2 * 60_000)
    expect(runCheck).not.toHaveBeenCalled()
    sch.stop()
  })
})

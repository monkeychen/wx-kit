import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { UpdateScheduler } from '../../electron/services/update-scheduler'
import type { UpdateInfo } from '../../src/core/check-update'

const INTERVAL = 60_000

const info = (hasUpdate: boolean): UpdateInfo => ({
  current: '0.8.3', latest: '0.8.4', hasUpdate, notes: '', publishedAt: '', assets: [],
})

function fakeWindow() {
  const send = vi.fn()
  return { win: { isDestroyed: () => false, webContents: { send } } as never, send }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('UpdateScheduler', () => {
  it('start() 不立即 tick——启动那次由渲染层负责，这里只管应用常开期间的复查', async () => {
    const check = vi.fn(async () => info(false))
    const sch = new UpdateScheduler({ check, windows: () => [], intervalMs: INTERVAL })
    sch.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(check).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(INTERVAL)
    expect(check).toHaveBeenCalledTimes(1)
    sch.stop()
  })

  it('查到新版才广播；没有新版时窗口收不到任何事件', async () => {
    const { win, send } = fakeWindow()
    const sch = new UpdateScheduler({ check: async () => info(false), windows: () => [win], intervalMs: INTERVAL })
    sch.start()
    await vi.advanceTimersByTimeAsync(INTERVAL)
    expect(send).not.toHaveBeenCalled()
    sch.stop()

    const { win: w2, send: send2 } = fakeWindow()
    const sch2 = new UpdateScheduler({ check: async () => info(true), windows: () => [w2], intervalMs: INTERVAL })
    sch2.start()
    await vi.advanceTimersByTimeAsync(INTERVAL)
    expect(send2).toHaveBeenCalledWith('update:available', expect.objectContaining({ hasUpdate: true, latest: '0.8.4' }))
    sch2.stop()
  })

  it('慢请求跨 tick 时不重入', async () => {
    let resolve!: (v: UpdateInfo | null) => void
    const check = vi.fn(() => new Promise<UpdateInfo | null>((r) => { resolve = r }))
    const sch = new UpdateScheduler({ check, windows: () => [], intervalMs: INTERVAL })
    sch.start()
    await vi.advanceTimersByTimeAsync(INTERVAL * 3)
    expect(check).toHaveBeenCalledTimes(1)
    resolve(null)
    sch.stop()
  })

  it('检查抛错不影响后续 tick（更新检查失败不该拖垮应用其余部分）', async () => {
    const check = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(info(false))
    const sch = new UpdateScheduler({ check, windows: () => [], intervalMs: INTERVAL })
    sch.start()
    await vi.advanceTimersByTimeAsync(INTERVAL * 2)
    expect(check).toHaveBeenCalledTimes(2)
    sch.stop()
  })

  it('stop() 之后不再 tick', async () => {
    const check = vi.fn(async () => info(false))
    const sch = new UpdateScheduler({ check, windows: () => [], intervalMs: INTERVAL })
    sch.start(); sch.stop()
    await vi.advanceTimersByTimeAsync(INTERVAL * 5)
    expect(check).not.toHaveBeenCalled()
  })
})

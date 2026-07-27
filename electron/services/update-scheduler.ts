// electron/services/update-scheduler.ts
// 运行期低频 tick 检查新版本(M39)。
//
// 为什么必须放主进程:此前唯一的检查时机是渲染层挂载后 3 秒(MainLayout),
// **关窗驻留后那个 effect 不再跑**;桌面应用常年不重启,于是可能好几天都不查一次
// ——安哥那台机器等了一小时没提示就是这个形状(docs/PRD-v0.8.4.md R1)。
//
// tick 频繁不等于请求频繁:真正的节流在 update-gate 的「每天最多一次」,这里只负责「到点问一声」。
import type { BrowserWindow } from 'electron'
import type { UpdateInfo } from '../../src/core/check-update'

/** 一小时问一次;实际请求由每日限流兜底,多数 tick 走缓存、零网络 */
const TICK_MS = 60 * 60 * 1000

export interface UpdateSchedulerDeps {
  /** 与 IPC 共用同一份门控实现,别在这里重写限流 */
  check: (silent: boolean) => Promise<UpdateInfo | null>
  windows: () => BrowserWindow[]
  intervalMs?: number
}

export class UpdateScheduler {
  private timer: ReturnType<typeof setInterval> | null = null
  private running = false
  constructor(private deps: UpdateSchedulerDeps) {}

  start(): void {
    // 刻意不在 start() 里立即 tick:启动那次由渲染层的 3 秒延迟负责,重复问没意义
    this.timer = setInterval(() => { void this.tick() }, this.deps.intervalMs ?? TICK_MS)
  }
  stop(): void { if (this.timer) { clearInterval(this.timer); this.timer = null } }

  async tick(): Promise<void> {
    if (this.running) return       // 防重入:网络慢时一次检查可能跨 tick
    this.running = true
    try {
      const info = await this.deps.check(true)
      if (!info?.hasUpdate) return
      for (const w of this.deps.windows()) {
        if (!w.isDestroyed()) w.webContents.send('update:available', info)
      }
    } catch { /* 更新检查失败不该影响应用其余部分;下次 tick 再来 */ }
    finally { this.running = false }
  }
}

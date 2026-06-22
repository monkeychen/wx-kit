// electron/services/subscription-scheduler.ts
// 运行期每分钟 tick：到达配置时刻（叠加去规律化的随机顺延）且当天未检查则触发；start() 时立即 tick 一次做启动补检。GUI 模式专用。
import { shouldRunCheck } from '../../src/core/subscription-schedule'
import type { Subscriptions } from '../../src/core/subscriptions'
import type { SettingsService } from './settings'

export interface SchedulerDeps {
  settings: SettingsService
  subsFor: () => Promise<Subscriptions>
  runCheck: () => Promise<void>
  now?: () => number
}

export class SubscriptionScheduler {
  private timer: ReturnType<typeof setInterval> | null = null
  constructor(private deps: SchedulerDeps) {}

  start(): void {
    void this.tick()
    this.timer = setInterval(() => { void this.tick() }, 60_000)
  }
  stop(): void { if (this.timer) { clearInterval(this.timer); this.timer = null } }

  private async tick(): Promise<void> {
    try {
      const s = await this.deps.settings.get()
      if (!s.subscriptionAutoCheck) return
      const now = (this.deps.now ?? Date.now)()
      const lastRunAt = await (await this.deps.subsFor()).getLastRunAt()
      if (shouldRunCheck({
        now, lastCheckedAt: lastRunAt, autoCheck: true,
        config: { mode: s.subscriptionScheduleMode, checkTime: s.subscriptionCheckTime, intervalHours: s.subscriptionIntervalHours },
      })) {
        await this.deps.runCheck()
      }
    } catch { /* 定时检查失败不应影响应用其余部分；下次 tick 再来 */ }
  }
}

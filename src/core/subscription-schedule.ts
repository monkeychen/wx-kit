// src/core/subscription-schedule.ts
// 运行期定时检查的纯判定：app 必须开着才检查；启动时若当前计划时刻已过且未检查则补检一次。
// 两种模式：daily（每天某时刻）/ interval（每隔 N 小时，网格锚定每天 0 点）。
export type ScheduleMode = 'daily' | 'interval'
export interface ScheduleConfig {
  mode: ScheduleMode
  checkTime: string       // "HH:MM"（daily）
  intervalHours: number   // 小时（interval）
}
export interface ScheduleInput {
  now: number                  // unix ms
  lastCheckedAt: number | null // 上次检查运行的 unix ms
  autoCheck: boolean
  config: ScheduleConfig
}

function startOfDay(now: number): number {
  const d = new Date(now); d.setHours(0, 0, 0, 0); return d.getTime()
}
function dailyTs(now: number, checkTime: string): number {
  const d = new Date(now); const [h, m] = checkTime.split(':').map(Number); d.setHours(h, m, 0, 0); return d.getTime()
}

/** 当前已过的最近一个计划时刻；daily 在今天时刻前返回 null（今天还没到点）。 */
export function lastScheduledInstant(now: number, config: ScheduleConfig): number | null {
  if (config.mode === 'interval') {
    const midnight = startOfDay(now)
    const slotMs = Math.max(1, config.intervalHours) * 3600_000
    const k = Math.floor((now - midnight) / slotMs)
    return midnight + k * slotMs
  }
  const ts = dailyTs(now, config.checkTime)
  return now >= ts ? ts : null
}

/** 下次预计检查时刻（供页面显示）。interval 末段不足 N 小时则收口到次日 0 点。 */
export function nextScheduledInstant(now: number, config: ScheduleConfig): number {
  if (config.mode === 'interval') {
    const midnight = startOfDay(now)
    const slotMs = Math.max(1, config.intervalHours) * 3600_000
    const k = Math.floor((now - midnight) / slotMs)
    const candidate = midnight + (k + 1) * slotMs
    const nextMidnight = midnight + 24 * 3600_000
    return Math.min(candidate, nextMidnight)
  }
  const ts = dailyTs(now, config.checkTime)
  return now < ts ? ts : ts + 24 * 3600_000
}

/** 现在是否该触发一次检查。 */
export function shouldCheckNow(i: ScheduleInput): boolean {
  if (!i.autoCheck) return false
  const inst = lastScheduledInstant(i.now, i.config)
  if (inst == null) return false
  return i.lastCheckedAt == null || i.lastCheckedAt < inst
}

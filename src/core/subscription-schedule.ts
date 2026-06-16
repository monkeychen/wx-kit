// src/core/subscription-schedule.ts
// 运行期定时检查的纯判定：app 必须开着才检查；启动时若当天时刻已过且未检查则补检一次。
export interface ScheduleInput {
  now: number                  // unix ms
  checkTime: string            // "HH:MM"（本地时间）
  lastCheckedAt: number | null // 上次检查运行的 unix ms
  autoCheck: boolean
}

/** 当天 checkTime 对应的本地时间戳。 */
function scheduledTsFor(now: number, checkTime: string): number {
  const d = new Date(now)
  const [h, m] = checkTime.split(':').map(Number)
  d.setHours(h, m, 0, 0)
  return d.getTime()
}

/** 现在是否该触发一次检查。 */
export function shouldCheckNow(i: ScheduleInput): boolean {
  if (!i.autoCheck) return false
  const scheduled = scheduledTsFor(i.now, i.checkTime)
  if (i.now < scheduled) return false
  if (i.lastCheckedAt != null && i.lastCheckedAt >= scheduled) return false
  return true
}

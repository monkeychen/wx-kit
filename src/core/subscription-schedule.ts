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

/** 现在是否该触发一次检查（网格 + 去重，不含抖动）。 */
export function shouldCheckNow(i: ScheduleInput): boolean {
  if (!i.autoCheck) return false
  const inst = lastScheduledInstant(i.now, i.config)
  if (inst == null) return false
  return i.lastCheckedAt == null || i.lastCheckedAt < inst
}

// —— 去规律化（B）——
// 微信频控盯的是「不像人」的节奏：每天同一秒触发是明显的机器指纹。给每个计划时段叠加一个
// 「确定性随机顺延」——同一时段每次轮询算出同一个偏移（否则会早触发/重复触发），日间/段间各异。
const DEFAULT_JITTER_MS = 30 * 60_000   // 触发时刻最多顺延 30 分钟（只往后，不会早于设定点）

/** 由时段起点确定性派生的顺延量，落在 [0, maxJitterMs)。整数哈希，无需 crypto。 */
export function scheduleJitterMs(slotInstant: number, maxJitterMs = DEFAULT_JITTER_MS): number {
  if (maxJitterMs <= 0) return 0
  const seed = Math.floor(slotInstant / 60_000)
  const h = Math.imul(seed ^ 0x9e3779b9, 2654435761) >>> 0
  return h % maxJitterMs
}

/** 在 shouldCheckNow 之上叠加抖动闸门：到点后还要等过本时段的随机顺延量才真正触发。 */
export function shouldRunCheck(i: ScheduleInput, maxJitterMs = DEFAULT_JITTER_MS): boolean {
  if (!shouldCheckNow(i)) return false
  const inst = lastScheduledInstant(i.now, i.config)!   // shouldCheckNow 已保证非空
  return i.now >= inst + scheduleJitterMs(inst, maxJitterMs)
}

/** 下次实际触发时刻（含抖动，供页面显示）。当前时段已到点但还在顺延窗口内且未跑→就是本时段顺延点。 */
export function nextCheckAt(
  now: number, lastCheckedAt: number | null, config: ScheduleConfig, maxJitterMs = DEFAULT_JITTER_MS,
): number {
  const last = lastScheduledInstant(now, config)
  if (last != null) {
    const fireAt = last + scheduleJitterMs(last, maxJitterMs)
    if (now < fireAt && (lastCheckedAt == null || lastCheckedAt < last)) return fireAt
  }
  const rawNext = nextScheduledInstant(now, config)
  return rawNext + scheduleJitterMs(rawNext, maxJitterMs)
}

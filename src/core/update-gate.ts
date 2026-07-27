// src/core/update-gate.ts
// 「这次该不该发请求、拿不到新结果时说什么」——更新检查的门控决策。
//
// 抽到 core 是因为 M39 修的 bug 就长在这段判断里:旧实现把它内联在 ipc.ts,
// 静默检查一旦被「每天最多一次」拦住就 `return null`,**连上次查到的结论一起吞掉**,
// 于是「查了没新版」「被限流」「查失败」在渲染层长得一模一样(详见 docs/PRD-v0.8.4.md R1)。
import { compareVersions } from './version-compare'
import type { UpdateInfo } from './check-update'

/** 自动检查最多一天一次(tick 变频繁不等于请求变频繁) */
export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000

/**
 * 上次查到的 release。**从 UpdateInfo 派生而不是另写一份字段**——两份必漂。
 * 刻意不存 `hasUpdate`:它要按「当前版本」实时算,
 * 这样升级后本地版本 ≥ 缓存版本,提示自动消失,不需要任何清理逻辑。
 */
export type CachedRelease = Omit<UpdateInfo, 'current' | 'hasUpdate'>

export interface GateInput {
  /** 静默检查(启动/定时)受开关与限流约束;手动点「检查更新」不受 */
  silent: boolean
  enabled: boolean
  lastCheckedAt: number | null
  now: number
}

/** check=真发请求 / cache=用上次的结论 / skip=什么都不做 */
export type GateDecision = 'check' | 'cache' | 'skip'

export function decideUpdateCheck({ silent, enabled, lastCheckedAt, now }: GateInput): GateDecision {
  // 手动是用户主动问「现在什么情况」,任何拦截都是答非所问
  if (!silent) return 'check'
  // 关掉开关 = 「别拿这事烦我」,所以连缓存提示也不给
  if (!enabled) return 'skip'
  if (lastCheckedAt != null && now - lastCheckedAt < UPDATE_CHECK_INTERVAL_MS) return 'cache'
  return 'check'
}

/** 把缓存的 release 按「当前版本」还原成一次检查结果;无缓存返回 null。 */
export function infoFromCache(cached: CachedRelease | null, currentVersion: string): UpdateInfo | null {
  if (!cached?.latest) return null
  return {
    current: currentVersion,
    latest: cached.latest,
    hasUpdate: compareVersions(cached.latest, currentVersion) > 0,
    notes: cached.notes,
    publishedAt: cached.publishedAt,
    assets: cached.assets,
  }
}

/** 从一次成功的检查里取出要落盘的部分(丢掉随版本变化的 current/hasUpdate)。 */
export function toCachedRelease(info: UpdateInfo): CachedRelease {
  return { latest: info.latest, notes: info.notes, publishedAt: info.publishedAt, assets: info.assets }
}

export interface ResolveUpdateDeps extends GateInput {
  currentVersion: string
  cached: CachedRelease | null
  /** 真发请求;失败返回 null(check-update 的既定契约,任何异常都不外抛) */
  check: (currentVersion: string) => Promise<UpdateInfo | null>
  save: (patch: { lastUpdateCheckAt: number; lastKnownRelease: CachedRelease }) => Promise<void>
}

/**
 * 一次完整的更新检查:门控 → (可能的)请求 → 落缓存 → 给出结论。
 *
 * 整段放 core 而不是 ipc,是为了让**断网回落**这条路径能被单测钉住——
 * 它恰恰是最难手工复现、又最容易在重构中悄悄丢掉的一条。
 */
export async function resolveUpdateCheck(deps: ResolveUpdateDeps): Promise<UpdateInfo | null> {
  const { silent, enabled, lastCheckedAt, now, currentVersion, cached, check, save } = deps
  const decision = decideUpdateCheck({ silent, enabled, lastCheckedAt, now })
  if (decision === 'skip') return null
  if (decision === 'cache') return infoFromCache(cached, currentVersion)

  const info = await check(currentVersion)
  if (info) {
    // 只有真发出去了才记时间,否则断网一次就要等一天才再查;
    // 缓存则不论有无新版都写——它记的是「上次查到的事实」,不是「待提示的通知」
    await save({ lastUpdateCheckAt: now, lastKnownRelease: toCachedRelease(info) })
    return info
  }
  // 静默失败回落到缓存:断网不该让已知的新版提示消失。
  // 手动失败仍返回 null —— 用户主动问「现在什么情况」,拿旧结论冒充成功是撒谎。
  return silent ? infoFromCache(cached, currentVersion) : null
}

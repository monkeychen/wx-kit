// src/core/check-subscriptions.ts
// 订阅检查编排：逐号「只列表不下载」+ 每轮打乱账号顺序；
// 请求间隔与频控熔断统一由全局 gateway 决定，本层不再维护第二套 sleep。
// v0.10.0：列表后端抽象为注入的 list 函数（微信读书实现），本层不感知后端细节。
import { MpAuthExpired } from './mp-errors'
import type { ArticleRef } from './mp-types'
import type { SubscribedAccount } from './subscriptions'

/** Fisher-Yates，返回新数组（默认账号顺序打乱用；可注入以便测试确定化）。 */
function shuffleImpl<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export interface CheckDeps {
  /** 按水位取件:返回「至少覆盖比 watermark 新的全部文章」的列表,可含旧文章(新旧过滤在本层)。 */
  list: (fakeid: string, watermark: number) => Promise<ArticleRef[]>
  sleep?: (ms: number) => Promise<void>
  shuffle?: <T>(arr: T[]) => T[]
}
export interface AccountCheckResult { fakeid: string; ok: boolean; newRefs: ArticleRef[]; latest: number; latestArticleId?: string; error?: string }

export async function checkSubscriptions(accounts: SubscribedAccount[], deps: CheckDeps): Promise<AccountCheckResult[]> {
  const shuffle = deps.shuffle ?? shuffleImpl
  const results: AccountCheckResult[] = []
  for (const acc of shuffle(accounts)) {   // 每轮打乱顺序：破坏「固定 fakeid 序列」指纹
    // gateway 会给每个账号首屏分配全局窗口；串行本身不再被误认为频控治理。
    let refs: ArticleRef[]
    try { refs = await deps.list(acc.fakeid, acc.watermark) }
    catch (e) {
      if (e instanceof MpAuthExpired) throw e   // 登录态失效：整体中止，交上层引导重新登录
      const code = (e as { code?: string })?.code
      if (code === 'RATE_LIMITED' || code === 'MP_GOVERNOR_PAUSED' || code === 'MP_RATE_LIMITED') {
        throw e // 全局保护状态不是「这个号失败」；继续循环只会制造重复拒绝与误导日志
      }
      results.push({ fakeid: acc.fakeid, ok: false, newRefs: [], latest: acc.watermark, error: (e as Error).message })
      continue
    }
    const latestArticleId = refs.find((r) => r.sourceId)?.sourceId
    // cover 只给最新文章身份、没有发布时间。发现时间会随每次请求变化，不能拿来和水位比较。
    const newRefs = latestArticleId != null
      ? (acc.latestArticleId === latestArticleId ? [] : refs)
      : refs.filter((r) => r.createTime > acc.watermark)
    newRefs.sort((a, b) => b.createTime - a.createTime)
    const latest = refs.reduce((mx, r) => Math.max(mx, r.createTime), acc.watermark)
    results.push({ fakeid: acc.fakeid, ok: true, newRefs, latest, ...(latestArticleId != null ? { latestArticleId } : {}) })
  }
  return results
}

// src/core/check-subscriptions.ts
// 订阅检查编排：逐号「只列表不下载」，串行 + 账号间随机延迟 + 每轮打乱账号顺序（去规律化，破坏频控指纹）；
// 频控不重试（命中即跳过，下一轮再来）；单号失败隔离，登录失效整体中止。
import { listArticles as listImpl, sleep as sleepImpl, randMs } from './mp-client'
import { MpAuthExpired } from './mp-errors'
import type { ArticleRef, MpFetch, CrawlRange } from './mp-types'
import type { SubscribedAccount } from './subscriptions'

const RECENT: CrawlRange = { count: 20 }   // 每号取最近 20 篇与水位比对；日检测频率下足够

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
  mpFetch: MpFetch
  token: string
  listFn?: typeof listImpl
  sleep?: (ms: number) => Promise<void>
  shuffle?: <T>(arr: T[]) => T[]
}
export interface AccountCheckResult { fakeid: string; ok: boolean; newRefs: ArticleRef[]; latest: number; error?: string }

export async function checkSubscriptions(accounts: SubscribedAccount[], deps: CheckDeps): Promise<AccountCheckResult[]> {
  const sleep = deps.sleep ?? sleepImpl
  const listFn = deps.listFn ?? listImpl
  const shuffle = deps.shuffle ?? shuffleImpl
  const results: AccountCheckResult[] = []
  let first = true
  for (const acc of shuffle(accounts)) {   // 每轮打乱顺序：破坏「固定 fakeid 序列」指纹
    if (!first) await sleep(randMs(3000, 8000))   // 账号间随机间隔（非恒定 2s），缓解频控 + 去机器节奏
    first = false
    // 频控不重试：命中即把该号记为本轮失败、跳过，等下一轮检查再来。
    // （退避重试只会在已被限的状态下追加请求，反而加重/延长频控——见 devlog 频控原则。）
    let refs: ArticleRef[]
    try { refs = await listFn(deps.mpFetch, deps.token, acc.fakeid, RECENT, { sleep }) }
    catch (e) {
      if (e instanceof MpAuthExpired) throw e   // 登录态失效：整体中止，交上层引导重新登录
      results.push({ fakeid: acc.fakeid, ok: false, newRefs: [], latest: acc.watermark, error: (e as Error).message })
      continue
    }
    const newRefs = refs.filter((r) => r.createTime > acc.watermark).sort((a, b) => b.createTime - a.createTime)
    const latest = refs.reduce((mx, r) => Math.max(mx, r.createTime), acc.watermark)
    results.push({ fakeid: acc.fakeid, ok: true, newRefs, latest })
  }
  return results
}

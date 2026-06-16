// src/core/check-subscriptions.ts
// 订阅检查编排：逐号「只列表不下载」，串行 + 账号间延迟 + 频控退避；单号失败隔离，登录失效整体中止。
import { listArticles as listImpl, sleep as sleepImpl } from './mp-client'
import { MpRateLimited, MpAuthExpired } from './mp-errors'
import type { ArticleRef, MpFetch, CrawlRange } from './mp-types'
import type { SubscribedAccount } from './subscriptions'

const RECENT: CrawlRange = { count: 20 }   // 每号取最近 20 篇与水位比对；日检测频率下足够

export interface CheckDeps {
  mpFetch: MpFetch
  token: string
  listFn?: typeof listImpl
  sleep?: (ms: number) => Promise<void>
  onBackoff?: (ev: { fakeid: string; attempt: number; waitMs: number }) => void
}
export interface AccountCheckResult { fakeid: string; ok: boolean; newRefs: ArticleRef[]; latest: number; error?: string }

export async function checkSubscriptions(accounts: SubscribedAccount[], deps: CheckDeps): Promise<AccountCheckResult[]> {
  const sleep = deps.sleep ?? sleepImpl
  const listFn = deps.listFn ?? listImpl
  const results: AccountCheckResult[] = []
  let first = true
  for (const acc of accounts) {
    if (!first) await sleep(2000)   // 账号间间隔，缓解频控
    first = false
    let refs: ArticleRef[] | null = null
    for (let attempt = 0; ; attempt++) {
      try { refs = await listFn(deps.mpFetch, deps.token, acc.fakeid, RECENT, { sleep }); break }
      catch (e) {
        if (e instanceof MpAuthExpired) throw e   // 登录态失效：整体中止，交上层引导重新登录
        if (e instanceof MpRateLimited && attempt < 3) {
          const waitMs = 30000 * (attempt + 1)
          deps.onBackoff?.({ fakeid: acc.fakeid, attempt: attempt + 1, waitMs })
          await sleep(waitMs); continue
        }
        results.push({ fakeid: acc.fakeid, ok: false, newRefs: [], latest: acc.watermark, error: (e as Error).message })
        refs = null; break
      }
    }
    if (refs == null) continue
    const newRefs = refs.filter((r) => r.createTime > acc.watermark).sort((a, b) => b.createTime - a.createTime)
    const latest = refs.reduce((mx, r) => Math.max(mx, r.createTime), acc.watermark)
    results.push({ fakeid: acc.fakeid, ok: true, newRefs, latest })
  }
  return results
}

// electron/services/subscription-check.ts
// 订阅检查编排(从 ipc.ts 抽出,GUI 与 CLI 共用)。依赖全注入,无 electron 运行时,可单测。
import { checkSubscriptions } from '../../src/core/check-subscriptions'
import { MpAuthExpired } from '../../src/core/mp-errors'
import type { Subscriptions, CheckLogEntry } from '../../src/core/subscriptions'
import type { ArticleRef, MpFetch } from '../../src/core/mp-types'
import type { DownloadFormat } from '../../src/core/types'
import type { HistorySource } from '../../src/core/download-history'
import type { AppSettings } from './settings'

export interface RunCheckDeps {
  subs: Subscriptions
  settings: Pick<AppSettings, 'defaultFormats' | 'subscriptionNewArticleAction'>
  session: { token: string } | null
  mpFetch: MpFetch | null
  downloadRefs: (refs: ArticleRef[], formats: DownloadFormat[], source: HistorySource) => Promise<void>
  log: (entry: CheckLogEntry) => Promise<void>
  onEmit?: () => void
  check?: typeof checkSubscriptions
}
export interface RunCheckResult { accounts: number; newFound: number; failed: number; note?: string; authExpired: boolean }

export async function runSubscriptionCheck(trigger: 'auto' | 'manual', deps: RunCheckDeps): Promise<RunCheckResult> {
  const { subs, settings, session, mpFetch, downloadRefs } = deps
  const check = deps.check ?? checkSubscriptions
  const emit = () => deps.onEmit?.()
  const now = () => Date.now()

  if (!session || !mpFetch) {
    await deps.log({ time: now(), trigger, accounts: 0, newFound: 0, failed: 0, note: 'no-session' })
    emit(); return { accounts: 0, newFound: 0, failed: 0, note: 'no-session', authExpired: true }
  }
  const accounts = (await subs.list()).filter((a) => a.subscribed)
  if (!accounts.length) {
    await subs.setLastRunAt(now())
    await deps.log({ time: now(), trigger, accounts: 0, newFound: 0, failed: 0, note: 'no-accounts' })
    emit(); return { accounts: 0, newFound: 0, failed: 0, note: 'no-accounts', authExpired: false }
  }
  let results
  try { results = await check(accounts, { mpFetch, token: session.token }) }
  catch (e) {
    if (e instanceof MpAuthExpired) {
      await deps.log({ time: now(), trigger, accounts: accounts.length, newFound: 0, failed: accounts.length, note: 'auth-expired' })
      emit(); return { accounts: accounts.length, newFound: 0, failed: accounts.length, note: 'auth-expired', authExpired: true }
    }
    throw e
  }
  let newFound = 0, failed = 0
  for (const r of results) {
    if (!r.ok) { failed++; continue }
    await subs.updateWatermark(r.fakeid, r.latest)
    if (r.newRefs.length === 0) continue
    newFound += r.newRefs.length
    if (settings.subscriptionNewArticleAction === 'download') {
      const acc = accounts.find((a) => a.fakeid === r.fakeid)!
      await downloadRefs(r.newRefs, settings.defaultFormats, { kind: 'account', nickname: acc.nickname, fakeid: r.fakeid, range: { count: r.newRefs.length } })
      await subs.clearNewRefs(r.fakeid)
    } else {
      await subs.setNewRefs(r.fakeid, r.newRefs)
    }
  }
  await subs.setLastRunAt(now())
  await deps.log({ time: now(), trigger, accounts: accounts.length, newFound, failed })
  emit(); return { accounts: accounts.length, newFound, failed, authExpired: false }
}

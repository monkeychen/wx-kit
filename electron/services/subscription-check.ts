// electron/services/subscription-check.ts
// 订阅检查编排(从 ipc.ts 抽出,GUI 与 CLI 共用)。依赖全注入,无 electron 运行时,可单测。
import { checkSubscriptions } from '../../src/core/check-subscriptions'
import { MpAuthExpired } from '../../src/core/mp-errors'
import type { Subscriptions, CheckLogEntry, CheckFailure } from '../../src/core/subscriptions'
import type { ArticleRef, MpFetch } from '../../src/core/mp-types'
import type { DownloadFormat, DownloadSummary, ProgressEvent } from '../../src/core/types'
import type { HistorySource } from '../../src/core/download-history'
import type { AppSettings } from './settings'

export interface RunCheckDeps {
  subs: Subscriptions
  settings: Pick<AppSettings, 'defaultFormats' | 'subscriptionNewArticleAction'>
  session: { token: string } | null
  mpFetch: MpFetch | null
  downloadRefs: (refs: ArticleRef[], formats: DownloadFormat[], source: HistorySource,
    onProgress?: (e: ProgressEvent) => void) => Promise<DownloadSummary>
  log: (entry: CheckLogEntry) => Promise<void>
  onEmit?: () => void
  check?: typeof checkSubscriptions
  /** 部分检查(R1):只查这些 fakeid,不传 = 全量。核心 checkSubscriptions 本就按 accounts 数组查,这里只做选料过滤。 */
  fakeids?: string[]
  /** M34:自动下载的进度回调。定时检查没有 event.sender,故由调用方(ipc)决定怎么发(广播)。 */
  onDownloadProgress?: (e: { fakeid: string; total: number; done: number; phase: string }) => void
}
/** M34:逐号明细。汇总数说不出「这一行新增了几篇」,而反馈要落在被操作的对象上。 */
export interface PerAccountResult {
  fakeid: string
  nickname: string
  ok: boolean
  /** 本次发现的新文章数 */
  newFound: number
  /** 其中自动下载了几篇(仅 download 策略下 >0) */
  downloaded: number
  error?: string
}
export interface RunCheckResult {
  accounts: number; newFound: number; failed: number
  failures?: CheckFailure[]; note?: string; authExpired: boolean
  /** 逐号明细;三条早退路径为空数组(渲染层可无脑遍历) */
  results: PerAccountResult[]
}

export async function runSubscriptionCheck(trigger: 'auto' | 'manual', deps: RunCheckDeps): Promise<RunCheckResult> {
  const { subs, settings, session, mpFetch, downloadRefs } = deps
  const check = deps.check ?? checkSubscriptions
  const emit = () => deps.onEmit?.()
  const now = () => Date.now()

  if (!session || !mpFetch) {
    await deps.log({ time: now(), trigger, accounts: 0, newFound: 0, failed: 0, note: 'no-session' })
    emit(); return { accounts: 0, newFound: 0, failed: 0, note: 'no-session', authExpired: true, results: [] }
  }
  const accounts = (await subs.list()).filter((a) => a.subscribed)
    .filter((a) => (deps.fakeids ? deps.fakeids.includes(a.fakeid) : true))
  if (!accounts.length) {
    await subs.setLastRunAt(now())
    await deps.log({ time: now(), trigger, accounts: 0, newFound: 0, failed: 0, note: 'no-accounts' })
    emit(); return { accounts: 0, newFound: 0, failed: 0, note: 'no-accounts', authExpired: false, results: [] }
  }
  let results
  try { results = await check(accounts, { mpFetch, token: session.token }) }
  catch (e) {
    if (e instanceof MpAuthExpired) {
      await deps.log({ time: now(), trigger, accounts: accounts.length, newFound: 0, failed: accounts.length, note: 'auth-expired' })
      emit(); return { accounts: accounts.length, newFound: 0, failed: accounts.length, note: 'auth-expired', authExpired: true, results: [] }
    }
    throw e
  }
  let newFound = 0, failed = 0
  const failures: CheckFailure[] = []
  const perAccount: PerAccountResult[] = []
  for (const r of results) {
    const nickname = accounts.find((a) => a.fakeid === r.fakeid)?.nickname ?? r.fakeid
    if (!r.ok) {
      failed++
      const error = r.error ?? '未知错误'
      // 逐号失败明细留痕:哪个号、什么原因(频控/网络等),供检查记录弹窗与 CLI 输出
      failures.push({ nickname, error })
      perAccount.push({ fakeid: r.fakeid, nickname, ok: false, newFound: 0, downloaded: 0, error })
      continue
    }
    await subs.updateWatermark(r.fakeid, r.latest)
    if (r.newRefs.length === 0) {
      perAccount.push({ fakeid: r.fakeid, nickname, ok: true, newFound: 0, downloaded: 0 })
      continue
    }
    newFound += r.newRefs.length
    const total = r.newRefs.length
    let downloaded = 0
    if (settings.subscriptionNewArticleAction === 'download') {
      // 自动下载的进度此前完全不可见(手动下载有进度条,自动下载连一条事件都不发)
      deps.onDownloadProgress?.({ fakeid: r.fakeid, total, done: 0, phase: 'start' })
      const summary = await downloadRefs(r.newRefs, settings.defaultFormats,
        { kind: 'account', nickname, fakeid: r.fakeid, range: { count: total } },
        (e) => deps.onDownloadProgress?.({ fakeid: r.fakeid, total, done: e.completed, phase: e.phase }))
      deps.onDownloadProgress?.({ fakeid: r.fakeid, total, done: total, phase: 'done' })
      // 真故障(网络/频控)留在待处理里等重试:此前无脑 clear,自动下载失败的文章就此消失,
      // 而自动模式下用户根本没看着屏幕,连「刚才失败了」都不知道。
      // 读者本就打不开的(unavailable)不留 —— 重试无用,留着只会变成永远清不掉的红点。
      const doneUrls = new Set(summary.items.filter((i) => i.ok || i.unavailable).map((i) => i.url))
      const kept = r.newRefs.filter((x) => !doneUrls.has(x.url))
      if (kept.length) await subs.setPendingRefs(r.fakeid, kept)
      else await subs.clearNewRefs(r.fakeid)
      downloaded = summary.succeeded
    } else {
      await subs.addNewRefs(r.fakeid, r.newRefs)
    }
    perAccount.push({ fakeid: r.fakeid, nickname, ok: true, newFound: total, downloaded })
  }
  await subs.setLastRunAt(now())
  await deps.log({ time: now(), trigger, accounts: accounts.length, newFound, failed, ...(failures.length ? { failures } : {}) })
  emit(); return { accounts: accounts.length, newFound, failed, ...(failures.length ? { failures } : {}), authExpired: false, results: perAccount }
}

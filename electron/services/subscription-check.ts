// electron/services/subscription-check.ts
// 订阅检查编排(从 ipc.ts 抽出,GUI 与 CLI 共用)。依赖全注入,无 electron 运行时,可单测。
import { checkSubscriptions } from '../../src/core/check-subscriptions'
import { MpAuthExpired } from '../../src/core/mp-errors'
import { normalizeAccountKey } from '../../src/core/weread/book-id'
import type { Subscriptions, CheckLogEntry, CheckFailure, AccountDownloadLog, DownloadItemLog } from '../../src/core/subscriptions'
import { toAccountDownloadLog, countDownloadOutcomes } from '../../src/core/subscription-batch'
import type { ArticleRef } from '../../src/core/mp-types'
import type { DownloadFormat, DownloadSummary, ProgressEvent } from '../../src/core/types'
import type { HistorySource } from '../../src/core/download-history'
import { refId } from '../../src/core/subscription-refs'
import type { AppSettings } from './settings'

export interface RunCheckDeps {
  subs: Subscriptions
  settings: Pick<AppSettings, 'defaultFormats' | 'subscriptionNewArticleAction'>
  /** 列表取件（微信读书实现）；null = 未登录，走 no-session 早退 */
  list: ((fakeid: string, watermark: number) => Promise<ArticleRef[]>) | null
  downloadRefs: (refs: ArticleRef[], formats: DownloadFormat[], source: HistorySource,
    onProgress?: (e: ProgressEvent) => void) => Promise<DownloadSummary>
  log: (entry: CheckLogEntry) => Promise<void>
  onEmit?: () => void
  check?: typeof checkSubscriptions
  /** 部分检查(R1):只查这些 fakeid,不传 = 全量。核心 checkSubscriptions 本就按 accounts 数组查,这里只做选料过滤。 */
  fakeids?: string[]
  /** M34:自动下载的进度回调。定时检查没有 event.sender,故由调用方(ipc)决定怎么发(广播)。 */
  onDownloadProgress?: (e: { fakeid: string; total: number; done: number; phase: string }) => void
  /** v0.10.0 旧订阅没有 cover 游标时，用本地文库建立基线，避免升级后把已下载文章再报一次。 */
  isRefDownloaded?: (ref: ArticleRef) => Promise<boolean>
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
  /** M56:该号本次下载的逐篇四状态明细(仅 download 策略;与落盘的 downloadDetail 同源,无下载动作不写) */
  articles?: DownloadItemLog[]
  error?: string
}
export interface RunCheckResult {
  accounts: number; newFound: number; failed: number
  failures?: CheckFailure[]; note?: string; authExpired: boolean
  /** 逐号明细;三条早退路径为空数组(渲染层可无脑遍历) */
  results: PerAccountResult[]
}

export async function runSubscriptionCheck(trigger: 'auto' | 'manual', deps: RunCheckDeps): Promise<RunCheckResult> {
  const { subs, settings, list, downloadRefs } = deps
  const check = deps.check ?? checkSubscriptions
  const emit = () => deps.onEmit?.()
  const now = () => Date.now()

  if (!list) {
    await deps.log({ time: now(), trigger, accounts: 0, newFound: 0, failed: 0, note: 'no-session' })
    emit(); return { accounts: 0, newFound: 0, failed: 0, note: 'no-session', authExpired: true, results: [] }
  }
  const accounts = (await subs.list()).filter((a) => a.subscribed)
    // fakeids 按身份归一比对：CLI `subscription list` 输出 MP_WXS_ 形态，磁盘里可能是
    // base64 等历史形态——字面比对永远不中（--accounts 报 accounts:0）。
    .filter((a) => (deps.fakeids
      ? deps.fakeids.some((f) => normalizeAccountKey(f) === normalizeAccountKey(a.fakeid))
      : true))
  if (!accounts.length) {
    await subs.setLastRunAt(now())
    await deps.log({ time: now(), trigger, accounts: 0, newFound: 0, failed: 0, note: 'no-accounts' })
    emit(); return { accounts: 0, newFound: 0, failed: 0, note: 'no-accounts', authExpired: false, results: [] }
  }
  let results
  try { results = await check(accounts, { list }) }
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
  // M56:下载交付明细与「刚下载/文库已有」合计 —— 明细收集对 trigger 无感(auto/manual/行内子集同一代码路径)。
  // 计数与明细同源(四状态),汇总数永远与逐号明细对得上;仅 download 策略会填充。
  const downloadLogs: AccountDownloadLog[] = []
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
    const account = accounts.find((a) => a.fakeid === r.fakeid)
    const downloadedPendingIds: string[] = []
    if (account && deps.isRefDownloaded) {
      for (const pending of account.newRefs) {
        if (await deps.isRefDownloaded(pending)) downloadedPendingIds.push(refId(pending))
      }
      if (downloadedPendingIds.length) await subs.removeNewRefs(r.fakeid, downloadedPendingIds)
    }
    const migratedDuplicate = !!(r.latestArticleId && !account?.latestArticleId && r.newRefs.length === 1
      && await deps.isRefDownloaded?.(r.newRefs[0]))
    const newRefs = migratedDuplicate ? [] : r.newRefs
    await subs.updateWatermark(r.fakeid, r.latest, r.latestArticleId)
    if (newRefs.length === 0) {
      perAccount.push({ fakeid: r.fakeid, nickname, ok: true, newFound: 0, downloaded: 0 })
      continue
    }
    newFound += newRefs.length
    const total = newRefs.length
    let downloaded = 0
    let articles: DownloadItemLog[] | undefined
    if (settings.subscriptionNewArticleAction === 'download') {
      // 自动下载的进度此前完全不可见(手动下载有进度条,自动下载连一条事件都不发)
      deps.onDownloadProgress?.({ fakeid: r.fakeid, total, done: 0, phase: 'start' })
      const summary = await downloadRefs(newRefs, settings.defaultFormats,
        { kind: 'account', nickname, fakeid: r.fakeid, range: { count: total } },
        (e) => deps.onDownloadProgress?.({ fakeid: r.fakeid, total, done: e.completed, phase: e.phase }))
      deps.onDownloadProgress?.({ fakeid: r.fakeid, total, done: total, phase: 'done' })
      // 真故障(网络/频控)留在待处理里等重试:此前无脑 clear,自动下载失败的文章就此消失,
      // 而自动模式下用户根本没看着屏幕,连「刚才失败了」都不知道。
      // 读者本就打不开的(unavailable)不留 —— 重试无用,留着只会变成永远清不掉的红点。
      const doneUrls = new Set(summary.items.filter((i) => i.ok || i.unavailable).map((i) => i.url))
      const kept = newRefs.filter((x) => !doneUrls.has(x.url))
      if (kept.length) await subs.setPendingRefs(r.fakeid, kept)
      else await subs.clearNewRefs(r.fakeid)
      // M56:明细一次收集两处消费——downloadDetail 落盘(检查记录),articles 挂行结果(GUI/CLI 透传)
      const detail = toAccountDownloadLog({ fakeid: r.fakeid, nickname, refs: newRefs }, summary)
      downloadLogs.push(detail)
      downloaded = summary.succeeded
      articles = detail.items
    } else {
      await subs.addNewRefs(r.fakeid, newRefs)
    }
    perAccount.push({ fakeid: r.fakeid, nickname, ok: true, newFound: total, downloaded, ...(articles !== undefined ? { articles } : {}) })
  }
  await subs.setLastRunAt(now())
  // M56:有下载动作(downloadLogs 非空)才写交付字段;提示策略保持缺省而非 0 ——「没下载」和「下载了 0 篇」是两回事。
  const { downloaded: downloadedTotal, existed: existedTotal } = countDownloadOutcomes(downloadLogs)
  await deps.log({
    time: now(), trigger, accounts: accounts.length, newFound, failed,
    ...(failures.length ? { failures } : {}),
    ...(downloadLogs.length
      ? { kind: 'check' as const, downloaded: downloadedTotal, existed: existedTotal, downloadDetail: downloadLogs }
      : {}),
  })
  emit(); return { accounts: accounts.length, newFound, failed, ...(failures.length ? { failures } : {}), authExpired: false, results: perAccount }
}

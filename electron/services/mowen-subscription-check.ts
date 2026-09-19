// electron/services/mowen-subscription-check.ts
// 墨问订阅检查编排（M63）。对齐 subscription-check.ts 的依赖注入模式：无 electron 运行时，
// GUI 与 CLI 共用，可单测。失败保留失败类型（宪法）：单作者失败归集该作者名下、水位不动；
// mocli 不可用如实 mocli-missing，不得伪装「无新笔记」。检查深度固定 count=20，全量比对
// （真机实证 note_ids 非严格 publicAt 倒序，「遇旧提前停」不安全——2026-09-13）。
import { listUserNotes } from '../../src/core/mowen/metadata'
import { MowenNoteUnavailable } from '../../src/core/mowen/errors'
import type { MocliRunner } from '../../src/core/mowen/types'
import type { MowenSubscriptions } from '../../src/core/mowen/subscription'
import { diffNewNotes, mergeNewNotes } from '../../src/core/mowen/subscription'
import type { CheckLogEntry, CheckFailure, AccountDownloadLog, DownloadItemLog } from '../../src/core/subscriptions'
import { countDownloadOutcomes } from '../../src/core/subscription-batch'
import type { DownloadItemResult } from '../../src/core/types'
import type { AppSettings } from './settings'

const CHECK_COUNT = 20

/**
 * 调度闸门：没有已订阅作者时直接 false、不碰 mocli 探测。探测链未装 mocli 时以
 * login shell（`$SHELL -ilc`，最多 3s）兜底——调度器每分钟 tick 都先过 canRun，
 * 无此闸门的话纯微信用户（零墨问订阅、未装 mocli）开着 app 就每分钟白 spawn 一个
 * 登录 shell。订阅与否读本地 JSON（廉价），探测只在真有订阅对象时发生。
 */
export async function mowenSchedulerCanRun(
  subs: Pick<MowenSubscriptions, 'list'>,
  probe: () => Promise<boolean>,
): Promise<boolean> {
  const authors = await subs.list()
  if (!authors.some((a) => a.subscribed)) return false
  return probe()
}

export interface MowenCheckDeps {
  subs: MowenSubscriptions
  /** null = mocli 不可用（未装/检测失败）→ mocli-missing 早退，不伪装「无新笔记」 */
  runner: MocliRunner | null
  /** 与微信共用的检查日志通道（ipc.ts 组装，写 checkLog 数组 + 行日志文件） */
  log: (entry: CheckLogEntry) => Promise<void>
  settings: Pick<AppSettings, 'subscriptionNewArticleAction' | 'defaultFormats'>
  /** 单篇下载注入点：调用方组装 downloadMowenNote（含 library 判重/图片本地化全链路） */
  downloadNote: (noteId: string) => Promise<DownloadItemResult>
  /** 注入点，缺省真实现 */
  listUserNotes?: typeof listUserNotes
  /** 行内单作者检查：只查这些 uid（缺省全量）。 */
  uids?: string[]
}

export interface MowenPerAuthorResult {
  uid: string; name: string; ok: boolean
  newFound: number; downloaded: number; existed: number; unavailable: number
  error?: string
  /** 非失败注记：如「N 篇缺少发布时间未参与水位比对」 */
  warn?: string
}
export interface MowenCheckResult {
  authors: number; newFound: number; failed: number
  note?: 'mocli-missing' | 'no-authors'
  results: MowenPerAuthorResult[]
}

export async function runMowenSubscriptionCheck(trigger: 'auto' | 'manual', deps: MowenCheckDeps): Promise<MowenCheckResult> {
  const list = deps.listUserNotes ?? listUserNotes
  const now = Date.now()
  const baseLog = { trigger, platform: 'mowen' as const, time: now }
  const authors = (await deps.subs.list()).filter((a) => a.subscribed)
    .filter((a) => (deps.uids ? deps.uids.includes(a.uid) : true))

  if (!authors.length) {
    await deps.log({ ...baseLog, accounts: 0, newFound: 0, failed: 0, note: 'no-authors' })
    return { authors: 0, newFound: 0, failed: 0, note: 'no-authors', results: [] }
  }
  if (!deps.runner) {
    // mocli 缺失 = 该平台本轮检查全部失败；水位一律不动；失败明细进日志（检查记录可见）
    const failures: CheckFailure[] = authors.map((a) => ({ nickname: a.name, error: '未检测到 mocli' }))
    await deps.log({ ...baseLog, accounts: authors.length, newFound: 0, failed: authors.length, failures })
    return {
      authors: authors.length, newFound: 0, failed: authors.length, note: 'mocli-missing',
      results: authors.map((a) => ({ uid: a.uid, name: a.name, ok: false, newFound: 0, downloaded: 0, existed: 0, unavailable: 0, error: '未检测到 mocli' })),
    }
  }

  let newFound = 0, failed = 0
  const failures: CheckFailure[] = []
  const results: MowenPerAuthorResult[] = []
  const downloadLogs: AccountDownloadLog[] = []
  // 平台级防重入时刻：与微信 lastRunAt 同思路，scheduler 据此跳过重复触发
  await deps.subs.setLastRunAt(now)
  for (const a of authors) {
    try {
      const items = await list(deps.runner, a.uid, { count: CHECK_COUNT })
      const { fresh, undated } = diffNewNotes(items, a.watermark)
      // 本地合并拿「全量 pending 集」：新发现 + 上轮遗留 pending（如上次下载失败）一并按策略交付
      const merged = mergeNewNotes(a.newNotes, fresh)
      await deps.subs.appendNewNotes(a.uid, fresh.map((f) => ({ noteId: f.noteId, title: f.title, publicAt: f.publicAt, url: f.url, status: 'pending' as const })))
      // 水位推进 = 本轮见到的最大 publicAt（与已有水位取大）；检查成功才走到这里
      const maxPublicAt = items.reduce<number>((m, it) => (it.publicAt != null && it.publicAt > m ? it.publicAt : m), a.watermark)
      await deps.subs.updateWatermark(a.uid, maxPublicAt)
      await deps.subs.setLastCheckedAt(a.uid, Date.now())

      let downloaded = 0, existed = 0, unavailable = 0
      const pending = merged.filter((n) => n.status === 'pending')
      // 逐篇明细（M63 对齐微信 M56/M58）：download 策略落真实交付四态，notify 策略落 pending，
      // 无新文章落空 items——GUI 行内「本轮检查文章列表」与检查记录弹窗同源消费。
      // articleId 直接构造（mowen_<noteId> 主键确定性，点标题直开阅读器），不需要微信那套跨形态反查。
      const logItems: DownloadItemLog[] = []
      if (deps.settings.subscriptionNewArticleAction === 'download' && pending.length) {
        for (const n of pending) {
          try {
            const r = await deps.downloadNote(n.noteId)
            if (r.skipped) existed++; else downloaded++
            await deps.subs.setNoteStatus(a.uid, [n.noteId], 'downloaded')
            logItems.push({ title: n.title || '(无标题)', status: r.skipped ? 'exists' : 'downloaded', ...(r.id ? { articleId: r.id } : {}), url: n.url, refId: n.noteId })
          } catch (e) {
            if (e instanceof MowenNoteUnavailable) {
              // 付费/不可见：保持 pending（重试无用但不伪装成功），明细如实
              unavailable++
              logItems.push({ title: n.title || '(无标题)', status: 'unavailable', url: n.url, refId: n.noteId })
            } else {
              // 真故障：保持 pending 等重试，不中断本作者其余篇目（对齐微信「failed 留在待处理」）
              logItems.push({ title: n.title || '(无标题)', status: 'failed', error: e instanceof Error ? e.message : String(e), url: n.url, refId: n.noteId })
            }
          }
        }
      } else {
        for (const n of pending) logItems.push({ title: n.title || '(无标题)', status: 'pending' as const, url: n.url, refId: n.noteId })
      }
      downloadLogs.push({ fakeid: a.uid, nickname: a.name, items: logItems })
      newFound += pending.length
      results.push({
        uid: a.uid, name: a.name, ok: true, newFound: pending.length, downloaded, existed, unavailable,
        ...(undated.length ? { warn: `${undated.length} 篇笔记缺少发布时间，未参与水位比对` } : undefined),
      })
    } catch (e) {
      failed++
      const error = e instanceof Error ? e.message : String(e)
      failures.push({ nickname: a.name, error })
      results.push({ uid: a.uid, name: a.name, ok: false, newFound: 0, downloaded: 0, existed: 0, unavailable: 0, error })
    }
  }
  // 交付字段只在有下载动作时写（「没下载」和「下载了 0 篇」是两回事，微信同规）；
  // downloadDetail 全号落条目（含空 items），供行内明细与弹窗消费。
  const { downloaded: downloadedTotal, existed: existedTotal } = countDownloadOutcomes(downloadLogs)
  const didDownload = downloadLogs.some((d) => d.items.some((i) => i.status !== 'pending'))
  await deps.log({
    ...baseLog, accounts: authors.length, newFound, failed,
    ...(failures.length ? { failures } : {}),
    ...(downloadLogs.length ? { downloadDetail: downloadLogs } : {}),
    ...(didDownload ? { kind: 'check' as const, downloaded: downloadedTotal, existed: existedTotal } : {}),
  })
  return { authors: authors.length, newFound, failed, results }
}

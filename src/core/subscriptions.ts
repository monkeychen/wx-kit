// src/core/subscriptions.ts
// 公众号订阅存储（库根下 subscriptions.json）+ 派生/合并纯函数。仿 download-history 的文件读写。
import { readFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWriteFile } from './atomic-write'
import { withPathLock } from './path-lock'
import type { ArticleRef } from './mp-types'
import { mergeNewRefs, removeRefs } from './subscription-refs'
// normalizeAccountKey 已挪到 ./weread/book-id（零 node 依赖的纯函数模块）——渲染层会直接
// import 它，不能经由本模块（本模块依赖 node:fs，vite-plugin-electron-renderer 会把 node
// 内建摇进渲染 bundle，沙箱页面无 require 即崩）。此处 import 供本模块内部使用，向下
// re-export 维持 electron/CLI/测试侧既有 import 路径不变（M56 T4 fix）。
import { normalizeAccountKey } from './weread/book-id'
export { normalizeAccountKey }
import type { HistoryEvent } from './download-history'
import type { DownloadItemResult } from './types'

export interface SubscribedAccount {
  fakeid: string
  nickname: string
  subscribed: boolean
  watermark: number            // unix 秒；createTime > watermark 即「新」
  /** latest-only 来源（当前为微信读书 cover）的最近已见文章身份；旧文件缺省为 null。 */
  latestArticleId?: string | null
  lastCheckedAt: number | null // unix ms
  newRefs: ArticleRef[]        // 已发现、待下载/忽略的新文章
}

export interface CheckFailure { nickname: string; error: string }

/** 逐篇下载结果（M56）。状态：刚下载 / 文库已有 / 真故障 / 读者不可见；M58 增加 pending（提示策略检查后的未下载态）。 */
export interface DownloadItemLog {
  title: string
  status: 'downloaded' | 'exists' | 'failed' | 'unavailable' | 'pending'
  error?: string              // 仅 failed：失败原因（error.message）
  articleId?: string          // M58：文库条目 id（downloaded/exists 时回填）——行内点标题直开阅读器
  url?: string                // M58：原文链接（检查时从 ArticleRef 带出）——未下载时点标题开浏览器
  refId?: string              // M58：待处理主键（与 newRefs 的 refId 同值）——单篇/勾选下载的入参
}
export interface AccountDownloadLog { fakeid: string; nickname: string; items: DownloadItemLog[] }

export interface CheckLogEntry {
  time: number                       // unix ms
  trigger: 'auto' | 'manual'
  accounts: number                   // 本次检查的订阅号数
  newFound: number                   // 发现的新文章总数
  failed: number                     // 失败的号数
  failures?: CheckFailure[]          // 逐号失败明细（v0.5.4 起;旧条目无此字段）
  note?: string                      // 特殊情形：'no-session' | 'auth-expired' | 'no-accounts'
  /** M56：'check'=检查（可含自动下载交付）；'download'=纯交付（手动批量补下载）。缺省 'check'=旧数据兼容。 */
  kind?: 'check' | 'download'
  downloaded?: number                // 刚下载篇数（不含 exists——不把「文库已有」伪装成「刚下载」）
  existed?: number                   // 文库已有篇数
  downloadDetail?: AccountDownloadLog[] // 有下载动作才写；不进单行日志，明细走弹窗/CLI
}

/** 落盘日志的一行（人类可读）。纯函数。旧条目（无 M56 字段）输出逐字节不变。 */
export function formatCheckLogLine(e: CheckLogEntry): string {
  const label = e.kind === 'download' ? 'DOWNLOAD' : e.trigger === 'auto' ? 'AUTO' : 'MANUAL'
  let line = `[${new Date(e.time).toISOString()}] ${label} accounts=${e.accounts} new=${e.newFound} failed=${e.failed}`
  if (e.note) line += ` note=${e.note}`
  if (e.failures?.length) line += ` [${e.failures.map((f) => `${f.nickname}: ${f.error}`).join('; ')}]`
  if (e.downloaded !== undefined) line += ` downloaded=${e.downloaded}`
  if (e.existed !== undefined) line += ` existed=${e.existed}`
  return line
}

/**
 * DownloadItemResult → 下载日志条目（M56）。纯函数。
 * 判定：ok&&!skipped→downloaded；ok&&skipped→exists；!ok&&unavailable→unavailable；其余→failed。
 * 标题 item.title 优先，缺省时按 url 从 refs 补（列表本来就给标题），两者都无则空串。
 * cancelled 的条目未尝试下载、没有下载动作，不产出日志。
 */
export function toDownloadItemLogs(
  items: DownloadItemResult[],
  refs: { url: string; title: string; refId?: string; articleId?: string }[],
): AccountDownloadLog['items'] {
  const byUrl = new Map(refs.map((r) => [r.url, r] as const))
  const logs: DownloadItemLog[] = []
  for (const item of items) {
    if (item.cancelled) continue
    let status: DownloadItemLog['status']
    if (item.ok && !item.skipped) status = 'downloaded'
    else if (item.ok && item.skipped) status = 'exists'
    else if (!item.ok && item.unavailable) status = 'unavailable'
    else status = 'failed'
    const ref = byUrl.get(item.url)
    const log: DownloadItemLog = { title: item.title ?? ref?.title ?? '', status, url: item.url, ...(ref?.refId ? { refId: ref.refId } : {}), ...(ref?.articleId ? { articleId: ref.articleId } : {}) }
    if (status === 'failed' && item.error?.message != null) log.error = item.error.message
    logs.push(log)
  }
  return logs
}

interface SubscriptionsFile { version: 1; lastRunAt: number | null; accounts: SubscribedAccount[]; checkLog: CheckLogEntry[]; removedFakeids?: string[] }

/**
 * 新订阅的初始水位。取最新一篇 createTime 减 1 秒，让最新一篇能在首次检查时被投递
 * （检查用严格 `createTime > watermark`，若水位恰好等于最新一篇的 createTime，它会卡在
 * 边界上被永久滤掉——用户正是拿那篇文章来订阅的，首检却显示「没有新文章」）。
 * 取不到最新一篇时用「现在」，避免把全部存量当新文章回灌。
 */
export function initialWatermark(latestCreateTime: number | null | undefined, nowSec: number): number {
  return latestCreateTime != null ? latestCreateTime - 1 : nowSec
}

/** 从下载历史抽出去重的「按公众号抓取」账号（fakeid → nickname，后出现的昵称覆盖）。纯函数。 */
export function accountsFromHistory(events: HistoryEvent[]): { fakeid: string; nickname: string }[] {
  const seen = new Map<string, string>()
  for (const ev of events) {
    if (ev.source.kind === 'account') seen.set(normalizeAccountKey(ev.source.fakeid), ev.source.nickname)
  }
  return [...seen.entries()].map(([fakeid, nickname]) => ({ fakeid, nickname }))
}

/** 合并「历史派生账号」与「已存订阅」：已存的保留其状态；仅在历史里的补成未订阅空态；被显式删除过的不出现。纯函数。 */
export function mergeAccounts(
  fromHistory: { fakeid: string; nickname: string }[], stored: SubscribedAccount[], removedFakeids: string[] = [],
): SubscribedAccount[] {
  const removed = new Set(removedFakeids.map(normalizeAccountKey))
  const byId = new Map<string, SubscribedAccount>()
  for (const a of stored) {
    const key = normalizeAccountKey(a.fakeid)
    if (!removed.has(key)) byId.set(key, a)
  }
  for (const h of fromHistory) {
    const key = normalizeAccountKey(h.fakeid)
    if (removed.has(key)) continue
    if (!byId.has(key)) {
      byId.set(key, { fakeid: key, nickname: h.nickname, subscribed: false, watermark: 0, lastCheckedAt: null, newRefs: [] })
    }
  }
  return [...byId.values()]
}

export class Subscriptions {
  private path: string
  constructor(private root: string) { this.path = join(root, 'subscriptions.json') }

  private async read(): Promise<SubscriptionsFile> {
    try {
      return JSON.parse(await readFile(this.path, 'utf-8')) as SubscriptionsFile
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, lastRunAt: null, accounts: [], checkLog: [] }
      throw new Error(`subscriptions file is corrupt at ${this.path} — delete it to reset`)
    }
  }
  private async write(data: SubscriptionsFile): Promise<void> {
    await mkdir(this.root, { recursive: true })
    await atomicWriteFile(this.path, JSON.stringify(data, null, 2))
  }
  private async mutate(fn: (d: SubscriptionsFile) => void): Promise<void> {
    await withPathLock(this.path, async () => {
      const d = await this.read(); fn(d); await this.write(d)
    })
  }
  private find(d: SubscriptionsFile, fakeid: string): SubscribedAccount | undefined {
    const key = normalizeAccountKey(fakeid)
    return d.accounts.find((a) => normalizeAccountKey(a.fakeid) === key)
  }

  /** 读入时按归一 id 合并重复行（历史双形态遗留）：水位取 max、newRefs 合并、昵称取非空。 */
  async list(): Promise<SubscribedAccount[]> {
    const d = await this.read()
    const byId = new Map<string, SubscribedAccount>()
    for (const a of d.accounts) {
      const key = normalizeAccountKey(a.fakeid)
      const ex = byId.get(key)
      if (!ex) { byId.set(key, { ...a, fakeid: key }); continue }
      ex.watermark = Math.max(ex.watermark, a.watermark)
      ex.newRefs = mergeNewRefs(ex.newRefs, a.newRefs)
      ex.nickname = ex.nickname || a.nickname
      ex.subscribed = ex.subscribed || a.subscribed
      ex.latestArticleId = ex.latestArticleId ?? a.latestArticleId ?? null
      ex.lastCheckedAt = Math.max(ex.lastCheckedAt ?? 0, a.lastCheckedAt ?? 0) || null
    }
    return [...byId.values()]
  }
  async getLastRunAt(): Promise<number | null> { return (await this.read()).lastRunAt }
  async setLastRunAt(t: number): Promise<void> { await this.mutate((d) => { d.lastRunAt = t }) }

  /** 新增或更新账号身份/订阅态/水位；已存则保留 newRefs 与 lastCheckedAt。重新订阅会撤销之前的删除标记。 */
  async addAccount(acc: { fakeid: string; nickname: string; subscribed: boolean; watermark: number }): Promise<void> {
    const key = normalizeAccountKey(acc.fakeid)
    await this.mutate((d) => {
      d.removedFakeids = (d.removedFakeids ?? []).filter((f) => normalizeAccountKey(f) !== key)
      const ex = this.find(d, acc.fakeid)
      if (ex) { ex.nickname = acc.nickname; ex.subscribed = acc.subscribed; ex.watermark = acc.watermark }
      else d.accounts.push({ ...acc, fakeid: key, lastCheckedAt: null, newRefs: [] })
    })
  }

  /**
   * 删除订阅账号：写删除标记 + 从 accounts 移除。删除标记必须持久化——
   * 下载历史派生的行（mergeAccounts）否则会在下次 list 时原样回来，删了等于没删。
   */
  async removeAccount(fakeid: string): Promise<void> {
    const key = normalizeAccountKey(fakeid)
    await this.mutate((d) => {
      d.accounts = d.accounts.filter((a) => normalizeAccountKey(a.fakeid) !== key)
      d.removedFakeids = [...new Set([...(d.removedFakeids ?? []), key])]
    })
  }

  /** mergeAccounts 用：这些账号被用户显式删除过，即使下载历史里还有也不应再出现。 */
  async removedFakeids(): Promise<string[]> {
    return (await this.read()).removedFakeids ?? []
  }

  async setSubscribed(fakeid: string, subscribed: boolean): Promise<void> {
    await this.mutate((d) => { const a = this.find(d, fakeid); if (a) a.subscribed = subscribed })
  }
  /**
   * 检查成功后推进水位，并一并记下「这个号什么时候查过」。
   * 水位只在检查成功时推进，故这里就是「已成功检查」的唯一时点；
   * 此前 lastCheckedAt 只在 setNewRefs 里写 → 自动下载模式和「无新文章」永远不写，
   * 页面于是显示「尚未检查」而右边同时显示检查结果，自相矛盾（M34 修）。
   */
  async updateWatermark(fakeid: string, watermark: number, latestArticleId?: string): Promise<void> {
    await this.mutate((d) => {
      const a = this.find(d, fakeid)
      if (a) {
        a.watermark = watermark
        if (latestArticleId != null) a.latestArticleId = latestArticleId
        a.lastCheckedAt = Date.now()
      }
    })
  }
  /**
   * 把本轮发现的新文章**并入**待处理列表(M40)。
   * 曾是整体覆盖 —— 用户留着没处理的会被下一轮检查冲掉,那是静默丢数据。
   */
  async addNewRefs(fakeid: string, refs: ArticleRef[]): Promise<void> {
    await this.mutate((d) => {
      const a = this.find(d, fakeid)
      if (a) { a.newRefs = mergeNewRefs(a.newRefs, refs); a.lastCheckedAt = Date.now() }
    })
  }
  /** 直接把待处理列表设成给定的几篇(自动下载后只留下没下成的那些)。 */
  async setPendingRefs(fakeid: string, refs: ArticleRef[]): Promise<void> {
    await this.mutate((d) => { const a = this.find(d, fakeid); if (a) a.newRefs = refs })
  }
  /** 移除指定的几篇(下载完/忽略掉的);未列出的仍留在待处理里。 */
  async removeNewRefs(fakeid: string, ids: string[]): Promise<void> {
    await this.mutate((d) => { const a = this.find(d, fakeid); if (a) a.newRefs = removeRefs(a.newRefs, ids) })
  }
  async clearNewRefs(fakeid: string): Promise<void> {
    await this.mutate((d) => { const a = this.find(d, fakeid); if (a) a.newRefs = [] })
  }
  async getCheckLog(): Promise<CheckLogEntry[]> { return (await this.read()).checkLog ?? [] }
  async appendCheckLog(entry: CheckLogEntry, keep = 50): Promise<void> {
    await this.mutate((d) => { d.checkLog = [entry, ...(d.checkLog ?? [])].slice(0, keep) })
  }

  /**
   * 原子更新「最新一条含该号条目」的检查明细（M58）：下载动作完成后把对应文章的
   * pending 状态改写为结果态。只动最新命中的一条（它是「本轮状态面板」），历史条目不动。
   * 返回是否命中该号。
   */
  async mutateLatestCheckDetail(
    fakeid: string,
    fn: (items: AccountDownloadLog['items']) => AccountDownloadLog['items'],
  ): Promise<boolean> {
    let hit = false
    await this.mutate((d) => {
      for (const entry of d.checkLog ?? []) {
        const target = entry.downloadDetail?.find((x) => x.fakeid === fakeid)
        if (!target) continue
        target.items = fn(target.items)
        hit = true
        break
      }
    })
    return hit
  }
}

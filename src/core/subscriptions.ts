// src/core/subscriptions.ts
// 公众号订阅存储（库根下 subscriptions.json）+ 派生/合并纯函数。仿 download-history 的文件读写。
import { readFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWriteFile } from './atomic-write'
import { withPathLock } from './path-lock'
import type { ArticleRef } from './mp-types'
import { mergeNewRefs, removeRefs } from './subscription-refs'
import { normalizeAccountId } from './weread/book-id'
import type { HistoryEvent } from './download-history'

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

export interface CheckLogEntry {
  time: number                       // unix ms
  trigger: 'auto' | 'manual'
  accounts: number                   // 本次检查的订阅号数
  newFound: number                   // 发现的新文章总数
  failed: number                     // 失败的号数
  failures?: CheckFailure[]          // 逐号失败明细（v0.5.4 起;旧条目无此字段）
  note?: string                      // 特殊情形：'no-session' | 'auth-expired' | 'no-accounts'
}

/** 落盘日志的一行（人类可读）。纯函数。 */
export function formatCheckLogLine(e: CheckLogEntry): string {
  let line = `[${new Date(e.time).toISOString()}] ${e.trigger === 'auto' ? 'AUTO' : 'MANUAL'} accounts=${e.accounts} new=${e.newFound} failed=${e.failed}`
  if (e.note) line += ` note=${e.note}`
  if (e.failures?.length) line += ` [${e.failures.map((f) => `${f.nickname}: ${f.error}`).join('; ')}]`
  return line
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

/**
 * 账号标识归一：v0.8.x 下载历史里是 base64 fakeid（如 MzE5ODk2NjUwOA==），v0.10.0 起是
 * `MP_WXS_<数字>`。同一公众号两种形态会在订阅列表里呈现为「同名重复行」（用户实测踩到），
 * 故所有入口统一归一到 MP_WXS_ 形态；无法归一的非法形态原样保留，不让脏数据炸掉列表。
 */
export function normalizeAccountKey(fakeid: string): string {
  try { return normalizeAccountId(fakeid) } catch { return fakeid }
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
}

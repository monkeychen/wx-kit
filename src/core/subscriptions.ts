// src/core/subscriptions.ts
// 公众号订阅存储（库根下 subscriptions.json）+ 派生/合并纯函数。仿 download-history 的文件读写。
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { ArticleRef } from './mp-types'
import type { HistoryEvent } from './download-history'

export interface SubscribedAccount {
  fakeid: string
  nickname: string
  subscribed: boolean
  watermark: number            // unix 秒；createTime > watermark 即「新」
  lastCheckedAt: number | null // unix ms
  newRefs: ArticleRef[]        // 已发现、待下载/忽略的新文章
}

export interface CheckLogEntry {
  time: number                       // unix ms
  trigger: 'auto' | 'manual'
  accounts: number                   // 本次检查的订阅号数
  newFound: number                   // 发现的新文章总数
  failed: number                     // 失败的号数
  note?: string                      // 特殊情形：'no-session' | 'auth-expired' | 'no-accounts'
}

/** 落盘日志的一行（人类可读）。纯函数。 */
export function formatCheckLogLine(e: CheckLogEntry): string {
  const base = `[${new Date(e.time).toISOString()}] ${e.trigger === 'auto' ? 'AUTO' : 'MANUAL'} accounts=${e.accounts} new=${e.newFound} failed=${e.failed}`
  return e.note ? `${base} note=${e.note}` : base
}

interface SubscriptionsFile { version: 1; lastRunAt: number | null; accounts: SubscribedAccount[]; checkLog: CheckLogEntry[] }

/** 从下载历史抽出去重的「按公众号抓取」账号（fakeid → nickname，后出现的昵称覆盖）。纯函数。 */
export function accountsFromHistory(events: HistoryEvent[]): { fakeid: string; nickname: string }[] {
  const seen = new Map<string, string>()
  for (const ev of events) {
    if (ev.source.kind === 'account') seen.set(ev.source.fakeid, ev.source.nickname)
  }
  return [...seen.entries()].map(([fakeid, nickname]) => ({ fakeid, nickname }))
}

/** 合并「历史派生账号」与「已存订阅」：已存的保留其状态；仅在历史里的补成未订阅空态。纯函数。 */
export function mergeAccounts(
  fromHistory: { fakeid: string; nickname: string }[], stored: SubscribedAccount[],
): SubscribedAccount[] {
  const byId = new Map<string, SubscribedAccount>()
  for (const a of stored) byId.set(a.fakeid, a)
  for (const h of fromHistory) {
    if (!byId.has(h.fakeid)) {
      byId.set(h.fakeid, { fakeid: h.fakeid, nickname: h.nickname, subscribed: false, watermark: 0, lastCheckedAt: null, newRefs: [] })
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
    await writeFile(this.path, JSON.stringify(data, null, 2), 'utf-8')
  }
  private async mutate(fn: (d: SubscriptionsFile) => void): Promise<void> {
    const d = await this.read(); fn(d); await this.write(d)
  }
  private find(d: SubscriptionsFile, fakeid: string): SubscribedAccount | undefined {
    return d.accounts.find((a) => a.fakeid === fakeid)
  }

  async list(): Promise<SubscribedAccount[]> { return (await this.read()).accounts }
  async getLastRunAt(): Promise<number | null> { return (await this.read()).lastRunAt }
  async setLastRunAt(t: number): Promise<void> { await this.mutate((d) => { d.lastRunAt = t }) }

  /** 新增或更新账号身份/订阅态/水位；已存则保留 newRefs 与 lastCheckedAt。 */
  async addAccount(acc: { fakeid: string; nickname: string; subscribed: boolean; watermark: number }): Promise<void> {
    await this.mutate((d) => {
      const ex = this.find(d, acc.fakeid)
      if (ex) { ex.nickname = acc.nickname; ex.subscribed = acc.subscribed; ex.watermark = acc.watermark }
      else d.accounts.push({ ...acc, lastCheckedAt: null, newRefs: [] })
    })
  }
  async setSubscribed(fakeid: string, subscribed: boolean): Promise<void> {
    await this.mutate((d) => { const a = this.find(d, fakeid); if (a) a.subscribed = subscribed })
  }
  async updateWatermark(fakeid: string, watermark: number): Promise<void> {
    await this.mutate((d) => { const a = this.find(d, fakeid); if (a) a.watermark = watermark })
  }
  async setNewRefs(fakeid: string, refs: ArticleRef[]): Promise<void> {
    await this.mutate((d) => { const a = this.find(d, fakeid); if (a) { a.newRefs = refs; a.lastCheckedAt = Date.now() } })
  }
  async clearNewRefs(fakeid: string): Promise<void> {
    await this.mutate((d) => { const a = this.find(d, fakeid); if (a) a.newRefs = [] })
  }
  async getCheckLog(): Promise<CheckLogEntry[]> { return (await this.read()).checkLog ?? [] }
  async appendCheckLog(entry: CheckLogEntry, keep = 50): Promise<void> {
    await this.mutate((d) => { d.checkLog = [entry, ...(d.checkLog ?? [])].slice(0, keep) })
  }
}

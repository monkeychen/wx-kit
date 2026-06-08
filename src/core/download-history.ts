// src/core/download-history.ts
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { DownloadFormat, DownloadSummary } from './types'
import type { CrawlRange } from './mp-types'

export const DEFAULT_RETENTION_DAYS = 365
const DAY_MS = 86_400_000

export type HistorySource =
  | { kind: 'url'; count: number }
  | { kind: 'account'; nickname: string; fakeid: string; range: CrawlRange }

export type HistoryItemStatus = 'ok' | 'skipped' | 'failed'

export interface HistoryItem {
  id?: string                 // 库内文章 id；文库删除联动后置空
  url: string
  title: string               // 下载时已知；失败时回退 url
  dir?: string                // 文章目录（用于「在文件夹显示」）
  status: HistoryItemStatus
  formats?: DownloadFormat[]   // 该篇实际产出格式
  error?: string
  deleted?: boolean            // 原文已从文库删除
}

export interface HistoryEvent {
  id: string
  time: number                 // unix ms
  source: HistorySource
  formats: DownloadFormat[]    // 本次所选格式
  total: number
  succeeded: number
  skipped: number
  failed: number
  items: HistoryItem[]
}

interface HistoryFile { version: number; events: HistoryEvent[] }

/** 裁掉超过保留期的 event，并按时间倒序（最新在前）。纯函数。 */
export function pruneEvents(events: HistoryEvent[], now: number, retentionDays: number): HistoryEvent[] {
  const cutoff = now - retentionDays * DAY_MS
  return events.filter((e) => e.time >= cutoff).sort((a, b) => b.time - a.time)
}

/** 由一次下载的 DownloadSummary 组装成历史 event。纯函数。 */
export function eventFromSummary(
  id: string,
  time: number,
  source: HistorySource,
  formats: DownloadFormat[],
  s: DownloadSummary,
): HistoryEvent {
  const items: HistoryItem[] = s.items.map((it) => ({
    id: it.id,
    url: it.url,
    title: it.title || it.url,
    dir: it.dir,
    status: it.skipped ? 'skipped' : it.ok ? 'ok' : 'failed',
    formats: it.formats,
    error: it.error?.message,
  }))
  return {
    id, time, source, formats,
    total: s.total, succeeded: s.succeeded, skipped: s.skipped, failed: s.failed,
    items,
  }
}

/** 下载历史索引（库根下的 history.json）。仿 Library 的文件读写。 */
export class History {
  private path: string
  constructor(private root: string, private retentionDays = DEFAULT_RETENTION_DAYS) {
    this.path = join(root, 'history.json')
  }

  private async read(): Promise<HistoryFile> {
    try {
      return JSON.parse(await readFile(this.path, 'utf-8')) as HistoryFile
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, events: [] }
      throw new Error(`download history is corrupt at ${this.path} — delete it to reset`)
    }
  }

  private async write(data: HistoryFile): Promise<void> {
    await mkdir(this.root, { recursive: true })
    await writeFile(this.path, JSON.stringify(data, null, 2), 'utf-8')
  }

  /** 倒序 + 裁过期后切片分页。 */
  async list(offset = 0, limit = 10, now = Date.now()): Promise<{ events: HistoryEvent[]; total: number }> {
    const all = pruneEvents((await this.read()).events, now, this.retentionDays)
    return { events: all.slice(offset, offset + limit), total: all.length }
  }

  async append(ev: HistoryEvent, now = Date.now()): Promise<void> {
    const data = await this.read()
    data.events = pruneEvents([ev, ...data.events], now, this.retentionDays)
    await this.write(data)
  }

  /** 删除单条历史记录（只删记录，不碰文件）。 */
  async removeEvent(id: string): Promise<void> {
    const data = await this.read()
    data.events = data.events.filter((e) => e.id !== id)
    await this.write(data)
  }

  /** 只清动作记录，绝不触碰已下文件与 library.json。 */
  async clear(): Promise<void> {
    await this.write({ version: 1, events: [] })
  }

  /** 文库删除某文章后，把历史里引用它的 item 标记为已删除（保留记录、解除 id 引用）。 */
  async markDeleted(articleId: string): Promise<void> {
    const data = await this.read()
    let touched = false
    for (const ev of data.events) {
      for (const it of ev.items) {
        if (it.id === articleId) { it.deleted = true; it.id = undefined; touched = true }
      }
    }
    if (touched) await this.write(data)
  }
}

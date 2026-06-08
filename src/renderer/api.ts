// src/renderer/api.ts
import type { ArticleMeta, DownloadFormat, DownloadSummary, ProgressEvent } from '../core/types'
import type { AppSettings } from '../../electron/services/settings'
import type { ReadableKind } from '../core/read-article'
import type { MpAccount, CrawlSummary, CrawlItemStatus } from '../core/mp-types'
import type { HistoryEvent } from '../core/download-history'

export type { HistoryEvent } from '../core/download-history'

export interface CrawlRangeInput { count?: number; from?: string; to?: string }
export type CrawlEvent =
  | { kind: 'listed'; items: { title: string; url: string }[] }
  | { kind: 'item'; index: number; status: CrawlItemStatus; error?: string }
  | { kind: 'done'; summary: CrawlSummary }

export interface WxApi {
  download(urls: string[], formats: DownloadFormat[]): Promise<DownloadSummary>
  onDownloadProgress(cb: (e: ProgressEvent) => void): () => void
  libraryList(): Promise<ArticleMeta[]>
  librarySearch(keyword: string): Promise<ArticleMeta[]>
  libraryRemove(id: string): Promise<void>
  /** 返回文章目录内封面文件名（cover.<ext>），无则 null。用于书架缩略图。 */
  coverName(dir: string): Promise<string | null>
  readContent(dir: string, kind: ReadableKind): Promise<string>
  getSettings(): Promise<AppSettings>
  saveSettings(patch: Partial<AppSettings>): Promise<AppSettings>
  chooseDir(): Promise<string | null>
  reveal(path: string): Promise<void>
  // —— M3.5 批量爬取 ——
  mpAuthStatus(): Promise<{ valid: boolean }>
  mpLogin(): Promise<{ ok: boolean; error?: string }>
  mpSearch(name: string): Promise<{ ok: boolean; list?: MpAccount[]; error?: { code: string; message: string } }>
  mpCrawl(fakeid: string, nickname: string, range: CrawlRangeInput, formats: DownloadFormat[]): Promise<CrawlSummary>
  onCrawlProgress(cb: (e: CrawlEvent) => void): () => void
  mpCancelCrawl(): void
  // —— M6 下载历史 ——
  historyList(offset: number, limit: number): Promise<{ events: HistoryEvent[]; total: number }>
  historyClear(): Promise<void>
}

declare global {
  interface Window { api: WxApi }
}

export const api: WxApi = window.api

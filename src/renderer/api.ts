// src/renderer/api.ts
import type { ArticleMeta, DownloadFormat, DownloadSummary, ProgressEvent } from '../core/types'
import type { AppSettings } from '../../electron/services/settings'
import type { ReadableKind } from '../core/read-article'

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
}

declare global {
  interface Window { api: WxApi }
}

export const api: WxApi = window.api

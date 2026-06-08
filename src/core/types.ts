// src/core/types.ts
export type DownloadFormat = 'cover' | 'md' | 'html' | 'pdf' | 'meta'

export const ALL_FORMATS: readonly DownloadFormat[] = ['cover', 'md', 'html', 'pdf', 'meta']

/** 解析微信文章页得到的结构（纯解析产物，未落盘） */
export interface ParsedArticle {
  title: string
  author: string        // 作者署名
  account: string       // 公众号名（用于建目录）
  publishTime: string   // 原始可读时间，解析不到则空串
  digest: string        // 摘要
  coverUrl: string      // 封面图 URL，解析不到则空串
  contentHtml: string   // 清洗后的正文 HTML
  imageUrls: string[]   // 正文中出现的图片 URL（去重、按出现顺序）
}

/** 落盘后一篇文章的元信息，存入 library.json */
export interface ArticleMeta {
  id: string                  // 去重唯一标识
  title: string
  author: string
  account: string
  publishTime: string
  sourceUrl: string
  digest: string
  coverUrl: string
  downloadTime: string        // ISO 8601
  formats: DownloadFormat[]   // 实际生成的格式
  dir: string                 // 文章文件夹绝对路径
}

// M1's DownloadQueue emits only fetch/save/done/failed (queue-level granularity).
// 'images' and 'export' are reserved for M2's finer per-article progress (PRD §8.4).
export type ProgressPhase = 'fetch' | 'images' | 'export' | 'save' | 'done' | 'failed'

export interface ProgressEvent {
  total: number
  completed: number
  currentUrl: string
  currentTitle?: string
  phase: ProgressPhase
  message?: string
}

export interface DownloadItemResult {
  url: string
  ok: boolean
  id?: string
  title?: string              // 文章标题（成功/跳过时已知；失败时缺省）
  dir?: string
  formats?: DownloadFormat[]
  skipped?: boolean           // 命中去重被跳过
  error?: { code: string; message: string }
}

export interface DownloadSummary {
  ok: boolean                 // 全部非失败即 true（含 skipped）
  total: number
  succeeded: number
  failed: number
  skipped: number
  items: DownloadItemResult[]
}

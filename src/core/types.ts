// src/core/types.ts
import type { MpVideoSource } from './parse-video'
export type DownloadFormat = 'cover' | 'md' | 'html' | 'pdf' | 'meta' | 'video'

// 可选格式全集（用于 CLI/设置校验）。**video 刻意不进 settings 的 defaultFormats**：
// 单个视频实测可达 133MB，默认下会拖垮批量抓取，必须由用户/agent 显式选择。
export const ALL_FORMATS: readonly DownloadFormat[] = ['cover', 'md', 'html', 'pdf', 'meta', 'video']

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
  videos: MpVideoSource[] // 内嵌上传视频（mpvideo，已择最高清档）；无视频为 []
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
  /**
   * 内嵌视频明细（有视频才写）。**不存 url**——直链带 auth_key/dis_t 签名有时效，
   * 存下来隔次就失效，只会误导。`path` 为库内相对路径，未下载（没选 video 格式）时缺省。
   */
  videos?: Array<{
    videoId: string; formatId: string
    width: number; height: number; filesize: number; durationMs: number
    path?: string
  }>
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
  cancelled?: boolean         // 因取消而未尝试下载（列表已知标题，可后续单篇补下）
  /** 非致命问题（如视频下载失败）：文章本体成功，但用户/agent 该知道少了什么 */
  warnings?: string[]
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

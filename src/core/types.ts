// src/core/types.ts
import type { MpVideoSource } from './parse-video'
export type DownloadFormat = 'cover' | 'md' | 'html' | 'pdf' | 'meta'

// 格式 = 同一份内容的不同**表现形式**。视频不在其列：它是内容的一部分（和图片一样），
// 有就下、没有就没有——做成格式选项的话，链接是普通文章时那个选项纯属噪音。
// 是否下载视频由设置 downloadVideos 控制（默认开），见 M35 后续修正。
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
  videos: MpVideoSource[] // 内嵌上传视频（mpvideo，已择最高清档）；无视频为 []
  itemShowType: number | null  // 消息类型（0 图文 / 5 视频 / 8 图文消息 / 10 文字 / …）；读不到为 null
  warnings: string[]           // 解析期的非致命问题（未识别类型、正文疑似脚本等）
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
  /** 消息类型（M36）：让「这篇是什么」可查、可筛，也便于日后适配新类型时定位存量 */
  itemShowType?: number
  /**
   * 解析/下载期的非致命告警（M40，有才写）。此前只活在 DownloadItemResult 里，
   * 下载一结束就没了——「下到了但可能不对」是事后最该查得到的信号，必须留痕。
   */
  warnings?: string[]
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
export type ProgressPhase = 'fetch' | 'images' | 'video' | 'export' | 'save' | 'done' | 'failed'

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
  /** 文章本身读者就打不开（审核未通过/已删除/违规下架）——不是下载故障，重试无用 */
  unavailable?: boolean
  error?: { code: string; message: string }
}

export interface DownloadSummary {
  ok: boolean                 // 全部非失败即 true（含 skipped）
  total: number
  succeeded: number
  failed: number
  skipped: number
  /** failed 中属于「读者本就打不开」的篇数;剩下的才是真故障 */
  unavailable?: number
  items: DownloadItemResult[]
}

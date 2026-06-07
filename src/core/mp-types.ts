// src/core/mp-types.ts
export interface MpSession {
  token: string
  cookies: { name: string; value: string }[]
  timestamp: number
}

export interface MpJson {
  base_resp?: { ret: number; err_msg?: string }
  [k: string]: unknown
}

/** 唯一外部副作用入口：发一个带鉴权的 GET，返回解析后的 JSON。纯逻辑只依赖它。 */
export type MpFetch = (endpoint: string, params: Record<string, string>) => Promise<MpJson>

export interface MpAccount { fakeid: string; nickname: string; alias: string; signature: string }

/** 列表阶段对一篇文章的最小描述。下载会重新解析文章页拿全量元信息。 */
export interface ArticleRef { url: string; title: string; createTime: number } // createTime: unix 秒

export type CrawlRange = { count: number } | { from: string; to: string }

export interface CrawlSummary {
  ok: boolean
  fakeid: string
  listed: number
  total: number
  succeeded: number
  failed: number
  skipped: number
  items: import('./types').DownloadItemResult[]
}

export type CrawlItemStatus = 'downloading' | 'ok' | 'skipped' | 'failed'
export interface CrawlItemEvent { index: number; status: CrawlItemStatus; error?: string }

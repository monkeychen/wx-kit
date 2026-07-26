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
export interface ArticleRef {
  url: string
  title: string
  createTime: number      // unix 秒
  /** 消息类型(M36):0 图文 / 5 视频 / 8 图文消息 / 10 文字 / 11…;列表接口直接给,不必猜 */
  itemShowType?: number
  /**
   * 微信自己的文章主键(= 长链里的 mid / idx)。列表接口直接给,**是跨 URL 形态稳定的去重依据**:
   * 同一篇文章,旧接口给长链 `s?__biz=..&mid=..&idx=..&sn=..`、新接口给短链 `s/XXXX`,
   * 光看 URL 认不出是同一篇(M36 换接口后重复下载的根因)。
   */
  appmsgid?: number
  itemidx?: number
}

export type CrawlRange = { count: number } | { from: string; to: string }

export interface CrawlSummary {
  ok: boolean
  fakeid: string
  listed: number          // 进入下载的篇数(关键词过滤后)
  total: number
  succeeded: number
  failed: number
  skipped: number
  filteredOut?: number    // 被标题关键词过滤掉的篇数(M24;未过滤或全通过则缺省)
  items: import('./types').DownloadItemResult[]
}

export type CrawlItemStatus = 'downloading' | 'ok' | 'skipped' | 'failed'
export interface CrawlItemEvent { index: number; status: CrawlItemStatus; error?: string }

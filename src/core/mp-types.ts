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
  /**
   * 消息类型:0 图文 / 5 视频 / 8 图片 / 10 文字 / 11…;开放集合。
   * 列表接口给(appmsg?type=9 只回 0);**下载阶段会从文章 HTML 重读真实类型**写进 meta,
   * 故即使列表给 0,文库卡片的类型标识仍准确。
   */
  itemShowType?: number
  /**
   * 微信自己的文章主键(= 长链里的 mid / idx),**跨 URL 形态稳定的去重依据**。
   * appmsg 接口给长链(本身含 mid/idx),列表项也常直接带 appmsgid/itemidx;
   * 透传它比对 URL 更稳——同一篇在不同分享链里 `sn` 会变,光看 URL 会认成两篇。
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
  /**
   * 读者不可访问(审核未通过/已删除/被封禁)的篇数(M38)。
   * 由下载阶段认出——**列表接口在文章被拒后不再有标记**(`checking` 只在审核期间为 1),
   * 只能在下到错误页时由 `ArticleUnavailableError` 认出来。
   */
  unavailable?: number
  /** `failed` 里刨掉「读者不可见」后剩下的真故障数(网络/解析等,重试可能有用) */
  realFailures?: number
  /**
   * 结果是否**不及用户预期**(M38)——决定要不要向用户解释那些被跳过的文章。
   * 判断收在这里而不是各渲染层:count 模式补齐成功就没什么可解释的(要 3 篇给了 3 篇),
   * 只有「翻到底仍不够」或「日期范围内确实少了」才需要说明。GUI 与 CLI 各判一次必然漂。
   */
  shortfall?: boolean
  items: import('./types').DownloadItemResult[]
}

export type CrawlItemStatus = 'downloading' | 'ok' | 'skipped' | 'failed'
export interface CrawlItemEvent { index: number; status: CrawlItemStatus; error?: string }

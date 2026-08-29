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
  /** 来源提供的稳定文章身份。`cover` 没有发布时间时，用它而非 createTime 判断是否更新。 */
  sourceId?: string
  /** 消息类型(M36):0 图文 / 5 视频 / 8 图文消息 / 10 文字 / 11…;列表接口直接给,不必猜 */
  itemShowType?: number
  /**
   * 微信自己的文章主键(= 长链里的 mid / idx)。列表接口直接给,**是跨 URL 形态稳定的去重依据**:
   * 同一篇文章,旧接口给长链 `s?__biz=..&mid=..&idx=..&sn=..`、新接口给短链 `s/XXXX`,
   * 光看 URL 认不出是同一篇(M36 换接口后重复下载的根因)。
   */
  appmsgid?: number
  itemidx?: number
  /**
   * 阅读/点赞数（v0.10.0 微信读书链路新增数据）：列表接口给了才有。
   * MP 后台时代拿不到别人号的阅读数——这是两条链路唯一的能力增量。
   */
  readNum?: number
  likeNum?: number
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
   * 两个来源合并:列表阶段就能标出来的,和下载时才发现的
   * ——**列表接口在文章被拒后不再有标记**(`checking` 只在审核期间为 1),所以后者不可避免。
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

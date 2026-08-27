// src/core/mp-crawl.ts
import { DownloadQueue, type OnProgress } from './download-queue'
import type { ArticleRef, CrawlRange, CrawlSummary, CrawlItemEvent } from './mp-types'
import type { DownloadItemResult } from './types'

export interface KeywordFilter { include?: string[]; exclude?: string[] }

/**
 * 标题关键词过滤(issue #1):include 任一命中才留(空/未传=不限),exclude 任一命中即去
 * (在 include 之后应用,冲突时 exclude 优先)。不区分大小写;空白关键词忽略。
 * 只看标题——正文要下载后才有;且只在已列出的范围内筛,不为凑数翻页(频控)。
 */
export function filterRefsByTitle(refs: ArticleRef[], f?: KeywordFilter): ArticleRef[] {
  const clean = (ks?: string[]) => (ks ?? []).map((k) => k.trim().toLowerCase()).filter(Boolean)
  const inc = clean(f?.include), exc = clean(f?.exclude)
  if (!inc.length && !exc.length) return refs
  return refs.filter((r) => {
    const t = r.title.toLowerCase()
    if (inc.length && !inc.some((k) => t.includes(k))) return false
    return !exc.some((k) => t.includes(k))
  })
}

export interface CrawlDeps {
  /** 列表取件（v0.10.0 微信读书实现；账号标识归一在实现内完成）。 */
  listFn: (fakeid: string, range: CrawlRange, opts?: { onHidden?: (n: number) => void }) => Promise<ArticleRef[]>
  downloadOne: (url: string, hint?: { appmsgid?: number; itemidx?: number }) => Promise<DownloadItemResult>
  /** 标题关键词过滤(列表后、下载前应用;见 filterRefsByTitle)。 */
  keywords?: KeywordFilter
  sleep?: (ms: number) => Promise<void>
  onProgress?: OnProgress
  /** 列表阶段拿到全部文章后整批上报（含标题，供 UI 立即铺行）。 */
  onListed?: (refs: ArticleRef[]) => void
  /** 每篇「下载中→结果」上报。 */
  onItem?: (ev: CrawlItemEvent) => void
  /** 返回 false 则停止后续（取消）；已下载的保留。 */
  shouldContinue?: () => boolean
  /** 取消信号：列表开始前或下载队列阶段停止后续工作。频控不再自动退避重试。 */
  signal?: AbortSignal
}

export async function crawlAccount(fakeid: string, range: CrawlRange, deps: CrawlDeps): Promise<CrawlSummary> {
  let refs: ArticleRef[] = []
  if (!deps.signal?.aborted) {
    // 频控由全局 gateway 熔断并直接抛出；这里绝不在已被限制的会话上追加请求。
    refs = await deps.listFn(fakeid, range)
  }

  const beforeFilter = refs.length
  refs = filterRefsByTitle(refs, deps.keywords)
  const filteredOut = beforeFilter - refs.length

  deps.onListed?.(refs)

  // 下载阶段：复用 DownloadQueue（串行 + 单篇失败不中断 + 汇总）。
  // 逐篇上报「下载中→结果」；真正的请求间隔由全局 gateway 统一决定。
  let index = -1
  const wrapped = async (url: string, hint?: { appmsgid?: number; itemidx?: number }) => {
    const i = ++index
    deps.onItem?.({ index: i, status: 'downloading' })
    try {
      const r = await deps.downloadOne(url, hint)
      deps.onItem?.({ index: i, status: r.skipped ? 'skipped' : 'ok' })
      return r
    } catch (e) {
      deps.onItem?.({ index: i, status: 'failed', error: (e as Error).message })
      throw e
    }
  }
  const queue = new DownloadQueue(wrapped, deps.onProgress)
  // 传 refs 而不是 urls：主键(appmsgid/itemidx)要跟着走，否则短链判不了重
  const s = await queue.run(refs, deps.shouldContinue)

  // 取消时队列在第 s.items.length 篇处停下，其后的文章未尝试下载。把它们补登记为 cancelled
  // （列表阶段已有标题），让历史诚实列出「还有几篇没下」并支持单篇补下。串行下载保证 items 与 refs 同序。
  const cancelled: DownloadItemResult[] = refs
    .slice(s.items.length)
    .map((r) => ({ url: r.url, ok: false, title: r.title, cancelled: true }))

  // 「读者打不开」在下载阶段被发现(s.unavailable)——微信读书列表没有此类标记字段
  // (MP 后台的 checking/ban_flag 随链路一起退场)，列表阶段无法预知。
  const unavailable = s.unavailable ?? 0
  const realFailures = s.failed - unavailable
  // 结果是否不及预期:count 模式看拿到几篇能读的,日期模式只要窗口内少了就算
  const shortfall = 'count' in range ? s.succeeded + s.skipped < range.count : unavailable > 0
  return {
    ok: s.ok, fakeid, listed: refs.length,
    total: s.total, succeeded: s.succeeded, failed: s.failed, skipped: s.skipped,
    ...(filteredOut > 0 ? { filteredOut } : {}),
    ...(unavailable > 0 ? { unavailable, shortfall, realFailures } : {}),
    items: [...s.items, ...cancelled],
  }
}

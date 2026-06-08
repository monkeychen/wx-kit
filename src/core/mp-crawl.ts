// src/core/mp-crawl.ts
import { DownloadQueue, type OnProgress } from './download-queue'
import { listArticles as listArticlesImpl, sleep as sleepImpl, randMs } from './mp-client'
import { MpRateLimited } from './mp-errors'
import type { MpFetch, ArticleRef, CrawlRange, CrawlSummary, CrawlItemEvent } from './mp-types'
import type { DownloadItemResult } from './types'

export interface CrawlDeps {
  mpFetch: MpFetch
  token: string
  downloadOne: (url: string) => Promise<DownloadItemResult>
  sleep?: (ms: number) => Promise<void>
  onProgress?: OnProgress
  /** 列表阶段拿到全部文章后整批上报（含标题，供 UI 立即铺行）。 */
  onListed?: (refs: ArticleRef[]) => void
  /** 每篇「下载中→结果」上报。 */
  onItem?: (ev: CrawlItemEvent) => void
  /** 返回 false 则停止后续（取消）；已下载的保留。 */
  shouldContinue?: () => boolean
  /** 列表阶段命中频控、进入退避等待前上报，供 UI 显示「退避中 · N 秒后重试」。 */
  onBackoff?: (ev: { attempt: number; waitMs: number; reason: 'rate-limit' }) => void
  /** 测试可注入假 listArticles。 */
  listFn?: (
    mpFetch: MpFetch, token: string, fakeid: string, range: CrawlRange, opts?: { sleep?: (ms: number) => Promise<void> },
  ) => Promise<ArticleRef[]>
}

export async function crawlAccount(fakeid: string, range: CrawlRange, deps: CrawlDeps): Promise<CrawlSummary> {
  const sleep = deps.sleep ?? sleepImpl
  const listFn = deps.listFn ?? listArticlesImpl

  // 列表阶段：命中频控则指数退避，最多 3 次
  let refs: ArticleRef[] = []
  for (let attempt = 0; ; attempt++) {
    try {
      refs = await listFn(deps.mpFetch, deps.token, fakeid, range, { sleep })
      break
    } catch (e) {
      if (e instanceof MpRateLimited && attempt < 3) {
        const waitMs = 30000 * (attempt + 1)
        deps.onBackoff?.({ attempt: attempt + 1, waitMs, reason: 'rate-limit' })
        await sleep(waitMs); continue
      }
      throw e
    }
  }

  deps.onListed?.(refs)

  // 下载阶段：复用 DownloadQueue（串行 + 单篇失败不中断 + 汇总）。
  // 逐篇上报「下载中→结果」，延迟在每篇前；index 经闭包计数（串行，顺序稳定）。
  let index = -1
  const wrapped = async (url: string) => {
    const i = ++index
    deps.onItem?.({ index: i, status: 'downloading' })
    await sleep(randMs(2000, 5000))
    try {
      const r = await deps.downloadOne(url)
      deps.onItem?.({ index: i, status: r.skipped ? 'skipped' : 'ok' })
      return r
    } catch (e) {
      deps.onItem?.({ index: i, status: 'failed', error: (e as Error).message })
      throw e
    }
  }
  const queue = new DownloadQueue(wrapped, deps.onProgress)
  const s = await queue.run(refs.map((r) => r.url), deps.shouldContinue)

  // 取消时队列在第 s.items.length 篇处停下，其后的文章未尝试下载。把它们补登记为 cancelled
  // （列表阶段已有标题），让历史诚实列出「还有几篇没下」并支持单篇补下。串行下载保证 items 与 refs 同序。
  const cancelled: DownloadItemResult[] = refs
    .slice(s.items.length)
    .map((r) => ({ url: r.url, ok: false, title: r.title, cancelled: true }))

  return {
    ok: s.ok, fakeid, listed: refs.length,
    total: s.total, succeeded: s.succeeded, failed: s.failed, skipped: s.skipped,
    items: [...s.items, ...cancelled],
  }
}

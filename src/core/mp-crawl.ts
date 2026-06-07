// src/core/mp-crawl.ts
import { DownloadQueue, type OnProgress } from './download-queue'
import { listArticles as listArticlesImpl, sleep as sleepImpl, randMs } from './mp-client'
import { MpRateLimited } from './mp-errors'
import type { MpFetch, ArticleRef, CrawlRange, CrawlSummary } from './mp-types'
import type { DownloadItemResult } from './types'

export interface CrawlDeps {
  mpFetch: MpFetch
  token: string
  downloadOne: (url: string) => Promise<DownloadItemResult>
  sleep?: (ms: number) => Promise<void>
  onProgress?: OnProgress
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
      if (e instanceof MpRateLimited && attempt < 3) { await sleep(30000 * (attempt + 1)); continue }
      throw e
    }
  }

  // 下载阶段：复用 DownloadQueue（串行 + 单篇失败不中断 + 汇总），逐篇前插入随机延迟
  const delayed = async (url: string) => { await sleep(randMs(2000, 5000)); return deps.downloadOne(url) }
  const queue = new DownloadQueue(delayed, deps.onProgress)
  const s = await queue.run(refs.map((r) => r.url))

  return {
    ok: s.ok, fakeid, listed: refs.length,
    total: s.total, succeeded: s.succeeded, failed: s.failed, skipped: s.skipped, items: s.items,
  }
}

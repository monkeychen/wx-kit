// src/core/download-queue.ts
import type { DownloadItemResult, DownloadSummary, ProgressEvent } from './types'
import type { ArticleIdHint } from './article-id'
import { ArticleUnavailableError } from './download-article'

/** 队列条目：光有 URL 时无法判重（短链认不出与长链是同一篇），故允许带上列表给的主键 */
export type QueueItem = string | ({ url: string } & ArticleIdHint)
export type DownloadOne = (url: string, hint?: ArticleIdHint) => Promise<DownloadItemResult>
export type OnProgress = (e: ProgressEvent) => void

export class DownloadQueue {
  constructor(private downloadOne: DownloadOne, private onProgress: OnProgress = () => {}) {}

  async run(input: QueueItem[], shouldContinue?: () => boolean): Promise<DownloadSummary> {
    const items: DownloadItemResult[] = []
    const queue = input.map((i) => (typeof i === 'string' ? { url: i } : i))
    const total = queue.length

    for (let i = 0; i < total; i++) {
      if (shouldContinue && !shouldContinue()) break
      const item = queue[i]
      const { url } = item
      // 只取判重需要的主键：用 rest 展开会把 ArticleRef 的 title/createTime 一并塞进 hint，
      // 以后给 ArticleRef 加字段就会莫名多出参数（隐性耦合）
      const hint = item.appmsgid != null && item.itemidx != null
        ? { appmsgid: item.appmsgid, itemidx: item.itemidx }
        : {}
      this.onProgress({ total, completed: i, currentUrl: url, phase: 'fetch' })
      try {
        const r = await this.downloadOne(url, hint)
        items.push(r)
        this.onProgress({ total, completed: i + 1, currentUrl: url, phase: 'save' })
      } catch (err) {
        // 「读者打不开」与「下载失败」对用户是两回事:前者重试也没用,不该让人以为工具坏了
        const unavailable = err instanceof ArticleUnavailableError
        items.push({
          url, ok: false, ...(unavailable ? { unavailable: true } : {}),
          error: { code: unavailable ? 'ARTICLE_UNAVAILABLE' : 'DOWNLOAD_FAILED', message: (err as Error).message },
        })
        this.onProgress({ total, completed: i + 1, currentUrl: url, phase: 'failed' })
      }
    }

    const succeeded = items.filter(i => i.ok && !i.skipped).length
    const skipped = items.filter(i => i.ok && i.skipped).length
    const failed = items.filter(i => !i.ok).length
    const unavailable = items.filter(i => i.unavailable).length
    this.onProgress({ total, completed: items.length, currentUrl: '', phase: 'done' })

    return { ok: failed === 0, total, succeeded, failed, skipped, ...(unavailable ? { unavailable } : {}), items }
  }
}

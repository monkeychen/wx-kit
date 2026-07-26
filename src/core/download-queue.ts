// src/core/download-queue.ts
import type { DownloadItemResult, DownloadSummary, ProgressEvent } from './types'
import type { ArticleIdHint } from './article-id'

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
      const { url, ...hint } = queue[i]
      this.onProgress({ total, completed: i, currentUrl: url, phase: 'fetch' })
      try {
        const r = await this.downloadOne(url, hint)
        items.push(r)
        this.onProgress({ total, completed: i + 1, currentUrl: url, phase: 'save' })
      } catch (err) {
        items.push({ url, ok: false, error: { code: 'DOWNLOAD_FAILED', message: (err as Error).message } })
        this.onProgress({ total, completed: i + 1, currentUrl: url, phase: 'failed' })
      }
    }

    const succeeded = items.filter(i => i.ok && !i.skipped).length
    const skipped = items.filter(i => i.ok && i.skipped).length
    const failed = items.filter(i => !i.ok).length
    this.onProgress({ total, completed: items.length, currentUrl: '', phase: 'done' })

    return { ok: failed === 0, total, succeeded, failed, skipped, items }
  }
}

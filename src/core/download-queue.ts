// src/core/download-queue.ts
import type { DownloadItemResult, DownloadSummary, ProgressEvent } from './types'
import type { ArticleIdHint } from './article-id'
import { ArticleUnavailableError } from './download-article'

/** 队列条目：光有 URL 时无法判重（短链认不出与长链是同一篇），故允许带上列表给的主键 */
export type QueueItem = string | ({ url: string } & ArticleIdHint)
export type ArticleStage = { phase: import('./types').ProgressPhase; message?: string }
export type DownloadOne = (url: string, hint?: ArticleIdHint, report?: (stage: ArticleStage) => void) => Promise<DownloadItemResult>
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
        const r = await this.downloadOne(url, hint, (stage) => {
          this.onProgress({ total, completed: i, currentUrl: url, phase: stage.phase, message: stage.message })
        })
        items.push(r)
        this.onProgress({ total, completed: i + 1, currentUrl: url, phase: 'save' })
      } catch (err) {
        // 「读者打不开」与「下载失败」对用户是两回事:前者重试也没用,不该让人以为工具坏了
        const unavailable = err instanceof ArticleUnavailableError
        const errorCode = (err as { code?: string }).code
        const code = unavailable ? 'ARTICLE_UNAVAILABLE' : (errorCode ?? 'DOWNLOAD_FAILED')
        items.push({
          url, ok: false, ...(unavailable ? { unavailable: true } : {}),
          error: { code, message: (err as Error).message },
        })
        this.onProgress({ total, completed: i + 1, currentUrl: url, phase: 'failed' })
        // 频控/全局保护不是单篇故障：当前项如实记录，其余尚未发出的条目留给调用方标记未下载。
        if (isGlobalStopCode(code)) break
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

function isGlobalStopCode(code: string): boolean {
  return code === 'RATE_LIMITED'
    || code === 'MP_RATE_LIMITED'
    || code === 'MP_GOVERNOR_PAUSED'
    || code === 'MP_REQUEST_CANCELLED'
}

// src/core/download-queue.ts
import type { DownloadItemResult, DownloadSummary, ProgressEvent } from './types'

export type DownloadOne = (url: string) => Promise<DownloadItemResult>
export type OnProgress = (e: ProgressEvent) => void

export class DownloadQueue {
  constructor(private downloadOne: DownloadOne, private onProgress: OnProgress = () => {}) {}

  async run(urls: string[], shouldContinue?: () => boolean): Promise<DownloadSummary> {
    const items: DownloadItemResult[] = []
    const total = urls.length

    for (let i = 0; i < total; i++) {
      if (shouldContinue && !shouldContinue()) break
      const url = urls[i]
      this.onProgress({ total, completed: i, currentUrl: url, phase: 'fetch' })
      try {
        const r = await this.downloadOne(url)
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

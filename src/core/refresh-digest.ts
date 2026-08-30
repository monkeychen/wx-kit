import { articleId, canonicalId } from './article-id'
import { DownloadQueue, type DownloadOne, type OnProgress } from './download-queue'
import { globalRequestStopCode } from './mp-errors'
import { sourceUrlKey } from './subscription-refs'
import type { DigestAccount, DigestFailure } from './subscription-digest'
import type { ArticleMeta } from './types'
import type { ArticleRef } from './mp-types'

interface RefreshDeps {
  latest: (fakeid: string) => Promise<Pick<ArticleRef, 'url' | 'title'> | null>
  readLibrary: () => Promise<ArticleMeta[]>
  download: (account: DigestAccount, ...args: Parameters<DownloadOne>) => ReturnType<DownloadOne>
  onProgress?: OnProgress
  onAccount?: (account: DigestAccount, index: number, total: number) => void
}

/** 只处理本次明确要求的 cover/下载，不接触订阅游标、pending 和调度状态。 */
export async function refreshDigest(accounts: DigestAccount[], deps: RefreshDeps): Promise<DigestFailure[]> {
  const failures: DigestFailure[] = []
  let stopped: string | undefined
  for (const [index, account] of accounts.entries()) {
    const identity = { fakeid: account.fakeid, nickname: account.nickname }
    if (stopped) {
      failures.push({ ...identity, code: 'NOT_ATTEMPTED', error: `全局请求已停止，本账号未刷新：${stopped}` })
      continue
    }
    deps.onAccount?.(account, index + 1, accounts.length)
    try {
      const ref = await deps.latest(account.fakeid)
      if (!ref) continue
      const stored = await deps.readLibrary()
      const id = canonicalId(articleId(ref.url))
      if (stored.some((m) => canonicalId(m.id) === id || sourceUrlKey(m.sourceUrl) === sourceUrlKey(ref.url))) continue
      const summary = await new DownloadQueue(async (url, hint, report) => {
        return deps.download(account, url, hint, report)
      }, deps.onProgress).run([ref.url])
      const item = summary.items[0]
      if (!item?.ok) {
        const error = item?.error?.message ?? '文章下载未完成'
        const code = item?.error?.code ?? 'DOWNLOAD_FAILED'
        failures.push({ ...identity, url: ref.url, error, code, ...(item?.unavailable ? { unavailable: true } : {}) })
        if (globalRequestStopCode({ code })) stopped = error
      }
    } catch (error) {
      const detail = error as { message?: string; code?: string; status?: number }
      const stopCode = detail.status === 401 || detail.status === 403 ? 'AUTH_REQUIRED' : globalRequestStopCode(error)
      const code = stopCode ?? detail.code
      const message = detail.message ?? String(error)
      failures.push({ ...identity, error: message, ...(code ? { code } : {}) })
      if (stopCode) stopped = message
    }
  }
  return failures
}

import type { ArticleRef } from './mp-types'
import type { SubscribedAccount } from './subscriptions'

export interface PendingDownloadGroup {
  fakeid: string
  nickname: string
  refs: ArticleRef[]
}

/** 订阅页的全量下载只处理当前仍待处理的已订阅账号，不另造账号级选择状态。 */
export function collectPendingDownloads(accounts: SubscribedAccount[]): PendingDownloadGroup[] {
  return accounts
    .filter((account) => account.subscribed && account.newRefs.length > 0)
    .map(({ fakeid, nickname, newRefs }) => ({ fakeid, nickname, refs: newRefs }))
}

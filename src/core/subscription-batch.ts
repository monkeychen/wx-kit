import type { ArticleRef } from './mp-types'
import { toDownloadItemLogs, type AccountDownloadLog, type SubscribedAccount } from './subscriptions'
import type { DownloadSummary } from './types'

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

/**
 * 一个下载组的交付明细（M56）：组身份 + 组内逐篇四状态。
 * 自动下载（subscription-check）与手动批量（ipc downloadAllNew）共用，保证两条链路映射行为逐字节一致。
 * refs 传该组发起下载时的文章列表，失败项缺标题时按 url 从这里补。纯函数。
 */
export function toAccountDownloadLog(
  group: { fakeid: string; nickname: string; refs: { url: string; title: string }[] },
  summary: DownloadSummary,
): AccountDownloadLog {
  return { fakeid: group.fakeid, nickname: group.nickname, items: toDownloadItemLogs(summary.items, group.refs) }
}

/**
 * 从逐号明细统计「刚下载 / 文库已有」（M56）。与明细**同源**（四状态），而非另走 summary 计数——
 * 汇总数永远与用户在明细里逐篇数出来的对得上。纯函数。
 */
export function countDownloadOutcomes(details: AccountDownloadLog[]): { downloaded: number; existed: number } {
  let downloaded = 0, existed = 0
  for (const log of details) {
    for (const item of log.items) {
      if (item.status === 'downloaded') downloaded++
      else if (item.status === 'exists') existed++
    }
  }
  return { downloaded, existed }
}

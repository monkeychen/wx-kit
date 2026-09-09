// src/renderer/subscription-view.ts
// 订阅页 M56：行内摘要从 checkLog 落盘数据派生的纯函数（与 subscription-progress 同层：只放 UI 无关的派生逻辑）。
import type { CheckLogEntry, AccountDownloadLog, DownloadItemLog } from '../core/subscriptions'

export interface LatestAccountResult { entry: CheckLogEntry; detail: AccountDownloadLog }

/**
 * fakeid → 最近一条含该号的 downloadDetail（M56 行内摘要的单一数据源）。
 * 归属规则（brief 定死，勿扩展）：**只认 `downloadDetail[].fakeid`**——`CheckFailure` 无 fakeid，
 * 失败明细不归属；仅 newFound 的老记录、以及「该号被检查过但无新文章」的条目一律不落入摘要。
 * 按 entry.time 取最近（并列时保留先遇到的），不依赖输入数组顺序；checkLog 落盘时新条目在前。
 */
export function latestResultByAccount(checkLog: CheckLogEntry[]): Map<string, LatestAccountResult> {
  const map = new Map<string, LatestAccountResult>()
  for (const entry of checkLog) {
    for (const detail of entry.downloadDetail ?? []) {
      const cur = map.get(detail.fakeid)
      if (!cur || entry.time > cur.entry.time) map.set(detail.fakeid, { entry, detail })
    }
  }
  return map
}

/**
 * 交付话术：四状态收敛为三句（M56）。N = 该号本次进入下载流程的篇数（items.length）。
 * - kind='check'（或缺省，发现+交付并存）：downloaded>0 → 「发现 N 篇，已下载 M 篇」
 *   （brief 定死：并存 exists 时也不展开第三句）；existed>0 且 downloaded=0 → 「发现 N 篇，M 篇文库已有」；
 *   其余（全 failed/unavailable）→ 只说「发现 N 篇」，失败细节走弹窗，摘要不展开
 * - kind='download'（补下载，纯交付）：newFound 恒为 0，**不说「发现」**——说了会和同屏检查
 *   记录行的「新 0」自相矛盾，也违反 PRD §4「行内摘要必须能区分发现与交付」。
 *   downloaded>0 → 「已下载 M 篇」；existed>0 且 downloaded=0 → 「M 篇文库已有」；
 *   其余 → 「N 篇未成功」（细节走弹窗）。刚下载/文库已有仍分开。
 */
export function summaryPhrase(items: DownloadItemLog[], kind: CheckLogEntry['kind'] = 'check'): string {
  let downloaded = 0, existed = 0
  for (const item of items) {
    if (item.status === 'downloaded') downloaded++
    else if (item.status === 'exists') existed++
  }
  if (kind === 'download') {
    if (downloaded > 0) return `已下载 ${downloaded} 篇`
    if (existed > 0) return `${existed} 篇文库已有`
    return `${items.length} 篇未成功`
  }
  // M58：提示策略的检查明细全为 pending——「待下载」比「已下载 0 篇」更贴合用户要做的动作
  if (items.length > 0 && items.every((i) => i.status === 'pending')) return `发现 ${items.length} 篇，待下载`
  if (downloaded > 0) return `发现 ${items.length} 篇，已下载 ${downloaded} 篇`
  if (existed > 0) return `发现 ${items.length} 篇，${existed} 篇文库已有`
  return `发现 ${items.length} 篇`
}

/** 触发方式标签：补下载优先于 auto/manual（kind=download 的记录 trigger 恒为 manual，单独显示会是废话）。 */
export function triggerLabel(e: Pick<CheckLogEntry, 'kind' | 'trigger'>): string {
  if (e.kind === 'download') return '补下载'
  return e.trigger === 'auto' ? '自动' : '手动'
}

/** MM-DD HH:mm（本地时区）：行内摘要要的是「什么时候」，完整日期占位太长。 */
export function formatShortTime(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 下载明细弹窗里的状态 Tag：五状态五色；failed 的 title（tooltip）带 error 由调用方透传。 */
export function itemStatusTag(status: DownloadItemLog['status']): { label: string; color: string } {
  switch (status) {
    case 'downloaded': return { label: '已下载', color: 'green' }
    case 'exists': return { label: '文库已有', color: 'default' }
    case 'failed': return { label: '失败', color: 'red' }
    case 'unavailable': return { label: '不可访问', color: 'orange' }
    case 'pending': return { label: '未下载', color: 'default' }
  }
}

/** 明细弹窗标题：kind=download 加「补下载」；trigger 与时间入标题。 */
export function detailModalTitle(e: CheckLogEntry): string {
  const what = e.kind === 'download' ? '补下载' : '检查'
  return `${what}明细（${formatShortTime(e.time)} · ${e.trigger === 'auto' ? '自动' : '手动'}）`
}

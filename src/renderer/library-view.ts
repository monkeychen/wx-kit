// src/renderer/library-view.ts
// 文库视图的纯变换：排序 / 按公众号筛选+分组。作用于已全量载入 renderer 的 ArticleMeta[]，
// 不 import 任何 core 运行时（只用类型），属展示层逻辑。
import type { ArticleMeta } from '../core/types'

export type SortKey = 'download' | 'publish' | 'title'
export type SortDir = 'asc' | 'desc'
export interface AccountGroup { account: string; items: ArticleMeta[] }

/** 公众号名，空则归一为「未知公众号」。分组/筛选/展示统一走它。 */
export function accountName(m: ArticleMeta): string {
  return m.account || '未知公众号'
}

/** 去重的公众号列表，按首次出现序——喂筛选下拉。 */
export function accountsOf(list: ArticleMeta[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of list) {
    const a = accountName(m)
    if (!seen.has(a)) { seen.add(a); out.push(a) }
  }
  return out
}

/** account 为 null = 全部；否则只留该公众号。 */
export function filterByAccount(list: ArticleMeta[], account: string | null): ArticleMeta[] {
  if (!account) return list
  return list.filter((m) => accountName(m) === account)
}

/** 排序（不改输入）。download/publish 比 ISO/日期串（字典序即时序）；title 用中文 localeCompare。
 *  publishTime 为空的恒置末尾，避免「没发布时间」的条目无论升降都冒到最前。 */
export function sortArticles(list: ArticleMeta[], key: SortKey, dir: SortDir): ArticleMeta[] {
  const sign = dir === 'asc' ? 1 : -1
  const copy = list.slice()
  copy.sort((x, y) => {
    if (key === 'title') return sign * x.title.localeCompare(y.title, 'zh')
    if (key === 'publish') {
      const px = x.publishTime, py = y.publishTime
      if (!px && !py) return 0
      if (!px) return 1          // 空 publish 永远在后（与方向无关）
      if (!py) return -1
      return sign * px.localeCompare(py)
    }
    return sign * x.downloadTime.localeCompare(y.downloadTime)
  })
  return copy
}

/** 按公众号分组，保持传入（通常已排序）顺序的组首见序与组内序。 */
export function groupByAccount(list: ArticleMeta[]): AccountGroup[] {
  const map = new Map<string, ArticleMeta[]>()
  for (const m of list) {
    const a = accountName(m)
    const arr = map.get(a)
    if (arr) arr.push(m)
    else map.set(a, [m])
  }
  return [...map.entries()].map(([account, items]) => ({ account, items }))
}

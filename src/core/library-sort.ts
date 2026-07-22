// src/core/library-sort.ts
// 文库文章排序的纯领域逻辑(CLI 与 GUI 共享,从 renderer/library-view.ts 抽出,避免双份)。
// download/publish 比 ISO/日期串(字典序即时序);title 用中文 localeCompare。
// publishTime 为空恒置末尾——避免「没发布时间」的条目无论升降都冒到最前。
import type { ArticleMeta } from './types'

export type SortKey = 'download' | 'publish' | 'title'
export type SortDir = 'asc' | 'desc'

/** 排序(不改输入)。download/publish 比 ISO/日期串(字典序即时序);title 用中文 localeCompare。
 *  publishTime 为空的恒置末尾,避免「没发布时间」的条目无论升降都冒到最前。 */
export function sortArticles(list: ArticleMeta[], key: SortKey, dir: SortDir): ArticleMeta[] {
  const sign = dir === 'asc' ? 1 : -1
  const copy = list.slice()
  copy.sort((x, y) => {
    if (key === 'title') return sign * x.title.localeCompare(y.title, 'zh')
    if (key === 'publish') {
      const px = x.publishTime, py = y.publishTime
      if (!px && !py) return 0
      if (!px) return 1          // 空 publish 永远在后(与方向无关)
      if (!py) return -1
      return sign * px.localeCompare(py)
    }
    return sign * x.downloadTime.localeCompare(y.downloadTime)
  })
  return copy
}

// src/renderer/list-columns.ts
// 列表视图列宽与表头排序的纯逻辑。不 import 任何 core/electron 运行时。
import type { SortKey, SortDir } from './library-view'

export interface ListColumnWidths { account: number; publish: number; download: number }
export const DEFAULT_LIST_WIDTHS: ListColumnWidths = { account: 132, publish: 150, download: 110 }
export const MIN_COL = 64

/** 拖拽后钳制：不小于 MIN_COL，取整。 */
export function clampColWidth(px: number): number {
  return Math.max(MIN_COL, Math.round(px))
}

/** 由列宽 + 是否分组生成 grid-template-columns。
 *  布局：缩略图 44px | 标题 1fr | [公众号]（仅非分组）| 发布 | 下载 | 操作 172px。 */
export function buildListColumns(w: ListColumnWidths, grouped: boolean): string {
  const mid = grouped
    ? `${w.publish}px ${w.download}px`
    : `${w.account}px ${w.publish}px ${w.download}px`
  return `44px minmax(0, 1fr) ${mid} 172px`
}

export interface SortState { key: SortKey; dir: SortDir }
const DEFAULT_DIR: Record<SortKey, SortDir> = { title: 'asc', publish: 'desc', download: 'desc' }

/** 点击表头：同列翻转方向；换列用该列默认方向（标题升序、时间降序）。 */
export function nextSort(cur: SortState, clicked: SortKey): SortState {
  if (cur.key === clicked) return { key: clicked, dir: cur.dir === 'asc' ? 'desc' : 'asc' }
  return { key: clicked, dir: DEFAULT_DIR[clicked] }
}

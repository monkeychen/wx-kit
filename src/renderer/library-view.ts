// src/renderer/library-view.ts
// 文库视图的纯变换：排序 / 按公众号筛选+分组。作用于已全量载入 renderer 的 ArticleMeta[]，
// 从 core 引入的只有纯函数与类型（排序、账号标识归一），不引入任何 IO / Electron 运行时。
import type { ArticleMeta } from '../core/types'
// 从零 node 依赖的纯函数模块 import（M56 T4 fix）：若经由 core/subscriptions（依赖 node:fs），
// vite-plugin-electron-renderer 的 CJS shim 会把 node 内建摇进渲染 bundle，沙箱页面直接崩。
import { normalizeAccountKey } from '../core/weread/book-id'

// 排序逻辑(M25 起共享给 CLI)抽到了 core,这里 re-export 保持渲染层 import 兼容。
export { sortArticles, type SortKey, type SortDir } from '../core/library-sort'

export interface AccountGroup { account: string; items: ArticleMeta[] }

/** 公众号名，空则归一为「未知公众号」。分组/筛选/展示统一走它。 */
export function accountName(m: ArticleMeta): string {
  return m.account || '未知公众号'
}

export interface AccountOption { id: string; name: string }

/**
 * 喂筛选下拉的公众号选项：value 用身份（accountId；旧条目缺失时以名称兼任，与旧下拉行为等价），
 * label 用名称。同一公众号按「身份 key + 名称 key」双轨归并——M56 跳转传身份、历史下拉传名称，
 * 混合库下同一号会以两种形态出现；保持首见序。
 */
export function accountOptions(list: ArticleMeta[]): AccountOption[] {
  const byKey = new Map<string, AccountOption>()
  const out: AccountOption[] = []
  for (const m of list) {
    const name = accountName(m)
    const keys = [normalizeAccountKey(name)]
    if (m.accountId) keys.push(normalizeAccountKey(m.accountId))
    const hit = keys.map((k) => byKey.get(k)).find(Boolean)
    if (!hit) {
      const opt: AccountOption = { id: m.accountId ?? name, name }
      for (const k of keys) byKey.set(k, opt)
      out.push(opt)
      continue
    }
    // 已有同号：id 从名称形态升级为真身份；名称从「未知公众号」升级为真名
    if (m.accountId && hit.id === hit.name) hit.id = m.accountId
    if (hit.name === '未知公众号' && name !== '未知公众号') hit.name = name
    for (const k of keys) byKey.set(k, hit)
  }
  return out
}

/**
 * account 为 null = 全部；否则按「身份优先、名称兜底」只留该公众号。
 * 入参语义（M56）：既可能是**身份**（订阅页「文库」跳转传 fakeid，MP_WXS_/纯数字/base64
 * 三种历史形态），也可能是**名称**（本页筛选下拉传公众号名）。先归一比 `accountId`
 * （公众号改名后名称对不上、身份仍对得上），不中再按名称字面兜底——旧条目缺
 * `accountId` 时由兜底覆盖。任一命中即保留。
 */
export function filterByAccount(list: ArticleMeta[], account: string | null): ArticleMeta[] {
  if (!account) return list
  const key = normalizeAccountKey(account)
  return list.filter((m) =>
    (m.accountId != null && normalizeAccountKey(m.accountId) === key) || accountName(m) === account)
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

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

export interface AccountOption { id: string; name: string; keys: string[] }

/**
 * 喂筛选下拉的公众号选项：value 用身份（accountId；旧条目缺失时以名称兼任，与旧下拉行为等价），
 * label 用名称。同一公众号按「身份 key + 名称 key」双轨归并——M56 跳转传身份、历史下拉传名称，
 * 混合库下同一号会以两种形态出现；保持首见序。
 * `keys` 是该组的**等价类**：组内全部条目的身份/名称归一 key。筛选必须按它匹配（见
 * filterByAccount）——否则混合库下选中「身份 id」时，无 accountId 的旧条目会整体掉队
 * （M57 回归：每号只剩最近几篇带身份的文章）。
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
      const opt: AccountOption = { id: m.accountId ?? name, name, keys: [...keys] }
      for (const k of keys) byKey.set(k, opt)
      out.push(opt)
      continue
    }
    // 已有同号：id 从名称形态升级为真身份；名称从「未知公众号」升级为真名；等价类并入两代形态
    if (m.accountId && hit.id === hit.name) hit.id = m.accountId
    if (hit.name === '未知公众号' && name !== '未知公众号') hit.name = name
    for (const k of keys) {
      byKey.set(k, hit)
      if (!hit.keys.includes(k)) hit.keys.push(k)
    }
  }
  return out
}

/**
 * 订阅页跳转/URL 直入时该号可能不在 accounts 里（文库 0 篇）：按 URL 参数构造降级选项，
 * 身份与名称的归一 key 都参与匹配（新条目靠身份、旧条目靠名称）。
 */
export function fallbackAccountOption(id: string, name: string | null): AccountOption {
  return {
    id,
    name: name ?? id,
    keys: [normalizeAccountKey(id), ...(name ? [normalizeAccountKey(name)] : [])],
  }
}

/**
 * opt 为 null = 全部；否则按该选项的**等价类 keys** 只留该公众号：条目的身份/名称任一归一
 * key 落在 keys 里即命中。谓词与 accountOptions 的归并判定同源——这是 M57 的教训：
 * 「选中身份 id」时单靠身份/名称兜底两支匹配，接不住组内无 accountId 的旧条目。
 */
export function filterByAccount(list: ArticleMeta[], opt: AccountOption | null): ArticleMeta[] {
  if (!opt) return list
  const keySet = new Set(opt.keys)
  return list.filter((m) =>
    (m.accountId != null && keySet.has(normalizeAccountKey(m.accountId))) ||
    keySet.has(normalizeAccountKey(accountName(m))))
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

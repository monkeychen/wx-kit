// src/core/subscription-refs.ts
// 待处理新文章(newRefs)的身份与增删。
//
// 为什么要有这个模块:M40 让用户可以「挑几篇下、剩下的留着回头看」,
// 而旧实现存 newRefs 是**整体覆盖**——留着的那几篇会在下一次检查发现任何新文章时被整批冲掉。
// 今天看不出来只是因为用户只能全下或全忽略,pending 从不留存(见 docs/PRD-v0.8.4.md R4)。
import type { ArticleRef } from './mp-types'

/**
 * 一篇待处理文章的身份。用微信自己的文章主键 `mid_idx`,**与文库判重同源**
 * (AGENTS.md:同一篇在短链/长链下 URL 形态不同,光看 URL 认不出是同一篇)。
 * 列表没给主键的老数据退回 url —— 宁可退化成「按 URL 认」,也不另造一套身份体系。
 */
export function refId(ref: ArticleRef): string {
  return ref.appmsgid != null && ref.itemidx != null ? `${ref.appmsgid}_${ref.itemidx}` : ref.url
}

/**
 * 把新发现的文章并入已有的待处理列表。
 * **合并而不是覆盖**:用户留着没处理的不能被下一轮检查冲掉——那是静默丢数据,
 * 用户只会觉得「刚才明明有 5 篇,现在怎么只剩 2 篇」。
 * 同一篇以新一轮的字段为准(标题可能被作者改过),结果按发布时间降序。
 */
export function mergeNewRefs(existing: ArticleRef[], incoming: ArticleRef[]): ArticleRef[] {
  const byId = new Map<string, ArticleRef>()
  for (const r of existing) byId.set(refId(r), r)
  for (const r of incoming) byId.set(refId(r), r)
  return [...byId.values()].sort((a, b) => b.createTime - a.createTime)
}

/** 按 id 精确移除(下载完或忽略掉的那几篇);未列出的原样保留。 */
export function removeRefs(refs: ArticleRef[], ids: string[]): ArticleRef[] {
  if (!ids.length) return refs
  const drop = new Set(ids)
  return refs.filter((r) => !drop.has(refId(r)))
}

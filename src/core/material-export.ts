// src/core/material-export.ts
// 把文库文章选成「素材清单」供外部 agent 消费。纯函数：选料过滤 + 清单组装；
// 写盘（exports/<时间戳>.json）见同文件的 writeMaterialExport（Task 3）。
import { join } from 'node:path'
import type { ArticleMeta } from './types'

export interface MaterialSelector {
  ids?: string[]
  account?: string   // 公众号名，大小写不敏感包含匹配
  since?: string     // YYYY-MM-DD，按 downloadTime >= 该日 00:00 过滤
  all?: boolean
}

export interface MaterialArticle {
  id: string
  title: string
  account: string
  author: string
  publishTime: string
  sourceUrl: string
  dir: string
  contentPath: string   // join(dir, 'content.md')，不内联正文
}

export interface MaterialManifest {
  ok: true
  count: number
  articles: MaterialArticle[]
}

/** 按 selector 过滤；all:true 跳过过滤返回全部，否则给定条件取交集。 */
export function selectArticles(all: ArticleMeta[], sel: MaterialSelector): ArticleMeta[] {
  if (sel.all) return all
  let out = all
  if (sel.ids && sel.ids.length) {
    const set = new Set(sel.ids)
    out = out.filter((m) => set.has(m.id))
  }
  if (sel.account) {
    const k = sel.account.toLowerCase()
    out = out.filter((m) => m.account.toLowerCase().includes(k))
  }
  if (sel.since) {
    const from = Date.parse(`${sel.since}T00:00:00`)
    out = out.filter((m) => {
      const d = Date.parse(m.downloadTime)
      return !Number.isNaN(d) && d >= from
    })
  }
  return out
}

export function buildManifest(articles: ArticleMeta[]): MaterialManifest {
  return {
    ok: true,
    count: articles.length,
    articles: articles.map((m) => ({
      id: m.id,
      title: m.title,
      account: m.account,
      author: m.author,
      publishTime: m.publishTime,
      sourceUrl: m.sourceUrl,
      dir: m.dir,
      contentPath: join(m.dir, 'content.md'),
    })),
  }
}

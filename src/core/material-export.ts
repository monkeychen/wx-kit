// src/core/material-export.ts
// 把文库文章选成「素材清单」供外部 agent 消费。纯函数：选料过滤 + 清单组装；
// 写盘（exports/<时间戳>.json）见同文件的 writeMaterialExport（Task 3）。
import { join } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { atomicWriteFile } from './atomic-write'
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

/**
 * 生成一段可直接粘给任意 agent 的自然语言指令。
 * 存在的理由：导出后用户原本要「找路径 → 拼提示词 → 切工具」三步，这段文本把前两步吃掉。
 * 刻意不绑定某个 agent（Claude Code / Codex / 网页版都能用），也刻意让 agent 先读清单再确认选题，
 * 免得它拿到素材就开写。
 */
export function buildAgentPrompt(manifestPath: string, count: number): string {
  return [
    `我用 wx-kit 导出了 ${count} 篇微信公众号文章作为写作素材。`,
    `素材清单：${manifestPath}`,
    '清单里每篇的正文在其 contentPath 字段指向的 content.md（Markdown，含标题、公众号、发布时间等元信息）。',
    '请先读清单、通读正文，再跟我确认选题和角度，确认后再动笔。',
  ].join('\n')
}

/** exports 文件名：本地时区 YYYYMMDD-HHMMSS.json。 */
export function exportFileName(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}.json`
}

/** 把清单原子写到 <root>/exports/<时间戳>.json，返回绝对路径。 */
export async function writeMaterialExport(root: string, manifest: MaterialManifest, now = new Date()): Promise<string> {
  const dir = join(root, 'exports')
  await mkdir(dir, { recursive: true })
  const path = join(dir, exportFileName(now))
  await atomicWriteFile(path, JSON.stringify(manifest, null, 2))
  return path
}

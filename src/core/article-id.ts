// src/core/article-id.ts
import { createHash } from 'node:crypto'

export function articleId(rawUrl: string): string {
  let u: URL
  try { u = new URL(rawUrl) } catch { return `h_${createHash('sha1').update(rawUrl).digest('hex').slice(0, 16)}` }

  const mid = u.searchParams.get('mid')
  const idx = u.searchParams.get('idx')
  const sn = u.searchParams.get('sn')
  if (mid && idx && sn) return `${mid}_${idx}_${sn}`

  // 回退：归一化（origin + pathname），忽略所有易变 query
  const normalized = `${u.origin}${u.pathname}`
  return `h_${createHash('sha1').update(normalized).digest('hex').slice(0, 16)}`
}

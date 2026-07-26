// src/core/article-id.ts
import { createHash } from 'node:crypto'

/** 列表接口给的文章主键(= 长链里的 mid / idx) */
export interface ArticleIdHint { appmsgid?: number; itemidx?: number }

/**
 * 文章唯一标识。
 *
 * **同一篇文章会以两种 URL 形态出现**:后台列表给短链 `s/XXXX`,分享/旧接口给长链
 * `s?__biz=..&mid=..&idx=..&sn=..`。光靠 URL 认不出它们是同一篇(M36 换列表接口后
 * 重复下载的根因)。因此优先用微信自己的主键 `mid_idx`:
 *   · 列表抓取:主键由 `hint` 直接给(短链也能算)
 *   · 长链:从 query 解析
 *   · 短链且无 hint(用户手动粘贴):只能回退到路径哈希 —— 见 canonicalId 的说明
 */
export function articleId(rawUrl: string, hint?: ArticleIdHint): string {
  if (hint?.appmsgid != null && hint.itemidx != null) return `${hint.appmsgid}_${hint.itemidx}`

  let u: URL
  try { u = new URL(rawUrl) } catch { return `h_${createHash('sha1').update(rawUrl).digest('hex').slice(0, 16)}` }

  const mid = u.searchParams.get('mid')
  const idx = u.searchParams.get('idx')
  if (mid && idx) return `${mid}_${idx}`

  // 回退：归一化（origin + pathname），忽略所有易变 query
  const normalized = `${u.origin}${u.pathname}`
  return `h_${createHash('sha1').update(normalized).digest('hex').slice(0, 16)}`
}

/**
 * 去重比较用的归一形式。
 *
 * 历史上 id 是 `mid_idx_sn`(sn 只是防伪/追踪参数,同一篇文章在不同分享链接里会变),
 * 现在是 `mid_idx`。两者必须认作同一篇,否则老库里的文章会被重下一遍。
 * 非 `mid_idx*` 形态(短链哈希)原样返回。
 */
export function canonicalId(id: string): string {
  const parts = id.split('_')
  return parts.length >= 3 && /^\d+$/.test(parts[0]) && /^\d+$/.test(parts[1])
    ? `${parts[0]}_${parts[1]}`
    : id
}

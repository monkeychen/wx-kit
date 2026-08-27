// src/core/weread/client.ts
// 微信读书 Web 客户端（Plan B）。Web 端完整 Cookie（需 RK/_qimei 等）才能拉列表，cover 仅最新一篇。
import { parseCover, type WereadCover } from './parse-articles'
import { normalizeAccountId } from './book-id'
import type { WereadBookInfo } from './types'
import type { ArticleRef } from '../mp-types'

export type WereadFetch = (path: string, params: Record<string, string | number>) => Promise<unknown>

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object'
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

export class WereadClient {
  constructor(private readonly fetchImpl: WereadFetch) {}

  /** 
   * 降级后，book/info 和 mp/cover 实际上可以查同一个接口（/api/mp/cover 返回了 name 和 avatar）。
   * 保持独立方法签名，方便上层使用。
   */
  async bookInfo(accountId: string): Promise<WereadBookInfo> {
    const bookId = normalizeAccountId(accountId)
    // web 端的 /api/mp/cover 包含了公众号的基础信息
    const payload = await this.fetchImpl('/api/mp/cover', { bookId })
    const d = isObj(payload) ? (isObj(payload.data) ? payload.data : payload) : {}
    return {
      bookId: str(d.bookId) || bookId,
      title: str(d.name || d.title),
      author: str(d.author || '公众号'),
      coverImg: str(d.avatar ?? d.pic ?? d.coverImg ?? ''),
    }
  }

  /** 获取公众号最新一篇文章的 cover 信息。 */
  async getLatestArticle(accountId: string): Promise<WereadCover | null> {
    const bookId = normalizeAccountId(accountId)
    const payload = await this.fetchImpl('/api/mp/cover', { bookId })
    return parseCover(payload, bookId)
  }

  /** Web 端文章列表（需完整 Cookie，否则 -2041）。一次 20 条，offset 翻页。 */
  async listMpArticles(bookId: string, offset: number): Promise<ArticleRef[]> {
    const payload = await this.fetchImpl('/web/mp/articles', { bookId, offset })
    if (isObj(payload) && typeof (payload as Record<string, unknown>).errCode === 'number') {
      const code = (payload as Record<string, unknown>).errCode as number
      if (code === -2041) throw Object.assign(new Error(`微信读书列表 -2041（需完整 Cookie 或风控）`), { code: -2041 })
      if (code) throw new Error(`微信读书 web/mp/articles errCode ${code}`)
    }
    const reviews = isObj(payload) && Array.isArray((payload as Record<string, unknown>).reviews)
      ? (payload as Record<string, unknown>).reviews as unknown[]
      : []
    const out: ArticleRef[] = []
    for (const r of reviews) {
      if (!isObj(r)) continue
      const sub = Array.isArray((r as Record<string, unknown>).subReviews) ? ((r as Record<string, unknown>).subReviews as unknown[])[0] : null
      if (!isObj(sub)) continue
      const reviewId = str((sub as Record<string, unknown>).reviewId)
      if (!reviewId) continue
      const mpInfo = isObj((sub as Record<string, unknown>).review) ? ((sub as Record<string, unknown>).review as Record<string, unknown>).mpInfo as Record<string, unknown> : (sub as Record<string, unknown>).mpInfo as Record<string, unknown>
      // 兼容两种结构：有 mpInfo 的取 title/pic_url，兜底用 review 层的 title
      const title = str(mpInfo?.title) || str((sub as Record<string, unknown>).reviewId) || ''
      const createTime = Number((r as Record<string, unknown>).createTime ?? (sub as Record<string, unknown>).createTime ?? 0)
      const url = `https://mp.weixin.qq.com/s/${encodeURIComponent(reviewId.split('_').pop() || reviewId)}`
      // 从 reviewId 提取 mid/idx 供判重（reviewId 形如 MP_WXS_..._<token>，token 含 mid/idx 需额外 fetch，此处先不填，靠 weread-auth 的 fetchCoverHtml 补）
      out.push({ url, title: title || reviewId, createTime })
    }
    // 兜底：如果 subReviews 解析为空，尝试直接从 reviews 的 review 层取
    if (!out.length && reviews.length) {
      for (const r of reviews) {
        if (!isObj(r)) continue
        const reviewId = str((r as Record<string, unknown>).reviewId)
        if (!reviewId) continue
        const createTime = Number((r as Record<string, unknown>).createTime ?? 0)
        out.push({ url: `https://mp.weixin.qq.com/s/${encodeURIComponent(reviewId.split('_').pop() || reviewId)}`, title: reviewId, createTime })
      }
    }
    return out
  }
}

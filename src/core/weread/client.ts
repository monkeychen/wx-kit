// src/core/weread/client.ts
// 微信读书 Web 客户端（Plan B）。由于移动端接口被风控，降级到 Web 端 /api/mp/cover。
import { parseCover, type WereadCover } from './parse-articles'
import { normalizeAccountId } from './book-id'
import type { WereadBookInfo } from './types'

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
}

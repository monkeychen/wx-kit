// src/core/weread/client.ts
// 微信读书文章列表客户端。HTTP 以 WereadFetch 注入（真实实现经 MpRequestGateway，
// kind=weread-list），本层只管分页语义与 ArticleRef 映射。
// /mp/chapters 的关键约束（wechrss 实测）：首页必须 synckey=0 且不带 offset；
// 翻页必须 offset 且不带 synckey——两种形态混用会被服务端直接拒绝。
import { parseChapters } from './parse-articles'
import { normalizeAccountId } from './book-id'
import type { WereadChapter, WereadBookInfo } from './types'
import type { ArticleRef, CrawlRange } from '../mp-types'

export type WereadFetch = (path: string, params: Record<string, string | number>) => Promise<unknown>

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object'
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

const toRef = (c: WereadChapter): ArticleRef => ({
  url: c.url,
  title: c.title,
  createTime: c.createTime,
  ...(c.readNum != null ? { readNum: c.readNum } : {}),
  ...(c.likeNum != null ? { likeNum: c.likeNum } : {}),
})

export class WereadClient {
  constructor(private readonly fetchImpl: WereadFetch) {}

  /** 单页。count 限幅 [1,50]（服务端上限）；非有限数值回退 20。 */
  async listPage(accountId: string, opts: { count: number; offset?: number }): Promise<WereadChapter[]> {
    const bookId = normalizeAccountId(accountId)
    const raw = Math.floor(opts.count)
    const count = Math.max(1, Math.min(Number.isFinite(raw) ? raw : 20, 50))
    const params = opts.offset == null
      ? { bookId, count, synckey: 0 }
      : { bookId, count, offset: Math.max(0, Math.floor(opts.offset)) }
    return parseChapters(await this.fetchImpl('/mp/chapters', params), bookId)
  }

  async bookInfo(accountId: string): Promise<WereadBookInfo> {
    const bookId = normalizeAccountId(accountId)
    const payload = await this.fetchImpl('/book/info', { bookId })
    const d = isObj(payload) ? (isObj(payload.data) ? payload.data : payload) : {}
    return {
      bookId: str(d.bookId) || bookId,
      title: str(d.title),
      author: str(d.author),
      coverImg: str(d.coverImg ?? d.cover),
    }
  }

  /**
   * 订阅检查用：翻到水位为止。列表按新→旧排列，某页出现 createTime <= sinceTs 即停
   * （与 mp-client.listArticlesSince 同语义：返回值可含旧文章，新旧过滤在编排层）。
   */
  async listChaptersSince(accountId: string, sinceTs: number, cap = 60): Promise<ArticleRef[]> {
    const bookId = normalizeAccountId(accountId)
    const out: ArticleRef[] = []
    let offset = 0
    for (;;) {
      const page = await this.listPage(bookId, { count: 20, offset })
      if (!page.length) break
      out.push(...page.map(toRef))
      if (page.some((c) => c.createTime <= sinceTs)) break
      if (out.length >= cap) break
      offset += page.length
    }
    return out
  }

  /** 按号批量下载用：count 补齐模式 / 日期窗口模式（与 mp-client.listArticles 同语义）。 */
  async listChaptersByRange(accountId: string, range: CrawlRange): Promise<ArticleRef[]> {
    const bookId = normalizeAccountId(accountId)
    const out: ArticleRef[] = []
    let offset = 0
    for (;;) {
      const page = await this.listPage(bookId, { count: 20, offset })
      if (!page.length) break
      if ('count' in range) {
        out.push(...page.map(toRef))
        if (out.length >= range.count) return out.slice(0, range.count)
      } else {
        const fromTs = Date.parse(`${range.from}T00:00:00`) / 1000
        const toTs = Date.parse(`${range.to}T23:59:59`) / 1000
        for (const c of page) {
          if (c.createTime > toTs) continue
          if (c.createTime < fromTs) return out
          out.push(toRef(c))
        }
      }
      offset += page.length
    }
    return out
  }
}

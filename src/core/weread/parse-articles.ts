// src/core/weread/parse-articles.ts
// /mp/chapters 响应解析：当前移动端 {data:[…]} 与旧版 reviews[].subReviews[] 双形态兼容。
// 错误码语义（we-mp-rss 文档 + wechrss 实现交叉验证）：
//   -2041/-2012/-2010 = 登录态失效或风控 → 翻译成既有 MpAuthExpired（上层已有处理路径，零重试）。
import { MpApiError, MpAuthExpired } from '../mp-errors'
import type { WereadChapter } from './types'

const MP_BASE = 'https://mp.weixin.qq.com'
const AUTH_OR_RISK_CODES = new Set([-2041, -2012, -2010])

export function checkWereadError(payload: Record<string, unknown>): void {
  const raw = payload.errCode ?? payload.errcode
  const code = typeof raw === 'number' ? raw : Number(raw ?? 0)
  if (!code || Number.isNaN(code)) return
  const msg = String(payload.errMsg ?? payload.errmsg ?? code)
  if (AUTH_OR_RISK_CODES.has(code)) {
    throw new MpAuthExpired(`微信读书登录态失效或被风控（${code}），请重新扫码登录`)
  }
  throw new MpApiError(code, `微信读书接口错误 ${code}: ${msg}`)
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object'

function toInt(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? Math.floor(n) : 0
}

/**
 * 由 mpInfo/review 拼出 mp.weixin 原文链接。候选顺序（wechrss 实测）：
 * doc_url/docUrl/url 直接可用 → originalId 的四种形态（完整 URL / "/s…" / "__biz=…" 查询串 / 裸 token）。
 * token 中的 '~' 是合法字符必须保留（encodeURIComponent 不编码它，天然满足）。
 */
export function articleUrlFromEntry(mpInfo: Record<string, unknown>, review: Record<string, unknown>): string {
  for (const key of ['doc_url', 'docUrl', 'url']) {
    const v = mpInfo[key] ?? review[key]
    if (typeof v === 'string' && /^https?:\/\//.test(v)) return v
  }
  const original = typeof mpInfo.originalId === 'string' ? mpInfo.originalId.trim() : ''
  if (!original) return ''
  if (/^https?:\/\//.test(original)) return original
  if (original.startsWith('/s')) return MP_BASE + original
  if (original.includes('__biz=') || original.startsWith('?')) {
    return `${MP_BASE}/s?${original.replace(/^\?/, '')}`
  }
  return `${MP_BASE}/s/${encodeURIComponent(original)}`
}

/**
 * reviewId 兜底拼原文链接：reviewId 形如 `<bookId>_<articleToken>`，
 * 末段即短链 token（we-mp-rss 生产用法——新版接口不给 originalId 时靠它）。
 */
export function urlFromReviewId(reviewId: string, bookId: string): string {
  const rid = (reviewId ?? '').trim()
  if (!rid) return ''
  let token = rid
  const prefix = `${bookId}_`
  if (prefix && rid.startsWith(prefix)) token = rid.slice(prefix.length)
  else if (token.includes('_')) token = token.split('_').pop() ?? token
  return `${MP_BASE}/s/${encodeURIComponent(token)}`
}

function chapterFrom(
  entry: Record<string, unknown>,
  groupTime: number,
  bookId: string,
): WereadChapter | null {
  const review = isObj(entry.review) ? entry.review : entry
  const mpInfo = isObj(review.mpInfo) ? review.mpInfo : {}
  const reviewId = String(review.reviewId ?? entry.reviewId ?? '').trim()
  const title = String(review.title ?? mpInfo.title ?? '').trim()
  if (!reviewId || !title) return null
  const createTime = firstPositive(mpInfo.time, review.createTime, entry.createTime, groupTime)
  const url = articleUrlFromEntry(mpInfo, review) || urlFromReviewId(reviewId, bookId)
  const readNum = toIntOrUndefined(mpInfo.readNum ?? mpInfo.read_num)
  const likeNum = toIntOrUndefined(mpInfo.likeNum ?? mpInfo.like_num)
  return {
    reviewId,
    title,
    createTime,
    url,
    digest: String(mpInfo.content ?? review.content ?? ''),
    coverUrl: String(mpInfo.pic_url ?? mpInfo.picUrl ?? ''),
    ...(readNum != null ? { readNum } : {}),
    ...(likeNum != null ? { likeNum } : {}),
  }
}

function toIntOrUndefined(v: unknown): number | undefined {
  if (v == null || v === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? Math.floor(n) : undefined
}

/** 时间戳候选链：0 视为缺失（unix 0 不可能是真实发布时间），与参考实现的 or 链语义一致。 */
function firstPositive(...vals: unknown[]): number {
  for (const v of vals) {
    const n = Number(v)
    if (Number.isFinite(n) && n > 0) return Math.floor(n)
  }
  return 0
}

/** 解析 /mp/chapters 载荷为章节列表。无法解析的条目跳过（脏数据不炸整页）。 */
export function parseChapters(payload: unknown, bookId: string): WereadChapter[] {
  if (!isObj(payload)) throw new MpApiError(-1, '微信读书 mp/chapters 返回不是对象')
  checkWereadError(payload)
  const out: WereadChapter[] = []

  if (Array.isArray(payload.data)) {
    for (const e of payload.data) {
      if (!isObj(e)) continue
      const c = chapterFrom(e, 0, bookId)
      if (c) out.push(c)
    }
    return out
  }

  // 旧版 reviews[].subReviews[] 形态（/web/mp/articles 同构，兼容保留）
  if (Array.isArray(payload.reviews)) {
    for (const g of payload.reviews) {
      if (!isObj(g)) continue
      const groupTime = toInt(g.createTime)
      for (const sub of (Array.isArray(g.subReviews) ? g.subReviews : [])) {
        if (!isObj(sub)) continue
        const c = chapterFrom(sub, groupTime, bookId)
        if (c) out.push(c)
      }
    }
  }
  return out
}

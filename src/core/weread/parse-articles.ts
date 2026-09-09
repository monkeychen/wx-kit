// src/core/weread/parse-articles.ts
// /api/mp/cover 响应解析：微信读书 Web 端增量订阅模式。
// 因移动端接口被风控（499/-2041），降级到 Web 端接口，每次仅返回公众号最新一篇文章。
import { MpApiError, MpAuthExpired } from '../mp-errors'

const MP_BASE = 'https://mp.weixin.qq.com'
// Web 端的错误码，如 -2010 用户不存在（Cookie 错误或未登录）
const AUTH_ERR_CODES = new Set([-2041, -2012, -2010])

export function checkWereadError(payload: Record<string, unknown>): void {
  const raw = payload.errCode ?? payload.errcode
  const code = typeof raw === 'number' ? raw : Number(raw ?? 0)
  if (!code || Number.isNaN(code)) return
  const msg = String(payload.errMsg ?? payload.errmsg ?? code)
  if (AUTH_ERR_CODES.has(code)) {
    throw new MpAuthExpired(`微信读书登录态失效或被风控（${code}），请重新扫码登录`)
  }
  throw new MpApiError(code, `微信读书接口错误 ${code}: ${msg}`)
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object'
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/**
 * reviewId 兜底拼原文链接：reviewId 形如 `MP_WXS_3634850725_ASnNRsaFFzxgK1-8AblYhw`，
 * 末段即短链 token。Web 接口不返回 originalId，只能靠它推导。
 */
export function urlFromReviewId(reviewId: string, bookId: string): string {
  const rid = (reviewId ?? '').trim()
  if (!rid) return ''
  let token = rid
  const prefix = `${bookId}_`
  if (prefix && rid.startsWith(prefix)) token = rid.slice(prefix.length)
  else if (token.includes('_')) token = token.split('_').pop() ?? token
  // 微信读书给 token 里的 `~` 与微信短链里的 `_` 是同一字符的两种形态（AGENTS.md）;
  // 真实可打开的短链用 `_`,且 token 本身 URL 安全——encodeURIComponent 会把 `~` 变 `%7E`
  // 导致开原文 404(v0.10.6 实录:花叔文章链接打不开)。
  return `${MP_BASE}/s/${token.replace(/~/g, '_')}`
}

export interface WereadCover {
  reviewId: string
  title: string
  url: string
  coverUrl: string
  accountName: string
}

/** 解析 /api/mp/cover 载荷为最新文章元数据。 */
export function parseCover(payload: unknown, bookId: string): WereadCover | null {
  if (!isObj(payload)) throw new MpApiError(-1, '微信读书 api/mp/cover 返回不是对象')
  checkWereadError(payload)

  const reviewId = str(payload.reviewId).trim()
  const title = str(payload.title).trim()
  
  if (!reviewId || !title) return null

  return {
    reviewId,
    title,
    url: urlFromReviewId(reviewId, bookId),
    coverUrl: str(payload.pic ?? payload.coverImg ?? ''),
    accountName: str(payload.name ?? ''),
  }
}

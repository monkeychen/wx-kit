import { MpRequestProtectionError } from './mp-errors'
import type { MpRequestKind } from './mp-request-governor'

export const PRIVATE_API_FEATURE_ENABLED = false

export const RETIRED_PRIVATE_API_COMMANDS: ReadonlySet<string> = new Set([
  'search', 'crawl', 'login', 'auth-status', 'session', 'subscription', 'protection',
])

export const RETIRED_PRIVATE_API_SETTING_KEYS: ReadonlySet<string> = new Set([
  'subscriptionAutoCheck',
  'subscriptionCheckTime',
  'subscriptionNewArticleAction',
  'subscriptionScheduleMode',
  'subscriptionIntervalHours',
])

export const MP_BACKEND_UNAVAILABLE_MESSAGE =
  '微信公众号后台已限制查询其他公众号的文章列表，该功能已停用，未发起网络请求。'

export const MP_BACKEND_UNAVAILABLE_ALTERNATIVE = '请使用 wx-kit download --url <文章链接>'

export function retiredPrivateApiResponse() {
  return {
    ok: false as const,
    error: {
      code: 'MP_BACKEND_UNAVAILABLE' as const,
      message: MP_BACKEND_UNAVAILABLE_MESSAGE,
      alternative: MP_BACKEND_UNAVAILABLE_ALTERNATIVE,
    },
  }
}

export function retiredPrivateApiError(): MpRequestProtectionError {
  return new MpRequestProtectionError('MP_BACKEND_UNAVAILABLE', MP_BACKEND_UNAVAILABLE_MESSAGE)
}

export function isRetiredPrivateRequest(kind: MpRequestKind): boolean {
  return kind === 'auth-verify' || kind === 'account-search' || kind === 'article-list'
}

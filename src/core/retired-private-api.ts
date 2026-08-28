import { MpRequestProtectionError } from './mp-errors'
import type { MpRequestKind } from './mp-request-governor'

/**
 * v0.10.0：订阅经由微信读书后端复活（M52）；「按公众号批量下载」因列表接口被服务端
 * 按账号封禁（2026-08-27 spike 终局，见 AGENTS.md）于 2026-08-28 再度停用——只退命令入口，
 * 不动 isRetiredPrivateRequest 的 MP 后台三类 kind 硬拒（M49 约束照旧）。
 */
export const PRIVATE_API_FEATURE_ENABLED = true

export const RETIRED_PRIVATE_API_COMMANDS: ReadonlySet<string> = new Set(['crawl'])

export const RETIRED_PRIVATE_API_SETTING_KEYS: ReadonlySet<string> = new Set()

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

/** MP 后台私有类别（与微信读书链路无关）在 gateway 里 transport 前拦截。 */
export function isRetiredPrivateRequest(kind: MpRequestKind): boolean {
  return kind === 'auth-verify' || kind === 'account-search' || kind === 'article-list'
}

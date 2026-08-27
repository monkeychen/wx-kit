import { MpRequestProtectionError } from './mp-errors'
import type { MpRequestKind } from './mp-request-governor'

/**
 * v0.10.0：按公众号下载与订阅已通过微信读书后端复活（M52），命令与设置全部恢复可用。
 * 下面的 RETIRED 集合随之清空；导出与字段保留，让 CLI 的过滤逻辑无需分支判断。
 * 注意 isRetiredPrivateRequest 仍然有效：MP 后台私有接口（auth-verify/account-search/article-list
 * 三类 kind）在 gateway transport 之前继续硬拒绝——M49 的「不得重新接回」约束不被微信读书链路触碰。
 */
export const PRIVATE_API_FEATURE_ENABLED = true

export const RETIRED_PRIVATE_API_COMMANDS: ReadonlySet<string> = new Set()

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

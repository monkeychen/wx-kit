// src/core/mp-errors.ts
/** ret=200013：频控。v0.8.6 起由全局网关熔断，调用方不得自动重试。 */
export class MpRateLimited extends Error { readonly code = 'RATE_LIMITED' }
/** ret=200040：登录态失效。调用方应引导重新登录（AUTH_REQUIRED）。 */
export class MpAuthExpired extends Error { readonly code = 'AUTH_REQUIRED' }
/** 其它非 0 ret。 */
export class MpApiError extends Error {
  readonly code = 'MP_API_ERROR'
  constructor(public ret: number, message: string) { super(message) }
}

export type MpProtectionErrorCode =
  | 'MP_BACKEND_UNAVAILABLE'
  | 'MP_GOVERNOR_PAUSED'
  | 'MP_RATE_LIMITED'
  | 'MP_COOLDOWN'
  | 'MP_REQUEST_CANCELLED'

export class MpRequestProtectionError extends Error {
  constructor(public readonly code: MpProtectionErrorCode, message: string) {
    super(message)
    this.name = 'MpRequestProtectionError'
  }
}

/** 所有下载层都必须保留全局停止信号，不能把它当作普通坏图或坏链接吞掉。 */
export function globalRequestStopCode(error: unknown): string | undefined {
  const value = error as { code?: string; status?: number } | null
  if (value?.status === 429) return 'RATE_LIMITED'
  const code = value?.code
  return code && ['RATE_LIMITED', 'MP_RATE_LIMITED', 'MP_GOVERNOR_PAUSED', 'MP_REQUEST_CANCELLED', 'AUTH_REQUIRED'].includes(code)
    ? code : undefined
}

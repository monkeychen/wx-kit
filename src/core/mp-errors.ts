// src/core/mp-errors.ts
/** ret=200013：频控。调用方应退避降速。 */
export class MpRateLimited extends Error { readonly code = 'RATE_LIMITED' }
/** ret=200040：登录态失效。调用方应引导重新登录（AUTH_REQUIRED）。 */
export class MpAuthExpired extends Error { readonly code = 'AUTH_REQUIRED' }
/** 其它非 0 ret。 */
export class MpApiError extends Error {
  readonly code = 'MP_API_ERROR'
  constructor(public ret: number, message: string) { super(message) }
}

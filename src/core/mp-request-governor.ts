/**
 * 微信请求保护的纯策略层。
 *
 * 它不碰网络、不读文件、不真的等待；调用方把 state/时钟/随机数传进来，
 * 因而可以在零微信访问下把所有决策钉死。所有类别共用 nextAllowedAt，
 * 避免「每条业务链都串行，但账号/IP视角仍然并发」的假安全。
 */
export type MpRequestKind =
  | 'auth-verify'
  | 'account-search'
  | 'article-list'
  | 'article-page'
  | 'article-asset'
  // v0.10.0 微信读书链路：登录/续期动作与列表请求分档（列表参考社区实测 2s 最小间隔）
  | 'weread-auth'
  | 'weread-list'

export type MpProtectionMode = 'active' | 'user-paused' | 'rate-limited'

export interface MpRequestState {
  version: 1
  mode: MpProtectionMode
  lastRequestAt: number | null
  nextAllowedAt: number
  pausedReason?: string
  rateLimitSignal?: string
  updatedAt: number
  inFlight?: { id: string; kind: MpRequestKind; startedAt: number; expiresAt: number }
}

export type MpRequestPlan =
  | { action: 'allow' }
  | { action: 'wait'; waitMs: number; until: number }
  | { action: 'reject'; code: 'MP_GOVERNOR_PAUSED' | 'MP_RATE_LIMITED'; reason: string }

/**
 * 经验保护值，不是微信官方阈值，也不表示低于它就一定安全。
 * 后台接口保守串行；同一篇文章的资源仍逐个受控，但不伪装成一次次人工点击。
 */
export const MP_REQUEST_INTERVALS: Record<MpRequestKind, readonly [number, number]> = {
  'auth-verify': [8_000, 15_000],
  'account-search': [8_000, 15_000],
  'article-list': [6_000, 12_000],
  'article-page': [3_000, 7_000],
  'article-asset': [250, 750],
  'weread-auth': [8_000, 15_000],
  'weread-list': [2_500, 5_000],
}

export function activeRequestState(now = Date.now()): MpRequestState {
  return { version: 1, mode: 'active', lastRequestAt: null, nextAllowedAt: 0, updatedAt: now }
}

/** M44–M47 的历史 fail-closed 初始态；M49 起不再作为生产默认，但保留实现。 */
export function protectiveRequestState(now = Date.now()): MpRequestState {
  return {
    version: 1,
    mode: 'user-paused',
    lastRequestAt: null,
    nextAllowedAt: 0,
    pausedReason: 'v0.8.6 请求保护首次启用，请确认后恢复微信访问',
    updatedAt: now,
  }
}

export function isMpRequestState(value: unknown): value is MpRequestState {
  if (!value || typeof value !== 'object') return false
  const v = value as Partial<MpRequestState>
  return v.version === 1
    && (v.mode === 'active' || v.mode === 'user-paused' || v.mode === 'rate-limited')
    && (v.lastRequestAt === null || typeof v.lastRequestAt === 'number')
    && typeof v.nextAllowedAt === 'number'
    && typeof v.updatedAt === 'number'
    && (!v.inFlight || (
      typeof v.inFlight.id === 'string'
      && typeof v.inFlight.kind === 'string'
      && v.inFlight.kind in MP_REQUEST_INTERVALS
      && typeof v.inFlight.startedAt === 'number'
      && typeof v.inFlight.expiresAt === 'number'
    ))
}

export function planRequest(state: MpRequestState, now: number): MpRequestPlan {
  if (state.mode === 'rate-limited') {
    return {
      action: 'reject', code: 'MP_RATE_LIMITED',
      reason: state.rateLimitSignal ?? state.pausedReason ?? '微信返回频控信号，已停止所有微信访问',
    }
  }
  if (state.mode === 'user-paused') {
    return {
      action: 'reject', code: 'MP_GOVERNOR_PAUSED',
      reason: state.pausedReason ?? '微信请求已暂停',
    }
  }
  const inFlightUntil = state.inFlight && state.inFlight.expiresAt > now ? state.inFlight.expiresAt : 0
  const until = Math.max(state.nextAllowedAt, inFlightUntil)
  if (now < until) {
    return { action: 'wait', waitMs: until - now, until }
  }
  return { action: 'allow' }
}

export function beginRequest(
  state: MpRequestState, id: string, kind: MpRequestKind, now: number, leaseMs: number,
): MpRequestState {
  return {
    ...state,
    inFlight: { id, kind, startedAt: now, expiresAt: now + Math.max(1, leaseMs) },
    updatedAt: now,
  }
}

/** 只允许预约者清自己的 in-flight，避免晚到的旧请求释放掉新请求。 */
export function completeRequest(state: MpRequestState, id: string, now = Date.now()): MpRequestState {
  if (state.inFlight?.id !== id) return state
  const { inFlight: _inFlight, ...rest } = state
  return { ...rest, updatedAt: now }
}

function intervalMs(kind: MpRequestKind, rng: () => number): number {
  const [min, max] = MP_REQUEST_INTERVALS[kind]
  const r = Math.max(0, Math.min(1, rng()))
  return Math.round(min + r * (max - min))
}

/** 在真正发请求前先预约下一窗口；持久化成功后才允许 transport 执行。 */
export function reserveRequest(
  state: MpRequestState, kind: MpRequestKind, now: number, rng: () => number = Math.random,
): MpRequestState {
  return {
    ...state,
    lastRequestAt: now,
    nextAllowedAt: now + intervalMs(kind, rng),
    updatedAt: now,
  }
}

export function pauseRequests(state: MpRequestState, reason: string, now = Date.now()): MpRequestState {
  return { ...state, mode: 'user-paused', pausedReason: reason, rateLimitSignal: undefined, updatedAt: now }
}

export function resumeRequests(state: MpRequestState, now = Date.now()): MpRequestState {
  return {
    ...state,
    mode: 'active',
    pausedReason: undefined,
    rateLimitSignal: undefined,
    // 恢复动作本身不联网；第一次明确操作可以立即申请窗口。
    nextAllowedAt: Math.min(state.nextAllowedAt, now),
    updatedAt: now,
  }
}

export function tripRateLimit(state: MpRequestState, signal: string, now = Date.now()): MpRequestState {
  return {
    ...state,
    mode: 'rate-limited',
    pausedReason: '检测到微信频控，已停止所有微信访问，不会自动重试',
    rateLimitSignal: signal,
    updatedAt: now,
  }
}

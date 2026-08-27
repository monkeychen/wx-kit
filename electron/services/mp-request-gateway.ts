import { MpRateLimited, MpRequestProtectionError } from '../../src/core/mp-errors'
import {
  pauseRequests,
  beginRequest,
  completeRequest,
  planRequest,
  reserveRequest,
  resumeRequests,
  tripRateLimit,
  type MpRequestKind,
  type MpRequestState,
} from '../../src/core/mp-request-governor'
import type { MpJson } from '../../src/core/mp-types'
import type { MpRequestStateStore } from './mp-request-state'
import { isRetiredPrivateRequest, retiredPrivateApiError } from '../../src/core/retired-private-api'

export { MpRequestProtectionError, type MpProtectionErrorCode } from '../../src/core/mp-errors'

export interface MpRequestTransport {
  json(url: string, timeoutMs: number, signal?: AbortSignal): Promise<MpJson>
  text(url: string, timeoutMs: number, signal?: AbortSignal): Promise<string>
  binary(url: string, timeoutMs: number, signal?: AbortSignal): Promise<{ data: Buffer; contentType: string }>
}

export interface MpRequestAuditEvent {
  time: number
  kind: MpRequestKind
  endpoint: string
  decision: 'allow' | 'wait' | 'reject' | 'rate-limited' | 'error'
  detail?: string
}

export interface MpRequestGatewayOptions {
  store: MpRequestStateStore
  transport: MpRequestTransport
  now?: () => number
  rng?: () => number
  wait?: (ms: number) => Promise<void>
  audit?: (event: MpRequestAuditEvent) => void | Promise<void>
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export interface MpProtectionStatus extends MpRequestState { queued: number }

/**
 * 所有微信生产流量的唯一决策出口。等待中的调用每秒重读一次持久状态，
 * 因而另一个 GUI/CLI 进程触发频控或暂停后，队列不会拿着旧决定继续发。
 */
export class MpRequestGateway {
  private readonly store: MpRequestStateStore
  private readonly transport: MpRequestTransport
  private readonly now: () => number
  private readonly rng: () => number
  private readonly wait: (ms: number) => Promise<void>
  private readonly audit: (event: MpRequestAuditEvent) => void | Promise<void>
  private queued = 0
  private sequence = 0

  constructor(opts: MpRequestGatewayOptions) {
    this.store = opts.store
    this.transport = opts.transport
    this.now = opts.now ?? Date.now
    this.rng = opts.rng ?? Math.random
    this.wait = opts.wait ?? delay
    this.audit = opts.audit ?? (() => {})
  }

  async status(): Promise<MpProtectionStatus> {
    return { ...(await this.store.read()), queued: this.queued }
  }

  async pause(reason = '用户主动暂停所有微信访问'): Promise<MpProtectionStatus> {
    await this.store.update((state) => ({ state: pauseRequests(state, reason, this.now()), value: undefined }))
    return this.status()
  }

  /** 恢复动作只改本地状态，本身绝不发探测请求。 */
  async resume(): Promise<MpProtectionStatus> {
    await this.store.update((state) => ({ state: resumeRequests(state, this.now()), value: undefined }))
    return this.status()
  }

  async requestJson(
    kind: Extract<MpRequestKind, 'auth-verify' | 'account-search' | 'article-list'>,
    endpoint: string,
    params: Record<string, string>,
    timeoutMs = 20_000,
    signal?: AbortSignal,
  ): Promise<MpJson> {
    // M49：私有后台链路在 transport 之前硬拒绝。即使旧 GUI/CLI/IPC 有遗漏，
    // 也不能通过等待、恢复保护状态或直接调用网关重新访问这些接口。
    if (isRetiredPrivateRequest(kind)) throw retiredPrivateApiError()
    const url = new URL(endpoint)
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
    return this.execute(kind, url.toString(), timeoutMs + 10_000, signal, async () => {
      const json = await this.transport.json(url.toString(), timeoutMs, signal)
      if (json.base_resp?.ret === 200013) {
        throw new MpRateLimited('微信频率限制（200013），已停止所有微信访问且不会自动重试')
      }
      return json
    })
  }

  /**
   * 微信读书业务请求（/mp/chapters、/book/info）。与 requestJson 分开：
   * MP 后台响应是 base_resp.ret 格式、微信读书是 errCode 格式，
   * 错误翻译在 core/weread/parse-articles（认证失效/风控语义不同），这里只做保护闸与传输。
   */
  async requestWereadJson(
    kind: Extract<MpRequestKind, 'weread-auth' | 'weread-list'>,
    url: string,
    timeoutMs = 20_000,
    signal?: AbortSignal,
  ): Promise<MpJson> {
    return this.execute(kind, url, timeoutMs + 10_000, signal, () => this.transport.json(url, timeoutMs, signal))
  }

  /** 扫码登录这类由 BrowserWindow 完成的用户动作，也必须先通过同一个保护闸。 */
  runAction<T>(kind: MpRequestKind, url: string, task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (isRetiredPrivateRequest(kind)) return Promise.reject(retiredPrivateApiError())
    return this.execute(kind, url, 10 * 60_000, signal, task)
  }

  fetchText(
    kind: Extract<MpRequestKind, 'article-page'>,
    url: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<string> {
    return this.execute(kind, url, timeoutMs + 10_000, signal, () => this.transport.text(url, timeoutMs, signal))
  }

  fetchBinary(
    url: string, timeoutMs: number, signal?: AbortSignal,
  ): Promise<{ data: Buffer; contentType: string }> {
    return this.execute('article-asset', url, timeoutMs + 10_000, signal, () => this.transport.binary(url, timeoutMs, signal))
  }

  private async execute<T>(
    kind: MpRequestKind, url: string, leaseMs: number, signal: AbortSignal | undefined, task: () => Promise<T>,
  ): Promise<T> {
    const endpoint = safeEndpoint(url)
    const requestId = `${process.pid}-${this.now()}-${++this.sequence}`
    this.queued++
    try {
      for (;;) {
        if (signal?.aborted) throw new MpRequestProtectionError('MP_REQUEST_CANCELLED', '请求已取消，未访问微信')
        const decision = await this.store.update((state) => {
          const plan = planRequest(state, this.now())
          return {
            state: plan.action === 'allow'
              ? beginRequest(reserveRequest(state, kind, this.now(), this.rng), requestId, kind, this.now(), leaseMs)
              : state,
            value: plan,
          }
        })
        if (decision.action === 'reject') {
          await this.audit({ time: this.now(), kind, endpoint, decision: 'reject', detail: decision.reason })
          throw new MpRequestProtectionError(decision.code, decision.reason)
        }
        if (decision.action === 'wait') {
          await this.audit({ time: this.now(), kind, endpoint, decision: 'wait', detail: String(decision.until) })
          // 每秒重读一次跨进程状态；另一个进程熔断后无需等完整间隔才停。
          await this.waitAbortable(Math.min(decision.waitMs, 1_000), signal)
          continue
        }
        try {
          await this.audit({ time: this.now(), kind, endpoint, decision: 'allow' })
          const result = await task()
          if (typeof result === 'string' && looksRateLimited(result)) {
            throw new MpRateLimited('微信返回频控或验证页面，已停止所有微信访问')
          }
          return result
        } catch (e) {
          if (e instanceof MpRateLimited || httpStatusOf(e) === 429) {
            await this.trip(e instanceof Error ? e.message : 'HTTP 429', kind, url)
          } else {
            await this.audit({ time: this.now(), kind, endpoint, decision: 'error', detail: errorCodeOf(e) })
          }
          throw e
        } finally {
          // 释放失败时保留短 lease，后续请求仍会保护性等待到过期；不能让它覆盖真正的网络错误。
          await this.store.update((state) => ({ state: completeRequest(state, requestId, this.now()), value: undefined }))
            .catch(() => {})
        }
      }
    } finally {
      this.queued--
    }
  }

  private async trip(signal: string, kind: MpRequestKind, url: string): Promise<void> {
    await this.store.update((state) => ({ state: tripRateLimit(state, signal, this.now()), value: undefined }))
    await this.audit({ time: this.now(), kind, endpoint: safeEndpoint(url), decision: 'rate-limited', detail: signal })
  }

  private async waitAbortable(ms: number, signal?: AbortSignal): Promise<void> {
    if (!signal) { await this.wait(ms); return }
    if (signal.aborted) throw new MpRequestProtectionError('MP_REQUEST_CANCELLED', '请求已取消，未访问微信')
    let rejectAbort!: (reason: unknown) => void
    const onAbort = () => rejectAbort(new MpRequestProtectionError('MP_REQUEST_CANCELLED', '请求已取消，未访问微信'))
    const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject })
    signal.addEventListener('abort', onAbort, { once: true })
    try { await Promise.race([this.wait(ms), aborted]) }
    finally { signal.removeEventListener('abort', onAbort) }
  }
}

function safeEndpoint(raw: string): string {
  try { const u = new URL(raw); return `${u.hostname}${u.pathname}` }
  catch { return 'invalid-url' }
}

function looksRateLimited(body: string): boolean {
  return body.includes('访问过于频繁')
    || body.includes('操作频繁，请稍后再试')
    || body.includes('当前环境异常')
}

function httpStatusOf(e: unknown): number | undefined {
  return (e as { status?: number; response?: { status?: number } })?.status
    ?? (e as { response?: { status?: number } })?.response?.status
}

function errorCodeOf(e: unknown): string {
  const code = (e as { code?: string })?.code
  return code ? String(code) : (e instanceof Error ? e.name : 'UNKNOWN')
}

import { diag, redactFreeText } from '../diag-log'
import type { TopicAiProviderId, TopicAiReasoningEffort } from './providers'
import { reasoningBodyFields } from './providers'
import type { TopicExtractionInput, TopicModel, TopicProposalInput } from './model'
import { createChatDeltaAccumulator, iterateSseData } from './sse'
import { preview, topicTrace } from './debug'
import { stageInstruction } from './prompts'

export interface ChatCompletionsConfig {
  baseUrl: string
  model: string
  apiKey: string
  /** 厂商标识：决定推理参数的厂商约定。CLI 路径不传 → 不下发任何推理参数。 */
  providerId?: TopicAiProviderId
  /** undefined = 不配置（保持现状）；true/false = 显式开/关推理 */
  reasoning?: boolean
  effort?: TopicAiReasoningEffort
  /** 兼容字段：等待响应头的上限（旧语义）；不设 = 不掐。 */
  timeoutMs?: number
  /** M75：流式默认不掐总时长（取消是用户的中断方式）；此值仅为「空闲上限」——连接建立后连续无字节。 */
  idleTimeoutMs?: number
  /** M75：流式增量回调（终端/UI 实时输出用）；构造注入，TopicModel 接口不变。 */
  onDelta?: (stage: 'extract' | 'propose', kind: 'content' | 'reasoning', text: string) => void
}

export type TopicFetch = (url: string, init: RequestInit) => Promise<Response>

export class TopicProviderError extends Error {
  constructor(public code: string, message: string) {
    super(message)
    this.name = 'TopicProviderError'
  }
}

function endpointFor(raw: string): string {
  let url: URL
  try { url = new URL(raw.trim()) } catch { throw new TopicProviderError('INVALID_BASE_URL', 'AI base URL 不是合法网址。') }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new TopicProviderError('INVALID_BASE_URL', 'AI base URL 只支持 http/https。')
  if (url.username || url.password || url.search || url.hash) throw new TopicProviderError('INVALID_BASE_URL', 'AI base URL 不能包含凭据、query 或 hash。')
  const pathname = url.pathname.replace(/\/+$/, '')
  url.pathname = pathname.endsWith('/chat/completions') ? pathname : `${pathname}/chat/completions`
  return url.toString().replace(/\/$/, '')
}

function parseJsonContent(content: string): unknown {
  const trimmed = content.trim()
  if (!trimmed) throw new TopicProviderError('EMPTY_CONTENT', '模型返回了空内容。')
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/.exec(trimmed)
  const jsonText = fenced ? fenced[1].trim() : trimmed
  try {
    const parsed = JSON.parse(jsonText) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not object')
    return parsed
  } catch {
    throw new TopicProviderError('INVALID_JSON_CONTENT', '模型内容不是严格的 JSON object。')
  }
}

export class ChatCompletionsTopicModel implements TopicModel {
  descriptor: { providerId: 'openai-compatible'; modelName: string }
  private endpoint: string
  private key: string
  private timeoutMs: number | null
  private inputTokens = 0
  private outputTokens = 0

  constructor(private config: ChatCompletionsConfig, private fetchImpl: TopicFetch = (url, init) => fetch(url, init)) {
    const model = config.model.trim()
    const key = config.apiKey.trim()
    if (!model) throw new TopicProviderError('MISSING_MODEL', 'AI model 不能为空。')
    if (!key) throw new TopicProviderError('MISSING_API_KEY', 'AI API Key 不能为空。')
    this.endpoint = endpointFor(config.baseUrl)
    this.key = key
    // M75：默认不掐总时长——长生成是正常的，用户等不及用 UI 取消。
    // timeoutMs 保留为「等待响应头」上限（旧语义，主要给测试与特殊部署）；
    // idleTimeoutMs 是流式空闲上限：连接建立后连续无字节（服务端黑洞）才触发。
    for (const value of [config.timeoutMs, config.idleTimeoutMs] as const) {
      if (value !== undefined && (!Number.isFinite(value) || value <= 0)) throw new TopicProviderError('INVALID_TIMEOUT', 'AI 请求超时必须为正数。')
    }
    this.timeoutMs = config.timeoutMs ?? null
    this.descriptor = { providerId: 'openai-compatible', modelName: model }
  }

  usage(): { inputTokens?: number; outputTokens?: number } | undefined {
    return this.inputTokens || this.outputTokens
      ? { inputTokens: this.inputTokens, outputTokens: this.outputTokens }
      : undefined
  }

  extract(input: TopicExtractionInput, signal?: AbortSignal): Promise<unknown> {
    return this.call('extract', input, signal)
  }

  propose(input: TopicProposalInput, signal?: AbortSignal): Promise<unknown> {
    return this.call('propose', input, signal)
  }

  private async call(stage: 'extract' | 'propose', input: TopicExtractionInput | TopicProposalInput, external?: AbortSignal): Promise<unknown> {
    const startedAt = Date.now()
    const timeouts: AbortSignal[] = []
    if (this.timeoutMs != null) timeouts.push(AbortSignal.timeout(this.timeoutMs))
    const signal = external && timeouts.length ? AbortSignal.any([external, ...timeouts])
      : external ?? timeouts[0]
    const system = `${input.rules.join('\n')}\n${stageInstruction(stage)}`
    const body = {
      model: this.descriptor.modelName,
      temperature: 0.1,
      stream: true,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: JSON.stringify(input) },
      ],
      ...reasoningBodyFields(this.config.providerId ?? 'custom', {
        reasoning: this.config.reasoning,
        effort: this.config.effort,
      }),
    }
    let response: Response
    topicTrace(`→ ${stage} 请求 POST ${this.endpoint} model=${this.descriptor.modelName} stream=1 body=${JSON.stringify(body).length} 字符\n${preview(JSON.stringify(body, null, 2))}`)
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'text/event-stream', authorization: `Bearer ${this.key}` },
        body: JSON.stringify(body),
        signal,
      })
    } catch (error) {
      topicTrace(`← ${stage} 请求失败 ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`)
      diag()?.warn('topics-ai', 'chat-completions', {
        stage, endpoint: this.endpoint, model: this.descriptor.modelName,
        outcome: 'network-error', ms: Date.now() - startedAt,
      })
      // 三种中断要分开报：用户取消透传 AbortError；等待响应超时是 TimeoutError；
      // 其余才是真正的网络错误。超时给行动引导而不是裸英文。
      if (error instanceof Error && error.name === 'AbortError') throw error
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new TopicProviderError('MODEL_TIMEOUT',
          `AI 服务在 ${Math.round((this.timeoutMs ?? 0) / 1000)} 秒内没有返回响应头。可缩小素材范围后重试，或稍后再试一次。`)
      }
      throw new TopicProviderError('NETWORK_ERROR', redactFreeText(error instanceof Error ? error.message : String(error)))
    }
    diag()?.info('topics-ai', 'chat-completions', {
      stage, endpoint: this.endpoint, model: this.descriptor.modelName,
      status: response.status, ok: response.ok, ms: Date.now() - startedAt,
    })
    const contentType = response.headers.get('content-type') ?? ''
    if (response.ok && contentType.includes('text/event-stream') && response.body) {
      return this.consumeStream(stage, response, signal)
    }
    // 非流式路径：错误体、或端点忽略 stream 请求返回普通 JSON（兼容回退，功能不倒退）。
    const raw = await response.text()
    topicTrace(`← ${stage} 响应 HTTP ${response.status}（${Date.now() - startedAt}ms，${raw.length} 字符，非流式）`)
    if (!response.ok) {
      const summary = redactFreeText(raw.slice(0, 500))
      topicTrace(`  错误体：${preview(raw.slice(0, 2000))}`)
      throw new TopicProviderError(`HTTP_${response.status}`, `AI 服务返回 HTTP ${response.status}${summary ? `：${summary}` : ''}`)
    }
    let envelope: unknown
    try { envelope = JSON.parse(raw) } catch { topicTrace(`  非 JSON 响应：${preview(raw.slice(0, 2000))}`); throw new TopicProviderError('INVALID_RESPONSE', 'AI 服务响应不是合法 JSON。') }
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) throw new TopicProviderError('INVALID_RESPONSE', 'AI 服务响应结构无效。')
    const obj = envelope as { choices?: Array<{ message?: { content?: unknown; reasoning_content?: unknown } }>; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } }
    const content = obj.choices?.[0]?.message?.content
    if (typeof content !== 'string') {
      topicTrace(`  响应缺少 content，完整 envelope：\n${preview(JSON.stringify(envelope, null, 2))}`)
      throw new TopicProviderError('INVALID_RESPONSE', 'AI 服务响应缺少 choices[0].message.content。')
    }
    const reasoning = obj.choices?.[0]?.message?.reasoning_content
    if (typeof reasoning === 'string' && reasoning.trim()) topicTrace(`  思考过程（${reasoning.length} 字符）：\n${preview(reasoning)}`)
    topicTrace(`  content：\n${preview(content)}`)
    if (typeof obj.usage?.prompt_tokens === 'number' && obj.usage.prompt_tokens >= 0) this.inputTokens += obj.usage.prompt_tokens
    if (typeof obj.usage?.completion_tokens === 'number' && obj.usage.completion_tokens >= 0) this.outputTokens += obj.usage.completion_tokens
    return parseJsonContent(content)
  }

  /** M75：SSE 流式消费——增量转发给 onDelta（终端/UI），聚合成完整 content 后走同一 JSON 校验。 */
  private async consumeStream(stage: 'extract' | 'propose', response: Response, signal?: AbortSignal): Promise<unknown> {
    const startedAt = Date.now()
    const idleMs = this.config.idleTimeoutMs ?? null
    const acc = createChatDeltaAccumulator()
    const reader = response.body!.getReader()
    let firstByteMs: number | null = null
    const idleError = () => new TopicProviderError('MODEL_IDLE_TIMEOUT', `AI 服务连续 ${Math.round((idleMs ?? 0) / 1000)} 秒没有产生任何输出。可以取消后重试。`)
    const abortError = () => Object.assign(new Error('cancelled'), { name: 'AbortError' })

    // 每次读一个网络 chunk：与「空闲上限」「用户取消」三方竞速。
    const raceRead = async (): Promise<ReadableStreamReadResult<Uint8Array>> => {
      const read = reader.read()
      let idleTimer: ReturnType<typeof setTimeout> | undefined
      let onAbort: (() => void) | undefined
      const racers: Promise<'data' | 'idle' | 'abort'>[] = [read.then(() => 'data' as const)]
      if (idleMs != null) racers.push(new Promise<'idle'>(resolve => { idleTimer = setTimeout(() => resolve('idle'), idleMs) }))
      if (signal) racers.push(new Promise<'abort'>(resolve => { onAbort = () => resolve('abort'); signal.addEventListener('abort', onAbort, { once: true }) }))
      try {
        const outcome = await Promise.race(racers)
        if (outcome === 'idle') { void reader.cancel().catch(() => {}); throw idleError() }
        if (outcome === 'abort') { void reader.cancel().catch(() => {}); throw abortError() }
        return await read
      } finally {
        if (idleTimer !== undefined) clearTimeout(idleTimer)
        if (onAbort && signal) signal.removeEventListener('abort', onAbort)
      }
    }
    const source = async function* (): AsyncGenerator<Uint8Array> {
      for (;;) {
        const result = await raceRead()
        if (result.done) return
        firstByteMs ??= Date.now() - startedAt
        yield result.value
      }
    }
    try {
      for await (const data of iterateSseData(source())) {
        let delta: { content: string; reasoning: string }
        try { delta = acc.push(data) }
        catch (protocolError) {
          throw new TopicProviderError('INVALID_RESPONSE', `流式响应块无效：${protocolError instanceof Error ? protocolError.message : String(protocolError)}`)
        }
        if (delta.content) this.config.onDelta?.(stage, 'content', delta.content)
        if (delta.reasoning) this.config.onDelta?.(stage, 'reasoning', delta.reasoning)
      }
    } catch (error) {
      if (error instanceof TopicProviderError) throw error
      if (error instanceof Error && error.name === 'AbortError') throw error
      topicTrace(`← ${stage} 流中断 ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`)
      throw new TopicProviderError('NETWORK_ERROR', redactFreeText(error instanceof Error ? error.message : String(error)))
    } finally {
      void reader.cancel().catch(() => {})
    }
    const { content, reasoning, usage } = acc.finish()
    topicTrace(`← ${stage} 流完成 HTTP ${response.status}（总 ${Date.now() - startedAt}ms，首字节 ${firstByteMs ?? '-'}ms，content ${content.length} 字符${reasoning ? `，思考 ${reasoning.length} 字符` : ''}）`)
    if (reasoning.trim()) topicTrace(`  思考过程：\n${preview(reasoning)}`)
    topicTrace(`  content：\n${preview(content)}`)
    if (usage?.inputTokens !== undefined) this.inputTokens += usage.inputTokens
    if (usage?.outputTokens !== undefined) this.outputTokens += usage.outputTokens
    if (!content.trim()) throw new TopicProviderError('EMPTY_CONTENT', '模型返回了空内容。')
    return parseJsonContent(content)
  }
}

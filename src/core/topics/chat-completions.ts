import { diag, redactFreeText } from '../diag-log'
import type { TopicExtractionInput, TopicModel, TopicProposalInput } from './model'

export interface ChatCompletionsConfig {
  baseUrl: string
  model: string
  apiKey: string
  timeoutMs?: number
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

function stageInstruction(stage: 'extract' | 'propose'): string {
  return stage === 'extract'
    ? '只返回 JSON object：{"items":[{"id","groupId","paragraphId","quote","kind","summary","theme"}]}。items 可以为空。'
    : '只返回 JSON object：{"cards":[...]}。每张卡包含 id/question/angle/readerValues/rationale/claims/evidence/evidenceConfidence/distributionEvidence/limitations/missingEvidence/outline；不得提供 statistics。cards 可以为空且最多三张。'
}

export class ChatCompletionsTopicModel implements TopicModel {
  descriptor: { providerId: 'openai-compatible'; modelName: string }
  private endpoint: string
  private key: string
  private timeoutMs: number
  private inputTokens = 0
  private outputTokens = 0

  constructor(private config: ChatCompletionsConfig, private fetchImpl: TopicFetch = (url, init) => fetch(url, init)) {
    const model = config.model.trim()
    const key = config.apiKey.trim()
    if (!model) throw new TopicProviderError('MISSING_MODEL', 'AI model 不能为空。')
    if (!key) throw new TopicProviderError('MISSING_API_KEY', 'AI API Key 不能为空。')
    this.endpoint = endpointFor(config.baseUrl)
    this.key = key
    this.timeoutMs = config.timeoutMs ?? 90_000
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) throw new TopicProviderError('INVALID_TIMEOUT', 'AI 请求超时必须为正数。')
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
    const timeout = AbortSignal.timeout(this.timeoutMs)
    const signal = external ? AbortSignal.any([external, timeout]) : timeout
    const system = `${input.rules.join('\n')}\n${stageInstruction(stage)}`
    const body = {
      model: this.descriptor.modelName,
      temperature: 0.1,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: JSON.stringify(input) },
      ],
    }
    let response: Response
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.key}` },
        body: JSON.stringify(body),
        signal,
      })
    } catch (error) {
      diag()?.warn('topics-ai', 'chat-completions', {
        stage, endpoint: this.endpoint, model: this.descriptor.modelName,
        outcome: 'network-error', ms: Date.now() - startedAt,
      })
      // 三种中断要分开报：用户取消透传 AbortError；等待响应超时是 TimeoutError；
      // 其余才是真正的网络错误。超时给行动引导而不是裸英文。
      if (error instanceof Error && error.name === 'AbortError') throw error
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new TopicProviderError('MODEL_TIMEOUT',
          `AI 服务在 ${Math.round(this.timeoutMs / 1000)} 秒内没有返回（素材越多耗时越长）。可缩小素材时间范围后重试，或稍后再试一次。`)
      }
      throw new TopicProviderError('NETWORK_ERROR', redactFreeText(error instanceof Error ? error.message : String(error)))
    }
    diag()?.info('topics-ai', 'chat-completions', {
      stage, endpoint: this.endpoint, model: this.descriptor.modelName,
      status: response.status, ok: response.ok, ms: Date.now() - startedAt,
    })
    const raw = await response.text()
    if (!response.ok) {
      const summary = redactFreeText(raw.slice(0, 500))
      throw new TopicProviderError(`HTTP_${response.status}`, `AI 服务返回 HTTP ${response.status}${summary ? `：${summary}` : ''}`)
    }
    let envelope: unknown
    try { envelope = JSON.parse(raw) } catch { throw new TopicProviderError('INVALID_RESPONSE', 'AI 服务响应不是合法 JSON。') }
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) throw new TopicProviderError('INVALID_RESPONSE', 'AI 服务响应结构无效。')
    const obj = envelope as { choices?: Array<{ message?: { content?: unknown } }>; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } }
    const content = obj.choices?.[0]?.message?.content
    if (typeof content !== 'string') throw new TopicProviderError('INVALID_RESPONSE', 'AI 服务响应缺少 choices[0].message.content。')
    if (typeof obj.usage?.prompt_tokens === 'number' && obj.usage.prompt_tokens >= 0) this.inputTokens += obj.usage.prompt_tokens
    if (typeof obj.usage?.completion_tokens === 'number' && obj.usage.completion_tokens >= 0) this.outputTokens += obj.usage.completion_tokens
    return parseJsonContent(content)
  }
}

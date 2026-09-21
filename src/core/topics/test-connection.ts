// AI 连接测试（M73）：发最小 chat 请求验证端点 + Key + 模型可用。
// 测的是「草稿配置」——renderer 传显式参数，apiKey 为空时由主进程回退已存 Key 再进来。
// 失败以 result 对象返回（不抛异常），上层无需 try/catch。

import { diag, redactFreeText } from '../diag-log'
import { TopicProviderError, type TopicFetch } from './chat-completions'

export interface TestConnectionInput {
  baseUrl: string
  model: string
  apiKey: string
  timeoutMs?: number
}

export type TestConnectionResult =
  | { ok: true; model: string; latencyMs: number; usage?: { inputTokens: number; outputTokens: number } }
  | { ok: false; error: TopicProviderError }

const DEFAULT_TIMEOUT_MS = 10_000

function toResult(error: unknown): { ok: false; error: TopicProviderError } {
  const wrapped = error instanceof TopicProviderError
    ? error
    : new TopicProviderError('NETWORK_ERROR', redactFreeText(error instanceof Error ? error.message : String(error)))
  return { ok: false, error: wrapped }
}

export async function testTopicAiConnection(
  input: TestConnectionInput,
  fetchImpl: TopicFetch = (url, init) => fetch(url, init),
): Promise<TestConnectionResult> {
  const model = input.model.trim()
  const key = input.apiKey.trim()
  const startedAt = Date.now()
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS
  if (!model) return { ok: false, error: new TopicProviderError('MISSING_MODEL', 'AI model 不能为空。') }
  if (!key) return { ok: false, error: new TopicProviderError('MISSING_API_KEY', 'AI API Key 不能为空。') }

  let endpoint: URL
  try {
    endpoint = new URL(input.baseUrl.trim())
    if (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:') throw new Error('protocol')
    const pathname = endpoint.pathname.replace(/\/+$/, '')
    endpoint.pathname = pathname.endsWith('/chat/completions') ? pathname : `${pathname}/chat/completions`
  } catch {
    return { ok: false, error: new TopicProviderError('INVALID_BASE_URL', 'AI base URL 不是合法的 http(s) 网址。') }
  }

  const timeout = AbortSignal.timeout(timeoutMs)
  try {
    const response = await fetchImpl(endpoint.toString(), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }),
      signal: timeout,
    })
    if (!response.ok) {
      const summary = redactFreeText((await response.text()).slice(0, 500))
      throw new TopicProviderError(`HTTP_${response.status}`, `AI 服务返回 HTTP ${response.status}${summary ? `：${summary}` : ''}`)
    }
    const raw = await response.text()
    let envelope: unknown
    try { envelope = JSON.parse(raw) } catch { throw new TopicProviderError('INVALID_RESPONSE', 'AI 服务响应不是合法 JSON。') }
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
      throw new TopicProviderError('INVALID_RESPONSE', 'AI 服务响应结构无效。')
    }
    // 只验证「服务能答」：reasoning 模型可能把 max_tokens 全花在思考上导致 content 为空，
    // 因此不要求 choices[0].message.content 存在。usage 有则透出，没有不编造。
    const usage = (envelope as { usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } }).usage
    const latencyMs = Date.now() - startedAt
    diag()?.info('topics-ai', 'test-connection', {
      endpoint: endpoint.toString(), model, status: response.status, ok: true, ms: latencyMs,
    })
    return {
      ok: true,
      model,
      latencyMs,
      usage: typeof usage?.prompt_tokens === 'number' && typeof usage?.completion_tokens === 'number'
        ? { inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens }
        : undefined,
    }
  } catch (error) {
    const latencyMs = Date.now() - startedAt
    if (error instanceof TopicProviderError) {
      diag()?.info('topics-ai', 'test-connection', {
        endpoint: endpoint.toString(), model, outcome: error.code, ms: latencyMs,
      })
      return { ok: false, error }
    }
    if (error instanceof Error && error.name === 'AbortError') {
      return { ok: false, error: new TopicProviderError('MODEL_TIMEOUT', `AI 服务在 ${Math.round(timeoutMs / 1000)} 秒内没有返回。请检查网络或代理后重试。`) }
    }
    if (error instanceof Error && error.name === 'TimeoutError') {
      return { ok: false, error: new TopicProviderError('MODEL_TIMEOUT', `AI 服务在 ${Math.round(timeoutMs / 1000)} 秒内没有返回。请检查网络或代理后重试。`) }
    }
    diag()?.warn('topics-ai', 'test-connection', {
      endpoint: endpoint.toString(), model, outcome: 'network-error', ms: latencyMs,
    })
    return toResult(error)
  }
}

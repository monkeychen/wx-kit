import { describe, expect, it } from 'vitest'
import { testTopicAiConnection, type TestConnectionResult } from '../../../src/core/topics/test-connection'
import { TopicProviderError, type TopicFetch } from '../../../src/core/topics/chat-completions'

const okEnvelope = (usage?: Record<string, number>) => new Response(
  JSON.stringify({ choices: [{ message: { content: '' } }], ...(usage ? { usage } : {}) }),
  { status: 200, headers: { 'content-type': 'application/json' } },
)

/** 流式信封：一个 delta 块 + 可选 usage + [DONE]。 */
const sseEnvelope = (usage?: Record<string, number>, content = 'PONG') => new Response(
  `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`
  + (usage ? `data: ${JSON.stringify({ choices: [], usage })}\n\n` : '')
  + 'data: [DONE]\n\n',
  { status: 200, headers: { 'content-type': 'text/event-stream' } },
)

/** 断言成功并收窄类型（TS 不从 expect 推断判别联合）。 */
function assertOk(result: TestConnectionResult): asserts result is Extract<TestConnectionResult, { ok: true }> {
  if (!result.ok) throw new Error(`期望成功，实际 ${result.error.code}: ${result.error.message}`)
}
function assertFail(result: TestConnectionResult): asserts result is Extract<TestConnectionResult, { ok: false }> {
  if (result.ok) throw new Error('期望失败，实际成功')
}

describe('AI 连接测试（最小连通性请求）', () => {
  it('成功：发最小请求、报告延迟与 usage；不要求 choices 内容非空', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown>; headers: Headers }> = []
    const fetchImpl: TopicFetch = async (url, init) => {
      calls.push({ url, body: JSON.parse(String(init.body)), headers: new Headers(init.headers) })
      return okEnvelope({ prompt_tokens: 12, completion_tokens: 1 })
    }
    const result = await testTopicAiConnection(
      { baseUrl: 'https://api.example.invalid/v1', model: 'glm-5.3-flash', apiKey: 'secret-key' },
      fetchImpl,
    )
    assertOk(result)
    expect(result.latencyMs).toBeGreaterThanOrEqual(0)
    expect(result.model).toBe('glm-5.3-flash')
    expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 1 })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://api.example.invalid/v1/chat/completions')
    expect(calls[0].headers.get('authorization')).toBe('Bearer secret-key')
    expect(calls[0].body).toMatchObject({
      model: 'glm-5.3-flash', max_tokens: 1,
      messages: [{ role: 'user', content: 'ping' }],
    })
  })

  it('响应缺少 usage 时不编造 token 数据', async () => {
    const result = await testTopicAiConnection(
      { baseUrl: 'https://api.example.invalid/v1', model: 'm', apiKey: 'k' },
      async () => okEnvelope(),
    )
    assertOk(result)
    expect(result.usage).toBeUndefined()
  })

  it('401 原样归类为 HTTP_401，错误信息脱敏', async () => {
    const result = await testTopicAiConnection(
      { baseUrl: 'https://api.example.invalid/v1', model: 'm', apiKey: 'k' },
      async () => new Response('api_key=abc123 invalid', { status: 401 }),
    )
    assertFail(result)
    expect(result.error.code).toBe('HTTP_401')
    expect(result.error.message).not.toContain('abc123')
  })

  it('等待响应超时返回 MODEL_TIMEOUT 并带中文引导', async () => {
    const result = await testTopicAiConnection(
      { baseUrl: 'https://api.example.invalid/v1', model: 'm', apiKey: 'k', timeoutMs: 20 },
      async (_url, init) => new Promise((_resolve, reject) => {
        init.signal!.addEventListener('abort', () =>
          reject(Object.assign(new Error('aborted due to timeout'), { name: 'TimeoutError' })), { once: true })
      }),
    )
    assertFail(result)
    expect(result.error.code).toBe('MODEL_TIMEOUT')
    expect(result.error.message).toContain('秒内没有返回')
  })

  it('响应不是合法 JSON 报 INVALID_RESPONSE', async () => {
    const result = await testTopicAiConnection(
      { baseUrl: 'https://api.example.invalid/v1', model: 'm', apiKey: 'k' },
      async () => new Response('<html>gateway</html>', { status: 200 }),
    )
    assertFail(result)
    expect(result.error.code).toBe('INVALID_RESPONSE')
  })

  it('流式请求：stream:true + accept SSE；首 token 延迟透出', async () => {
    const calls: Array<{ body: Record<string, unknown>; headers: Headers }> = []
    const fetchImpl: TopicFetch = async (_url, init) => {
      calls.push({ body: JSON.parse(String(init.body)), headers: new Headers(init.headers) })
      return sseEnvelope({ prompt_tokens: 12, completion_tokens: 1 })
    }
    const result = await testTopicAiConnection(
      { baseUrl: 'https://api.example.invalid/v1', model: 'm', apiKey: 'k' },
      fetchImpl,
    )
    assertOk(result)
    expect(calls[0].body).toMatchObject({ stream: true })
    expect(calls[0].headers.get('accept')).toBe('text/event-stream')
    expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 1 })
    expect(result.firstByteMs).toBeTypeOf('number')
  })

  it('流式 reasoning 模型 content 全空也算连通（不要求正文）', async () => {
    const result = await testTopicAiConnection(
      { baseUrl: 'https://api.example.invalid/v1', model: 'm', apiKey: 'k' },
      async () => new Response(
        `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: '思考中' } }] })}\n\n`
        + 'data: [DONE]\n\n',
        { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    )
    assertOk(result)
  })

  it('SSE 中途非法块归类协议错误，不伪装成功', async () => {
    const result = await testTopicAiConnection(
      { baseUrl: 'https://api.example.invalid/v1', model: 'm', apiKey: 'k' },
      async () => new Response('data: not-json\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    )
    assertFail(result)
    expect(result.error.code).toBe('INVALID_RESPONSE')
  })

  it('无效配置（缺 model）以结果对象而非异常返回', async () => {
    const result = await testTopicAiConnection(
      { baseUrl: 'https://api.example.invalid/v1', model: ' ', apiKey: 'k' },
      async () => okEnvelope(),
    )
    assertFail(result)
    expect(result.error.code).toBe('MISSING_MODEL')
  })

  it('失败分支不抛异常、返回可判别的 result（上层零 try/catch）', async () => {
    const fetchImpl: TopicFetch = async () => { throw new Error('dns broken') }
    const result = await testTopicAiConnection(
      { baseUrl: 'https://api.example.invalid/v1', model: 'm', apiKey: 'k' },
      fetchImpl,
    )
    assertFail(result)
    expect(result.error).toBeInstanceOf(TopicProviderError)
  })
})

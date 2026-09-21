// OpenAI Chat Completions 的 SSE（text/event-stream）解析。
// M75 起流式是模型通道的标准形态：chat-completions 与 test-connection 共用这里的解析器。
// 只认 spec 要求的最小集：data: 字段（同事件多行以 \n 连接）、[DONE] 终止、注释行忽略；
// 处理网络分包导致的跨 chunk 断行与 CRLF。

async function* toAsyncIterable(stream: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader = stream.getReader()
  try {
    for (;;) {
      const result = await reader.read()
      if (result.done) return
      yield result.value
    }
  } finally {
    reader.releaseLock()
  }
}

export interface ChatUsage { inputTokens?: number; outputTokens?: number }
export interface ChatStreamDelta { content: string; reasoning: string }

/** 从字节流中产出每个事件的 data 文本（[DONE] 前终止）。 */
export async function* iterateSseData(body: AsyncIterable<Uint8Array> | ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let pending: string[] = []

  const flushEvent = (): string | null => {
    if (pending.length === 0) return null
    const data = pending.join('\n')
    pending = []
    return data === '[DONE]' ? DONE : data
  }

  const DONE = Symbol('done') as unknown as string

  const handleLine = (line: string): string | null => {
    if (line === '') return flushEvent()
    if (line.startsWith(':')) return null
    if (line.startsWith('data:')) {
      const value = line.slice(5)
      pending.push(value.startsWith(' ') ? value.slice(1) : value)
    }
    // 其它字段（event:/id:/retry:）忽略：本解析只消费 data。
    return null
  }

  const lines: string[] = []
  const chunks = typeof (body as AsyncIterable<Uint8Array>)[Symbol.asyncIterator] === 'function'
    ? body as AsyncIterable<Uint8Array>
    : toAsyncIterable(body as ReadableStream<Uint8Array>)
  for await (const chunk of chunks) {
    buffer += decoder.decode(chunk, { stream: true })
    let index = buffer.indexOf('\n')
    while (index !== -1) {
      const line = buffer.slice(0, index).replace(/\r$/, '')
      buffer = buffer.slice(index + 1)
      const event = handleLine(line)
      if (event === DONE) return
      if (event !== null) yield event
      index = buffer.indexOf('\n')
    }
  }
  // 流结束时 buffer 里的残行 + 未 flush 的事件（服务端省掉末尾空行也要收尾）
  if (buffer) {
    const event = handleLine(buffer.replace(/\r$/, ''))
    if (event === DONE) return
    if (event !== null) lines.push(event)
  }
  const tail = flushEvent()
  if (tail === DONE) return
  if (tail !== null) lines.push(tail)
  for (const line of lines) yield line
}

export interface ChatDeltaAccumulator {
  /** 消费一条 data；返回本块新增的增量（可能为空串）。 */
  push(data: string): ChatStreamDelta
  finish(): { content: string; reasoning: string; usage?: ChatUsage }
}

/** 流式增量累加器：onDelta 转发 + 最终聚合共用一个实例。 */
export function createChatDeltaAccumulator(): ChatDeltaAccumulator {
  let content = ''
  let reasoning = ''
  let usage: ChatUsage | undefined
  return {
    push(data) {
      let parsed: {
        choices?: Array<{ delta?: { content?: unknown; reasoning_content?: unknown } }>
        usage?: { prompt_tokens?: unknown; completion_tokens?: unknown }
      }
      try { parsed = JSON.parse(data) }
      catch { throw new Error('流式响应块不是合法 JSON。') }
      const delta = parsed.choices?.[0]?.delta
      const pieceContent = typeof delta?.content === 'string' ? delta.content : ''
      const pieceReasoning = typeof delta?.reasoning_content === 'string' ? delta.reasoning_content : ''
      content += pieceContent
      reasoning += pieceReasoning
      if (parsed.usage && typeof parsed.usage === 'object') {
        const next: ChatUsage = {}
        if (typeof parsed.usage.prompt_tokens === 'number') next.inputTokens = parsed.usage.prompt_tokens
        if (typeof parsed.usage.completion_tokens === 'number') next.outputTokens = parsed.usage.completion_tokens
        if (next.inputTokens !== undefined || next.outputTokens !== undefined) usage = next
      }
      return { content: pieceContent, reasoning: pieceReasoning }
    },
    finish() {
      return { content, reasoning, ...(usage ? { usage } : {}) }
    },
  }
}

export function collectChatDeltas(dataLines: Iterable<string>): { content: string; reasoning: string; usage?: ChatUsage } {
  const acc = createChatDeltaAccumulator()
  for (const line of dataLines) acc.push(line)
  return acc.finish()
}

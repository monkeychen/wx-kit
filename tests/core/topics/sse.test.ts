import { describe, expect, it } from 'vitest'
import { collectChatDeltas, iterateSseData } from '../../../src/core/topics/sse'

const enc = (text: string) => new TextEncoder().encode(text)

async function* chunks(...items: string[]): AsyncIterable<Uint8Array> {
  for (const item of items) yield enc(item)
}

async function drain(source: AsyncIterable<Uint8Array>): Promise<string[]> {
  const out: string[] = []
  for await (const data of iterateSseData(source)) out.push(data)
  return out
}

describe('SSE data 行解析', () => {
  it('单 chunk 多条 data 行', async () => {
    const source = chunks('data: {"a":1}\n\ndata: {"a":2}\n\n')
    expect(await drain(source)).toEqual(['{"a":1}', '{"a":2}'])
  })

  it('data 跨 chunk 断开（网络分包）也能拼回', async () => {
    const source = chunks('data: {"par', 'tial":tr', 'ue}\n\ndata: x\n\n')
    expect(await drain(source)).toEqual(['{"partial":true}', 'x'])
  })

  it('CRLF 与多行 data 合并（spec：同一事件内多 data 行以换行连接）', async () => {
    const source = chunks('data: line1\r\ndata: line2\r\n\r\n')
    expect(await drain(source)).toEqual(['line1\nline2'])
  })

  it('[DONE] 终止且不产出', async () => {
    const source = chunks('data: ok\n\n', 'data: [DONE]\n\n', 'data: after\n\n')
    expect(await drain(source)).toEqual(['ok'])
  })

  it('注释行与其它字段忽略；无末尾空行时收尾 flush', async () => {
    const source = chunks(': keep-alive\nevent: foo\ndata: tail')
    expect(await drain(source)).toEqual(['tail'])
  })
})

describe('chat delta 聚合', () => {
  it('content/reasoning 增量累计、usage 取最后一个带 usage 的块', () => {
    const result = collectChatDeltas([
      JSON.stringify({ choices: [{ delta: { content: '你好' } }] }),
      JSON.stringify({ choices: [{ delta: { reasoning_content: '想' } }] }),
      JSON.stringify({ choices: [{ delta: { content: '，世界' }, finish_reason: 'stop' }] }),
      JSON.stringify({ choices: [], usage: { prompt_tokens: 30, completion_tokens: 7 } }),
    ])
    expect(result.content).toBe('你好，世界')
    expect(result.reasoning).toBe('想')
    expect(result.usage).toEqual({ inputTokens: 30, outputTokens: 7 })
  })

  it('非 JSON data 块按协议错误抛出', () => {
    expect(() => collectChatDeltas(['not json'])).toThrow(/流式/)
  })
})

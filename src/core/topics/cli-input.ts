import { resolveTopicWindow } from './time-window'
import type { TopicWindow } from './types'

export class TopicCliInputError extends Error {
  constructor(public code: string, message: string) {
    super(message)
    this.name = 'TopicCliInputError'
  }
}

export interface TopicCliModelConfig {
  baseUrl: string
  model: string
  apiKey: string
}

export function resolveTopicWindowArgs(
  opts: { range?: string; from?: string; to?: string; article?: string[] },
  asOfMs: number = Date.now(),
): TopicWindow {
  const articles = (opts.article ?? []).flatMap(value => String(value).split(',')).map(id => id.trim()).filter(Boolean)
  if (articles.length > 0) {
    // --article 与时间参数互斥：素材源只能有一个。
    if (opts.range !== undefined || opts.from !== undefined || opts.to !== undefined) {
      throw new TopicCliInputError('INVALID_TOPIC_RANGE', '--article 与 --range/--from/--to 不能同时使用。')
    }
    try { return resolveTopicWindow({ preset: 'manual', articleIds: articles }, asOfMs) }
    catch (error) { throw new TopicCliInputError('INVALID_TOPIC_RANGE', error instanceof Error ? error.message : String(error)) }
  }
  const range = (opts.range ?? '24h').trim().toLowerCase()
  if (range === 'custom') {
    if (!opts.from?.trim() || !opts.to?.trim()) {
      throw new TopicCliInputError('INVALID_TOPIC_RANGE', 'custom 范围必须同时提供 --from 和 --to。')
    }
    try { return resolveTopicWindow({ preset: 'custom', from: opts.from, to: opts.to }, asOfMs) }
    catch (error) { throw new TopicCliInputError('INVALID_TOPIC_RANGE', error instanceof Error ? error.message : String(error)) }
  }
  if (opts.from !== undefined || opts.to !== undefined) {
    throw new TopicCliInputError('INVALID_TOPIC_RANGE', '--from/--to 只能与 --range custom 一起使用。')
  }
  if (range !== '24h' && range !== '3d' && range !== '7d') {
    throw new TopicCliInputError('INVALID_TOPIC_RANGE', '--range 只接受 24h、3d、7d 或 custom。')
  }
  return resolveTopicWindow({ preset: range as '24h' | '3d' | '7d' }, asOfMs)
}

export function resolveTopicCliModelConfig(
  opts: { baseUrl?: string; model?: string },
  env: NodeJS.ProcessEnv,
): TopicCliModelConfig {
  const baseUrl = (opts.baseUrl ?? env.WXKIT_AI_BASE_URL ?? '').trim()
  const model = (opts.model ?? env.WXKIT_AI_MODEL ?? '').trim()
  const apiKey = (env.WXKIT_AI_API_KEY ?? '').trim()
  if (!baseUrl) throw new TopicCliInputError('MISSING_AI_BASE_URL', '缺少 AI base URL：使用 --base-url 或 WXKIT_AI_BASE_URL。')
  if (!model) throw new TopicCliInputError('MISSING_AI_MODEL', '缺少 AI model：使用 --model 或 WXKIT_AI_MODEL。')
  if (!apiKey) throw new TopicCliInputError('MISSING_AI_API_KEY', '缺少 WXKIT_AI_API_KEY 环境变量。')
  return { baseUrl, model, apiKey }
}

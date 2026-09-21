import { randomUUID } from 'node:crypto'
import { diag, redactFreeText } from '../diag-log'
import type { ArticleMeta } from '../types'
import {
  TOPIC_EXTRACT_VERSION,
  TOPIC_PROPOSE_VERSION,
  TOPIC_SYSTEM_VERSION,
  makeTopicExtractionInput,
  makeTopicProposalInput,
  type TopicModel,
} from './model'
import { buildTopicSnapshot, type TopicSnapshotDeps } from './snapshot'
import { TopicProviderError } from './chat-completions'
import { TopicRunStore } from './store'
import { topicTrace } from './debug'
import type { TopicFailure, TopicRunResult, TopicTraceEvent, TopicWindow } from './types'
import { TopicModelOutputError, parseTopicExtractions, validateTopicProposals } from './validate'

export interface AnalyzeTopicsDeps {
  libraryRoot: string
  model: TopicModel
  store: TopicRunStore
  readContent?: TopicSnapshotDeps['readContent']
  now?: () => Date
  makeRunId?: () => string
  onStage?: (stage: TopicTraceEvent['stage']) => void
}

export interface AnalyzeTopicsInput {
  window: TopicWindow
  articles: readonly ArticleMeta[]
  signal?: AbortSignal
}

const abortError = (): Error => Object.assign(new Error('选题分析已取消。'), { name: 'AbortError' })
const isAbort = (error: unknown, signal?: AbortSignal): boolean => signal?.aborted === true
  || (error instanceof Error && error.name === 'AbortError')

function failureOf(error: unknown): TopicFailure {
  if (error instanceof TopicModelOutputError) return { code: error.code, message: redactFreeText(error.message) }
  // 超时保留专用码与引导文案，不与通用网络错误混在一起
  if (error instanceof TopicProviderError) return { code: error.code, message: redactFreeText(error.message) }
  return { code: 'MODEL_REQUEST_FAILED', message: redactFreeText(error instanceof Error ? error.message : String(error)) }
}

export async function analyzeTopics(deps: AnalyzeTopicsDeps, input: AnalyzeTopicsInput): Promise<TopicRunResult> {
  const clock = deps.now ?? (() => new Date())
  const startedAt = clock()
  const startedMs = startedAt.getTime()
  const runId = deps.makeRunId?.() ?? `topic-${startedMs}-${randomUUID().slice(0, 8)}`
  const model = {
    providerId: deps.model.descriptor.providerId,
    modelName: deps.model.descriptor.modelName,
    systemVersion: TOPIC_SYSTEM_VERSION,
    taskVersion: `${TOPIC_EXTRACT_VERSION}+${TOPIC_PROPOSE_VERSION}`,
  }
  const duration = (): number => Math.max(0, clock().getTime() - startedMs)
  const notify = (stage: TopicTraceEvent['stage']): void => {
    try { deps.onStage?.(stage) } catch { /* UI/CLI 进度回调不能改变业务结果 */ }
  }
  const trace = async (event: Omit<TopicTraceEvent, 'time'>): Promise<void> => {
    try { await deps.store.appendTrace(runId, { time: clock().toISOString(), ...event }) }
    catch (error) { diag()?.warn('topics', 'trace-failed', { runId, message: error instanceof Error ? error.message : String(error) }) }
  }

  const snapshot = await buildTopicSnapshot({
    libraryRoot: deps.libraryRoot,
    ...(deps.readContent ? { readContent: deps.readContent } : {}),
    now: () => startedAt,
  }, { runId, window: input.window, articles: input.articles })
  const manifestPath = await deps.store.writeManifest(runId, snapshot)
  notify('snapshot')
  await trace({ stage: 'snapshot', status: 'done', counts: { articles: snapshot.articles.length, groups: snapshot.groups.length, excluded: snapshot.excluded.length }, durationMs: duration() })
  diag()?.info('topics', 'snapshot', { runId, articles: snapshot.articles.length, groups: snapshot.groups.length, excluded: snapshot.excluded.length })

  const base = () => {
    const usage = deps.model.usage?.()
    return {
      schemaVersion: 1 as const,
      runId,
      window: input.window,
      manifestPath,
      createdAt: startedAt.toISOString(),
      durationMs: duration(),
      model,
      ...(usage ? { usage } : {}),
    }
  }
  const persist = async (result: TopicRunResult): Promise<TopicRunResult> => {
    try {
      await deps.store.writeResult(runId, result)
      await trace({ stage: 'result', status: 'done', counts: { cards: 'cards' in result ? result.cards.length : 0 }, durationMs: result.durationMs })
      return result
    } catch (error) {
      const failed: TopicRunResult = {
        ...base(), status: 'failed', cards: [],
        error: { code: 'STORE_RESULT_FAILED', message: redactFreeText(error instanceof Error ? error.message : String(error)) },
      }
      await trace({ stage: 'result', status: 'failed', error: failed.error, durationMs: failed.durationMs })
      return failed
    }
  }

  if (snapshot.articles.length === 0) {
    return persist({ ...base(), status: 'insufficient-material', cards: [], reason: '所选范围没有可分析的文字素材。' })
  }

  let stage: TopicTraceEvent['stage'] = 'extract'
  try {
    if (input.signal?.aborted) throw abortError()
    notify('extract')
    await trace({ stage: 'extract', status: 'start' })
    const rawExtractions = await deps.model.extract(makeTopicExtractionInput(snapshot), input.signal)
    await trace({ stage: 'extract', status: 'done' })

    stage = 'validate-extract'
    const extracted = parseTopicExtractions(rawExtractions, snapshot)
    topicTrace(`校验 extract：${extracted.items.length} 有效 / ${extracted.failures.length} 失败`)
    await trace({ stage, status: 'done', counts: { valid: extracted.items.length, invalid: extracted.failures.length } })
    if (extracted.items.length === 0 && extracted.failures.length > 0) {
      return persist({
        ...base(), status: 'failed', cards: [],
        error: { code: 'NO_VALID_EXTRACTIONS', message: `模型材料提取没有通过校验：${extracted.failures.map(item => item.code).join(', ')}` },
      })
    }

    if (input.signal?.aborted) throw abortError()
    stage = 'propose'
    notify('propose')
    await trace({ stage, status: 'start' })
    const rawProposals = await deps.model.propose(makeTopicProposalInput(snapshot, extracted.items), input.signal)
    await trace({ stage, status: 'done' })

    stage = 'validate-propose'
    const proposed = validateTopicProposals(rawProposals, { snapshot, extractions: extracted.items })
    topicTrace(`校验 propose：${proposed.cards.length} 卡 / ${proposed.failures.length} 失败${proposed.failures.length ? `（${proposed.failures.map(f => f.code).join(', ')}）` : ''}`)
    await trace({ stage, status: 'done', counts: { valid: proposed.cards.length, invalid: proposed.failures.length } })
    const failures = [...extracted.failures, ...proposed.failures]
    if (proposed.cards.length === 0 && proposed.failures.length > 0) {
      return persist({
        ...base(), status: 'failed', cards: [],
        error: { code: 'NO_VALID_CARDS', message: `模型候选没有通过校验：${proposed.failures.map(item => item.code).join(', ')}` },
      })
    }
    notify('result')
    if (failures.length > 0) return persist({ ...base(), status: 'partial', cards: proposed.cards, failures })
    return persist({ ...base(), status: 'completed', cards: proposed.cards })
  } catch (error) {
    if (isAbort(error, input.signal)) {
      const result: TopicRunResult = { ...base(), status: 'cancelled', cards: [] }
      await trace({ stage, status: 'cancelled', durationMs: result.durationMs })
      return persist(result)
    }
    const failed = failureOf(error)
    await trace({ stage, status: 'failed', error: failed, durationMs: duration() })
    diag()?.warn('topics', 'analysis-failed', { runId, stage, code: failed.code }, failed.message)
    return persist({ ...base(), status: 'failed', cards: [], error: failed })
  }
}

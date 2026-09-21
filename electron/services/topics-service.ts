import { randomUUID } from 'node:crypto'
import { Library } from '../../src/core/library'
import type { ArticleMeta } from '../../src/core/types'
import { analyzeTopics } from '../../src/core/topics/analyze'
import { buildTopicBrief } from '../../src/core/topics/brief'
import type { TopicModel } from '../../src/core/topics/model'
import { ChatCompletionsTopicModel, TopicProviderError } from '../../src/core/topics/chat-completions'
import type { TopicAiConfigSaveInput, TopicAiConfigStatus } from './topic-ai-config'
import { testTopicAiConnection } from '../../src/core/topics/test-connection'
import { isTopicAiProviderId, PROVIDER_CATALOG, type ProviderSpec, type TopicAiProviderId, type TopicAiReasoningEffort } from '../../src/core/topics/providers'
import { TopicRunStore } from '../../src/core/topics/store'
import { resolveTopicWindow, selectTopicArticles, selectTopicArticlesByIds } from '../../src/core/topics/time-window'
import type { TopicFeedbackDecision, TopicRunResult, TopicTraceEvent, TopicWindowInput } from '../../src/core/topics/types'
import { SettingsService } from './settings'
import { TopicAiConfigError, TopicAiConfigService } from './topic-ai-config'

export type TopicAnalyzeResponse =
  | { ok: true; result: TopicRunResult; timeExcludedCount: number }
  | { ok: false; error: { code: string; message: string } }

export type TopicBriefResponse =
  | { ok: true; path: string; markdown: string }
  | { ok: false; error: { code: string; message: string } }

export type TopicFeedbackResponse =
  | { ok: true; path: string }
  | { ok: false; error: { code: string; message: string } }

export type TopicTestConnectionResponse =
  | { ok: true; model: string; latencyMs: number; firstByteMs?: number; usage?: { inputTokens: number; outputTokens: number } }
  | { ok: false; error: { code: string; message: string } }

export type TopicStreamEvent = { stage: 'extract' | 'propose'; kind: 'content' | 'reasoning'; text: string }

/** GUI 长生成不设总超时；仅「连接建立后连续无字节」判死（M75）。 */
export const DEFAULT_IDLE_TIMEOUT_MS = 180_000

export interface TopicServiceDeps {
  settings: SettingsService
  config: TopicAiConfigService
  /** M75：模型流式增量出口（IPC 层节流后送 renderer；CLI 不接）。 */
  onStream?: (event: TopicStreamEvent) => void
  now?: () => Date
  makeRunId?: () => string
  makeEventId?: () => string
  modelFactory?: (config: {
    providerId: string
    baseUrl: string
    model: string
    apiKey: string
    reasoning: boolean
    effort: TopicAiReasoningEffort
    idleTimeoutMs?: number
    onDelta?: (stage: 'extract' | 'propose', kind: 'content' | 'reasoning', text: string) => void
  }) => TopicModel
}

const errorResponse = (error: unknown, fallback: string) => ({
  ok: false as const,
  error: {
    code: error instanceof TopicAiConfigError ? error.code : fallback,
    message: error instanceof Error ? error.message : String(error),
  },
})

export class TopicService {
  private active: AbortController | null = null
  private activeStage: TopicTraceEvent['stage'] | null = null
  private activeStartedAt: number | null = null
  private activeWindow: TopicWindowInput | null = null
  private now: () => Date
  private makeRunId: () => string
  private makeEventId: () => string
  private modelFactory: TopicServiceDeps['modelFactory']

  constructor(private deps: TopicServiceDeps) {
    this.now = deps.now ?? (() => new Date())
    this.makeRunId = deps.makeRunId ?? (() => `topic-${Date.now()}-${randomUUID().slice(0, 8)}`)
    this.makeEventId = deps.makeEventId ?? (() => `feedback-${Date.now()}-${randomUUID().slice(0, 8)}`)
    this.modelFactory = deps.modelFactory ?? (config => new ChatCompletionsTopicModel({
      baseUrl: config.baseUrl,
      model: config.model,
      apiKey: config.apiKey,
      providerId: isTopicAiProviderId(config.providerId) ? config.providerId : 'custom',
      reasoning: config.reasoning,
      effort: config.effort,
      idleTimeoutMs: config.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS,
      ...(config.onDelta ? { onDelta: config.onDelta } : {}),
    }))
  }

  getConfig(): Promise<TopicAiConfigStatus> { return this.deps.config.getStatus() }
  /** 厂商目录是静态数据，renderer 经 IPC 取（renderer 不直接 import core 运行时导出）。 */
  getProviderCatalog(): Record<TopicAiProviderId, ProviderSpec> { return PROVIDER_CATALOG }
  saveConfig(input: TopicAiConfigSaveInput): Promise<TopicAiConfigStatus> { return this.deps.config.save(input) }
  clearKey(): Promise<TopicAiConfigStatus> { return this.deps.config.clearKey() }

  /**
   * 测试连接测的是「草稿配置」：apiKey 为空时回退已存 Key（改端点后不重输 Key 也能测）。
   * testTopicAiConnection 不抛异常；requireConfig 的失败也要归一成 result。
   */
  async testConnection(input: { baseUrl: string; model: string; apiKey?: string }): Promise<TopicTestConnectionResponse> {
    let apiKey = (input.apiKey ?? '').trim()
    if (!apiKey) {
      try {
        const config = await this.deps.config.requireConfig()
        apiKey = config.apiKey
      } catch (error) {
        return {
          ok: false,
          error: {
            code: error instanceof TopicAiConfigError ? error.code : 'TOPIC_CONFIG_ERROR',
            message: error instanceof Error ? error.message : String(error),
          },
        }
      }
    }
    const result = await testTopicAiConnection({ baseUrl: input.baseUrl, model: input.model, apiKey })
    return result.ok
      ? { ok: true, model: result.model, latencyMs: result.latencyMs, firstByteMs: result.firstByteMs, usage: result.usage }
      : { ok: false, error: { code: result.error.code, message: result.error.message } }
  }

  /**
   * M73.1：GUI 切页重挂载后用快照恢复「进行中」现场（范围 + 阶段 + 起始时间 + 取消入口）。
   * startedAt 用 Date.now 而非注入的 now()——它只服务 UI 计时显示。
   */
  getRunningStatus(): { running: boolean; startedAt: number | null; stage: TopicTraceEvent['stage'] | null; window: TopicWindowInput | null } {
    return this.active
      ? { running: true, startedAt: this.activeStartedAt, stage: this.activeStage, window: this.activeWindow }
      : { running: false, startedAt: null, stage: null, window: null }
  }

  async analyze(input: { window: TopicWindowInput }, onProgress?: (stage: TopicTraceEvent['stage']) => void): Promise<TopicAnalyzeResponse> {
    if (this.active) return { ok: false, error: { code: 'TOPIC_ANALYSIS_RUNNING', message: '已有选题分析正在进行，请等待完成或先取消。' } }
    let config: Awaited<ReturnType<TopicAiConfigService['requireConfig']>>
    try { config = await this.deps.config.requireConfig() }
    catch (error) { return errorResponse(error, 'TOPIC_CONFIG_ERROR') }
    this.active = new AbortController()
    this.activeStartedAt = Date.now()
    this.activeStage = null
    this.activeWindow = input.window
    const trackStage = (stage: TopicTraceEvent['stage']) => { this.activeStage = stage; onProgress?.(stage) }
    try {
      const settings = await this.deps.settings.get()
      const window = resolveTopicWindow(input.window, this.now().getTime())
      const library = new Library(settings.libraryRoot)
      let articles: ArticleMeta[]
      let excludedCount = 0
      if (window.preset === 'manual') {
        // M75：用户指名即素材——不做时间判定；找不到就是找不到，不静默丢。
        const selected = selectTopicArticlesByIds(await library.list(), window)
        if (selected.missing.length > 0) {
          return { ok: false as const, error: { code: 'UNKNOWN_ARTICLES', message: `文库中找不到你选择的文章：${selected.missing.join('、')}。可能已被删除，请重新选择。` } }
        }
        articles = selected.articles
      } else {
        const selected = selectTopicArticles(await library.list(), window)
        articles = selected.articles
        excludedCount = selected.excluded.length
      }
      const result = await analyzeTopics({
        libraryRoot: settings.libraryRoot,
        model: this.modelFactory!({
          ...config,
          onDelta: this.deps.onStream
            ? (stage, kind, text) => this.deps.onStream?.({ stage, kind, text })
            : undefined,
        }),
        store: new TopicRunStore(settings.libraryRoot),
        now: this.now,
        makeRunId: this.makeRunId,
        onStage: trackStage,
      }, { window, articles, signal: this.active.signal })
      return { ok: true, result, timeExcludedCount: excludedCount }
    } catch (error) {
      return errorResponse(error, 'TOPIC_ANALYSIS_ERROR')
    } finally { this.active = null; this.activeStage = null; this.activeStartedAt = null; this.activeWindow = null }
  }

  cancel(): { ok: true } | { ok: false; error: { code: string; message: string } } {
    if (!this.active) return { ok: false, error: { code: 'NO_TOPIC_ANALYSIS', message: '当前没有正在运行的选题分析。' } }
    this.active.abort()
    return { ok: true }
  }

  async brief(input: { runId: string; topicId: string }): Promise<TopicBriefResponse> {
    try {
      const settings = await this.deps.settings.get()
      const store = new TopicRunStore(settings.libraryRoot)
      const run = await store.readResult(input.runId)
      if (run.status !== 'completed' && run.status !== 'partial') throw new Error(`运行 ${run.runId} 没有可用候选。`)
      const card = run.cards.find(item => item.id === input.topicId)
      if (!card) throw new Error(`运行 ${run.runId} 中没有候选 ${input.topicId}。`)
      const markdown = buildTopicBrief(card, run)
      const path = await store.writeBrief(run.runId, card.id, markdown)
      return { ok: true, path, markdown }
    } catch (error) { return errorResponse(error, 'TOPIC_RESULT_ERROR') }
  }

  async feedback(input: { runId: string; topicId: string; decision: TopicFeedbackDecision }): Promise<TopicFeedbackResponse> {
    try {
      const settings = await this.deps.settings.get()
      const store = new TopicRunStore(settings.libraryRoot)
      const run = await store.readResult(input.runId)
      if ((run.status !== 'completed' && run.status !== 'partial') || !run.cards.some(item => item.id === input.topicId)) {
        throw new Error(`运行 ${input.runId} 中没有可反馈的候选 ${input.topicId}。`)
      }
      const path = await store.writeFeedback({
        schemaVersion: 1,
        id: this.makeEventId(),
        runId: input.runId,
        topicId: input.topicId,
        decision: input.decision,
        recordedAt: this.now().toISOString(),
      })
      return { ok: true, path }
    } catch (error) { return errorResponse(error, 'TOPIC_FEEDBACK_ERROR') }
  }
}

import type { ArticleMeta } from '../types'

/** 选题范围始终按原文发表时间；不保存分析水位或自动扩窗策略。 */
export type TopicWindowInput =
  | { preset: '24h' | '3d' | '7d' }
  | { preset: 'custom'; from: string; to: string }

export interface TopicWindow {
  preset: TopicWindowInput['preset']
  fromMs: number
  toMs: number
  asOfMs: number
  timeZone: 'Asia/Shanghai'
}

export type TopicTimeExclusion =
  | 'unknown-publication-time'
  | 'outside-window'
  | 'future-publication-time'
  | 'uncertain-publication-time'

export type TopicPublicationDecision =
  | { included: true; precision: 'instant' | 'day'; publishedAtMs: number }
  | { included: false; reason: TopicTimeExclusion }

export interface TopicArticleSelection {
  articles: ArticleMeta[]
  excluded: Array<{ id: string; publishTime: string; reason: TopicTimeExclusion }>
}

export type TopicMaterialExclusion =
  | 'path-outside-library'
  | 'content-missing'
  | 'content-unreadable'
  | 'insufficient-text'

export interface TopicParagraph {
  id: string
  groupId: string
  index: number
  chunkIndex: number
  text: string
}

export interface TopicSnapshotArticle {
  id: string
  title: string
  author: string
  account: string
  accountId?: string
  publishTime: string
  sourceUrl: string
  contentHash: string
  groupId: string
  warnings: string[]
}

export interface TopicContentGroup {
  id: string
  contentHash: string
  representativeArticleId: string
  memberArticleIds: string[]
  paragraphIds: string[]
}

export interface TopicMaterialSnapshot {
  schemaVersion: 1
  runId: string
  createdAt: string
  window: TopicWindow
  articles: TopicSnapshotArticle[]
  groups: TopicContentGroup[]
  paragraphs: TopicParagraph[]
  excluded: Array<{ id: string; reason: TopicMaterialExclusion; detail?: string }>
  totalModelChars: number
}

export type ReaderValueKind = 'knowledge' | 'information-gap' | 'resonance' | 'anxiety-relief' | 'joy'

export interface TopicEvidence {
  id: string
  articleId: string
  paragraphId: string
  contentHash: string
  quote: string
  role: 'support' | 'counterpoint' | 'background'
  /** 最终证据必须在快照中匹配；匹配只证明摘录存在，不证明事实真实。 */
  validation: 'matched'
  sourceTitle: string
  sourceAccount: string
  sourceUrl: string
}

export interface TopicReaderValue {
  kind: ReaderValueKind
  benefit: string
  evidenceIds: string[]
  judgment: 'inference'
}

export interface TopicClaim {
  text: string
  kind: 'source-fact-claim' | 'source-opinion' | 'editorial-inference'
  evidenceIds: string[]
}

export interface TopicStatistics {
  relatedArticleCount: number
  /** 按账号身份归并的计数，不命名为 independentSourceCount。 */
  sourceAccountCount: number
  contentGroupCount: number
  publishedDates: string[]
}

/** 供后续分析器、GUI 和 CLI 共用的输出契约；运行时校验在分析阶段实现。 */
export interface TopicDecisionCard {
  id: string
  question: string
  angle: string
  readerValues: TopicReaderValue[]
  rationale: string
  claims: TopicClaim[]
  evidence: TopicEvidence[]
  statistics: TopicStatistics
  evidenceConfidence: { level: 'high' | 'medium' | 'low'; reasons: string[] }
  distributionEvidence: 'unverified'
  limitations: string[]
  missingEvidence: string[]
  outline: string[]
}

export interface TopicFailure {
  code: string
  message: string
  articleId?: string
  topicId?: string
}

export interface TopicTraceEvent {
  time: string
  stage: 'snapshot' | 'extract' | 'validate-extract' | 'propose' | 'validate-propose' | 'result'
  status: 'start' | 'done' | 'failed' | 'cancelled'
  counts?: Record<string, number>
  durationMs?: number
  usage?: { inputTokens?: number; outputTokens?: number }
  error?: { code: string; message: string }
}

interface TopicRunBase {
  schemaVersion: 1
  runId: string
  window: TopicWindow
  manifestPath: string
  createdAt: string
  durationMs: number
  model?: { providerId: string; modelName: string; systemVersion: string; taskVersion: string }
  usage?: { inputTokens?: number; outputTokens?: number }
}

/** 把空结果和故障拆开，禁止把请求失败伪装成“今天没有值得写的”。 */
export type TopicRunResult = TopicRunBase & (
  | { status: 'completed'; cards: TopicDecisionCard[] }
  | { status: 'insufficient-material'; cards: []; reason: string }
  | { status: 'partial'; cards: TopicDecisionCard[]; failures: TopicFailure[] }
  | { status: 'cancelled'; cards: [] }
  | { status: 'failed'; cards: []; error: TopicFailure }
)

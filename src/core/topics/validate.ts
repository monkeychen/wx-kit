import type { TopicExtractionItem, TopicExtractionKind } from './model'
import type {
  ReaderValueKind,
  TopicClaim,
  TopicDecisionCard,
  TopicEvidence,
  TopicFailure,
  TopicMaterialSnapshot,
  TopicReaderValue,
  TopicStatistics,
} from './types'

const EXTRACTION_KINDS = new Set<TopicExtractionKind>([
  'fact-claim', 'opinion', 'question', 'emotion', 'change', 'counterpoint',
])
const VALUE_KINDS = new Set<ReaderValueKind>([
  'knowledge', 'information-gap', 'resonance', 'anxiety-relief', 'joy',
])
const CLAIM_KINDS = new Set<TopicClaim['kind']>([
  'source-fact-claim', 'source-opinion', 'editorial-inference',
])
const EVIDENCE_ROLES = new Set<TopicEvidence['role']>(['support', 'counterpoint', 'background'])
const CONFIDENCE_LEVELS = new Set<TopicDecisionCard['evidenceConfidence']['level']>(['high', 'medium', 'low'])
const MAX_EXTRACTIONS = 200
const MAX_CARDS = 3

type Obj = Record<string, unknown>
type ValidatedEvidenceRef = Pick<TopicEvidence, 'id' | 'paragraphId' | 'quote' | 'role' | 'validation'>

export class TopicModelOutputError extends Error {
  constructor(public code: string, message: string) {
    super(message)
    this.name = 'TopicModelOutputError'
  }
}

const isObj = (value: unknown): value is Obj => !!value && typeof value === 'object' && !Array.isArray(value)
const nonEmpty = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null
const stringList = (value: unknown): string[] | null => {
  if (!Array.isArray(value)) return null
  const values = value.map(nonEmpty)
  return values.every((item): item is string => item != null) ? values : null
}
const failure = (code: string, message: string, topicId?: string): TopicFailure => ({
  code, message, ...(topicId ? { topicId } : {}),
})

export function parseTopicExtractions(raw: unknown, snapshot: TopicMaterialSnapshot): {
  items: TopicExtractionItem[]
  failures: TopicFailure[]
} {
  if (!isObj(raw) || !Array.isArray(raw.items)) {
    throw new TopicModelOutputError('INVALID_EXTRACTION_OUTPUT', '材料提取结果必须是包含 items 数组的对象。')
  }
  if (raw.items.length > MAX_EXTRACTIONS) {
    throw new TopicModelOutputError('TOO_MANY_EXTRACTIONS', `材料提取项 ${raw.items.length} 条，超过上限 ${MAX_EXTRACTIONS} 条。`)
  }

  const groups = new Map(snapshot.groups.map(group => [group.id, group]))
  const paragraphs = new Map(snapshot.paragraphs.map(paragraph => [paragraph.id, paragraph]))
  const seen = new Set<string>()
  const items: TopicExtractionItem[] = []
  const failures: TopicFailure[] = []

  for (const candidate of raw.items) {
    const obj = isObj(candidate) ? candidate : {}
    const id = nonEmpty(obj.id)
    const groupId = nonEmpty(obj.groupId)
    const paragraphId = nonEmpty(obj.paragraphId)
    const quote = nonEmpty(obj.quote)
    const summary = nonEmpty(obj.summary)
    const theme = nonEmpty(obj.theme)
    const kind = nonEmpty(obj.kind)
    if (!id || !groupId || !paragraphId || !quote) {
      failures.push(failure('INVALID_EXTRACTION_TEXT', '提取项缺少可用的 ID、段落或摘录。', id ?? undefined))
      continue
    }
    if (!groups.has(groupId)) {
      failures.push(failure('UNKNOWN_GROUP', `提取项引用了不存在的内容组 ${groupId}。`, id))
      continue
    }
    const paragraph = paragraphs.get(paragraphId)
    if (!paragraph || paragraph.groupId !== groupId) {
      failures.push(failure('UNKNOWN_PARAGRAPH', `提取项引用了不属于内容组的段落 ${paragraphId}。`, id))
      continue
    }
    if (!paragraph.text.includes(quote)) {
      failures.push(failure('QUOTE_NOT_FOUND', `摘录不能在段落 ${paragraphId} 中逐字定位。`, id))
      continue
    }
    if (!kind || !EXTRACTION_KINDS.has(kind as TopicExtractionKind)) {
      failures.push(failure('INVALID_EXTRACTION_KIND', `提取项 ${id} 的类型不受支持。`, id))
      continue
    }
    if (!summary || !theme) {
      failures.push(failure('INVALID_EXTRACTION_TEXT', `提取项 ${id} 缺少摘要或主题。`, id))
      continue
    }
    if (seen.has(id)) {
      failures.push(failure('DUPLICATE_EXTRACTION_ID', `提取项 ID ${id} 重复。`, id))
      continue
    }
    seen.add(id)
    items.push({ id, groupId, paragraphId, quote, kind: kind as TopicExtractionKind, summary, theme })
  }
  return { items, failures }
}

function parseRawEvidence(value: unknown, extractions: Map<string, TopicExtractionItem>): {
  evidence: ValidatedEvidenceRef[]
  extractionIds: Map<string, string>
  error?: TopicFailure
} {
  if (!Array.isArray(value) || value.length === 0) return { evidence: [], extractionIds: new Map(), error: failure('INVALID_EVIDENCE', '候选缺少材料依据。') }
  const ids = new Set<string>()
  const evidence: ValidatedEvidenceRef[] = []
  const extractionIds = new Map<string, string>()
  for (const entry of value) {
    if (!isObj(entry)) return { evidence: [], extractionIds, error: failure('INVALID_EVIDENCE', '材料依据结构无效。') }
    const id = nonEmpty(entry.id)
    const extractionId = nonEmpty(entry.extractionId)
    const role = nonEmpty(entry.role)
    if (!id || !extractionId || !role || !EVIDENCE_ROLES.has(role as TopicEvidence['role']) || ids.has(id)) {
      return { evidence: [], extractionIds, error: failure('INVALID_EVIDENCE', '材料依据缺少 ID、角色或出现重复。') }
    }
    const extraction = extractions.get(extractionId)
    if (!extraction) return { evidence: [], extractionIds, error: failure('UNKNOWN_EXTRACTION', `材料依据引用了不存在的提取项 ${extractionId}。`) }
    ids.add(id)
    extractionIds.set(id, extractionId)
    evidence.push({
      id,
      paragraphId: extraction.paragraphId,
      quote: extraction.quote,
      role: role as TopicEvidence['role'],
      validation: 'matched',
    })
  }
  return { evidence, extractionIds }
}

function parseReaderValues(value: unknown, evidenceIds: Set<string>): TopicReaderValue[] | TopicFailure {
  if (!Array.isArray(value) || value.length === 0) return failure('INVALID_READER_VALUE', '候选缺少明确的读者价值。')
  const seen = new Set<string>()
  const result: TopicReaderValue[] = []
  for (const entry of value) {
    if (!isObj(entry)) return failure('INVALID_READER_VALUE', '读者价值结构无效。')
    const kind = nonEmpty(entry.kind)
    const benefit = nonEmpty(entry.benefit)
    const refs = stringList(entry.evidenceIds)
    if (!kind || !VALUE_KINDS.has(kind as ReaderValueKind) || !benefit || !refs?.length || seen.has(kind)) {
      return failure('INVALID_READER_VALUE', '读者价值类型、受益解释或引用无效。')
    }
    if (refs.some(id => !evidenceIds.has(id))) return failure('UNKNOWN_EVIDENCE', '读者价值引用了不存在的材料依据。')
    seen.add(kind)
    result.push({ kind: kind as ReaderValueKind, benefit, evidenceIds: refs, judgment: 'inference' })
  }
  return result
}

function parseClaims(value: unknown, evidenceIds: Set<string>): TopicClaim[] | TopicFailure {
  if (!Array.isArray(value) || value.length === 0) return failure('INVALID_CLAIM', '候选缺少可核对的陈述。')
  const result: TopicClaim[] = []
  for (const entry of value) {
    if (!isObj(entry)) return failure('INVALID_CLAIM', '候选陈述结构无效。')
    const text = nonEmpty(entry.text)
    const kind = nonEmpty(entry.kind)
    const refs = stringList(entry.evidenceIds)
    if (!text || !kind || !CLAIM_KINDS.has(kind as TopicClaim['kind']) || !refs?.length) {
      return failure('INVALID_CLAIM', '候选陈述缺少文本、类型或引用。')
    }
    if (refs.some(id => !evidenceIds.has(id))) return failure('UNKNOWN_EVIDENCE', '候选陈述引用了不存在的材料依据。')
    result.push({ text, kind: kind as TopicClaim['kind'], evidenceIds: refs })
  }
  return result
}

function statisticsFor(evidence: TopicEvidence[], snapshot: TopicMaterialSnapshot): TopicStatistics {
  const paragraphs = new Map(snapshot.paragraphs.map(paragraph => [paragraph.id, paragraph]))
  const groups = new Map(snapshot.groups.map(group => [group.id, group]))
  const articles = new Map(snapshot.articles.map(article => [article.id, article]))
  const groupIds = new Set(evidence.map(item => paragraphs.get(item.paragraphId)?.groupId).filter((id): id is string => !!id))
  const articleIds = new Set<string>()
  for (const id of groupIds) for (const articleId of groups.get(id)?.memberArticleIds ?? []) articleIds.add(articleId)
  const selected = [...articleIds].map(id => articles.get(id)).filter((item): item is NonNullable<typeof item> => !!item)
  const sourceIds = new Set(selected.map(article => article.accountId?.trim() || article.account.trim().toLocaleLowerCase('zh-CN')))
  const dates = new Set(selected.map(article => /^\d{4}-\d{2}-\d{2}/.exec(article.publishTime)?.[0]).filter((date): date is string => !!date))
  return {
    relatedArticleCount: selected.length,
    sourceAccountCount: sourceIds.size,
    contentGroupCount: groupIds.size,
    publishedDates: [...dates].sort(),
  }
}

export function validateTopicProposals(raw: unknown, context: {
  snapshot: TopicMaterialSnapshot
  extractions: TopicExtractionItem[]
}): { cards: TopicDecisionCard[]; failures: TopicFailure[] } {
  if (!isObj(raw) || !Array.isArray(raw.cards)) {
    throw new TopicModelOutputError('INVALID_PROPOSAL_OUTPUT', '选题结果必须是包含 cards 数组的对象。')
  }
  const extractionMap = new Map(context.extractions.map(item => [item.id, item]))
  const paragraphMap = new Map(context.snapshot.paragraphs.map(item => [item.id, item]))
  const groupMap = new Map(context.snapshot.groups.map(item => [item.id, item]))
  const seenCards = new Set<string>()
  const cards: TopicDecisionCard[] = []
  const failures: TopicFailure[] = []

  for (const candidate of raw.cards) {
    const obj = isObj(candidate) ? candidate : {}
    const id = nonEmpty(obj.id)
    if (!id) { failures.push(failure('INVALID_TOPIC_ID', '候选缺少 ID。')); continue }
    if (seenCards.has(id)) { failures.push(failure('DUPLICATE_TOPIC_ID', `候选 ID ${id} 重复。`, id)); continue }
    seenCards.add(id)
    if (cards.length >= MAX_CARDS) { failures.push(failure('TOO_MANY_CARDS', '有效候选超过三张。', id)); continue }
    const question = nonEmpty(obj.question)
    const angle = nonEmpty(obj.angle)
    const rationale = nonEmpty(obj.rationale)
    if (!question || !angle || !rationale) { failures.push(failure('INVALID_TOPIC_TEXT', '候选缺少问题、角度或理由。', id)); continue }
    if ('statistics' in obj) { failures.push(failure('MODEL_SUPPLIED_STATISTICS', '最终统计只能由程序计算。', id)); continue }
    if (obj.distributionEvidence !== undefined && obj.distributionEvidence !== 'unverified') {
      failures.push(failure('INVALID_DISTRIBUTION_EVIDENCE', '传播效果没有可验证数据。', id)); continue
    }
    const evidenceResult = parseRawEvidence(obj.evidence, extractionMap)
    if (evidenceResult.error) { failures.push({ ...evidenceResult.error, topicId: id }); continue }
    const evidenceIds = new Set(evidenceResult.evidence.map(item => item.id))
    const readerValues = parseReaderValues(obj.readerValues, evidenceIds)
    if (!Array.isArray(readerValues)) { failures.push({ ...readerValues, topicId: id }); continue }
    const claims = parseClaims(obj.claims, evidenceIds)
    if (!Array.isArray(claims)) { failures.push({ ...claims, topicId: id }); continue }
    const confidence = isObj(obj.evidenceConfidence) ? obj.evidenceConfidence : {}
    const level = nonEmpty(confidence.level)
    const reasons = stringList(confidence.reasons)
    if (!level || !CONFIDENCE_LEVELS.has(level as TopicDecisionCard['evidenceConfidence']['level']) || !reasons?.length) {
      failures.push(failure('INVALID_CONFIDENCE', '依据把握必须有等级和具体理由。', id)); continue
    }
    const limitations = stringList(obj.limitations)
    const missingEvidence = stringList(obj.missingEvidence)
    const outline = stringList(obj.outline)
    if (!outline?.length) { failures.push(failure('INVALID_OUTLINE', '候选缺少可执行的起笔结构。', id)); continue }
    if (!limitations || !missingEvidence) { failures.push(failure('INVALID_LIMITATIONS', '限制或待补证据结构无效。', id)); continue }

    const evidence = evidenceResult.evidence.map(item => {
      const extraction = extractionMap.get(evidenceResult.extractionIds.get(item.id)!)!
      const paragraph = paragraphMap.get(extraction.paragraphId)!
      const group = groupMap.get(paragraph.groupId)!
      const source = context.snapshot.articles.find(article => article.id === group.representativeArticleId)!
      return {
        ...item,
        articleId: group.representativeArticleId,
        contentHash: group.contentHash,
        sourceTitle: source.title,
        sourceAccount: source.account,
        sourceUrl: source.sourceUrl,
      }
    })
    cards.push({
      id, question, angle, readerValues, rationale, claims, evidence,
      statistics: statisticsFor(evidence, context.snapshot),
      evidenceConfidence: { level: level as TopicDecisionCard['evidenceConfidence']['level'], reasons },
      distributionEvidence: 'unverified',
      limitations,
      missingEvidence,
      outline,
    })
  }
  return { cards, failures }
}

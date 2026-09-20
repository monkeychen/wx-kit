import { describe, expect, it } from 'vitest'
import type { TopicMaterialSnapshot } from '../../../src/core/topics/types'
import { TopicModelOutputError, parseTopicExtractions, validateTopicProposals } from '../../../src/core/topics/validate'

const snapshot: TopicMaterialSnapshot = {
  schemaVersion: 1,
  runId: 'run-validate',
  createdAt: '2026-09-20T04:00:00.000Z',
  window: { preset: '24h', fromMs: Date.parse('2026-09-19T04:00:00Z'), toMs: Date.parse('2026-09-20T04:00:00Z'), asOfMs: Date.parse('2026-09-20T04:00:00Z'), timeZone: 'Asia/Shanghai' },
  articles: [
    { id: 'a1', title: '文章甲', author: '作者甲', account: '账号甲', accountId: 'acc-a', publishTime: '2026-09-19 16:00', sourceUrl: 'https://example.invalid/a1', contentHash: 'hash-1', groupId: 'g001', warnings: [] },
    { id: 'a2', title: '转载甲', author: '作者乙', account: '账号乙', accountId: 'acc-b', publishTime: '2026-09-19 17:00', sourceUrl: 'https://example.invalid/a2', contentHash: 'hash-1', groupId: 'g001', warnings: [] },
    { id: 'a3', title: '文章丙', author: '作者丙', account: '账号丙', publishTime: '2026-09-20 08:00', sourceUrl: 'https://example.invalid/a3', contentHash: 'hash-2', groupId: 'g002', warnings: [] },
  ],
  groups: [
    { id: 'g001', contentHash: 'hash-1', representativeArticleId: 'a1', memberArticleIds: ['a1', 'a2'], paragraphIds: ['g001:p001'] },
    { id: 'g002', contentHash: 'hash-2', representativeArticleId: 'a3', memberArticleIds: ['a3'], paragraphIds: ['g002:p001'] },
  ],
  paragraphs: [
    { id: 'g001:p001', groupId: 'g001', index: 1, chunkIndex: 1, text: '行情上涨以后，一些人反而更频繁查看账户。' },
    { id: 'g002:p001', groupId: 'g002', index: 1, chunkIndex: 1, text: '另一位作者认为，焦虑可能来自目标和期限不清。' },
  ],
  excluded: [],
  totalModelChars: 42,
}

const extractionRaw = {
  items: [
    { id: 'x1', groupId: 'g001', paragraphId: 'g001:p001', quote: '更频繁查看账户', kind: 'emotion', summary: '上涨阶段仍然焦虑', theme: '投资焦虑' },
    { id: 'x2', groupId: 'g002', paragraphId: 'g002:p001', quote: '目标和期限不清', kind: 'counterpoint', summary: '另一种解释', theme: '投资焦虑' },
  ],
}

describe('模型材料提取校验', () => {
  it('只保留可定位的精确摘录，并逐项报告坏引用', () => {
    const raw = { items: [
      extractionRaw.items[0],
      { id: 'bad-group', groupId: 'g999', paragraphId: 'g001:p001', quote: '更频繁', kind: 'emotion', summary: 's', theme: 't' },
      { id: 'bad-paragraph', groupId: 'g001', paragraphId: 'g999:p001', quote: '更频繁', kind: 'emotion', summary: 's', theme: 't' },
      { id: 'wrong-paragraph', groupId: 'g001', paragraphId: 'g001:p001', quote: '目标和期限不清', kind: 'emotion', summary: 's', theme: 't' },
      { id: 'bad-kind', groupId: 'g001', paragraphId: 'g001:p001', quote: '更频繁', kind: 'prediction', summary: 's', theme: 't' },
      { id: 'empty-summary', groupId: 'g001', paragraphId: 'g001:p001', quote: '更频繁', kind: 'emotion', summary: ' ', theme: 't' },
      { id: 'x1', groupId: 'g001', paragraphId: 'g001:p001', quote: '更频繁', kind: 'emotion', summary: '重复', theme: 't' },
    ] }
    const result = parseTopicExtractions(raw, snapshot)
    expect(result.items).toEqual([extractionRaw.items[0]])
    expect(result.failures.map(f => f.code)).toEqual([
      'UNKNOWN_GROUP', 'UNKNOWN_PARAGRAPH', 'QUOTE_NOT_FOUND', 'INVALID_EXTRACTION_KIND', 'INVALID_EXTRACTION_TEXT', 'DUPLICATE_EXTRACTION_ID',
    ])
  })

  it.each([null, {}, { items: 'bad' }, { items: Array.from({ length: 201 }, () => ({})) }])('拒绝无效顶层结构 %#', raw => {
    expect(() => parseTopicExtractions(raw, snapshot)).toThrow(TopicModelOutputError)
  })
})

describe('选题卡校验与统计重算', () => {
  const extractions = parseTopicExtractions(extractionRaw, snapshot).items
  const goodCard = {
    id: 'topic-1',
    question: '为什么市场上涨时，人仍然会焦虑？',
    angle: '比较踏空感受与目标期限不清两种解释。',
    readerValues: [
      { kind: 'anxiety-relief', benefit: '帮助读者把模糊的不安拆成可以检查的问题。', evidenceIds: ['e1', 'e2'] },
      { kind: 'knowledge', benefit: '解释两种不同机制。', evidenceIds: ['e1', 'e2'] },
    ],
    rationale: '两组材料对同一种感受提供了不同解释。',
    claims: [
      { text: '账号甲材料描述了频繁查看账户的感受。', kind: 'source-opinion', evidenceIds: ['e1'] },
      { text: '这可能适合作为解释型文章的入口。', kind: 'editorial-inference', evidenceIds: ['e1', 'e2'] },
    ],
    evidence: [
      { id: 'e1', extractionId: 'x1', role: 'support' },
      { id: 'e2', extractionId: 'x2', role: 'counterpoint' },
    ],
    evidenceConfidence: { level: 'medium', reasons: ['摘录可以定位，但没有读者行为数据。'] },
    distributionEvidence: 'unverified',
    limitations: ['不同账号不等于独立事实验证。'],
    missingEvidence: ['需要读者或研究资料。'],
    outline: ['从上涨仍焦虑的情境开篇。', '比较两种解释。', '给出读者可以自查的问题。'],
  }

  it('用验证后的引用重算文章、账号、内容组和日期统计', () => {
    const result = validateTopicProposals({ cards: [goodCard] }, { snapshot, extractions })
    expect(result.failures).toEqual([])
    expect(result.cards).toHaveLength(1)
    expect(result.cards[0]).toMatchObject({
      id: 'topic-1',
      distributionEvidence: 'unverified',
      statistics: {
        relatedArticleCount: 3,
        sourceAccountCount: 3,
        contentGroupCount: 2,
        publishedDates: ['2026-09-19', '2026-09-20'],
      },
    })
    expect(result.cards[0].evidence).toEqual([
      { id: 'e1', articleId: 'a1', paragraphId: 'g001:p001', contentHash: 'hash-1', quote: '更频繁查看账户', role: 'support', validation: 'matched', sourceTitle: '文章甲', sourceAccount: '账号甲', sourceUrl: 'https://example.invalid/a1' },
      { id: 'e2', articleId: 'a3', paragraphId: 'g002:p001', contentHash: 'hash-2', quote: '目标和期限不清', role: 'counterpoint', validation: 'matched', sourceTitle: '文章丙', sourceAccount: '账号丙', sourceUrl: 'https://example.invalid/a3' },
    ])
  })

  it('坏卡逐张失败，其它好卡仍然交付', () => {
    const raw = { cards: [
      goodCard,
      { ...goodCard, id: 'bad-reference', evidence: [{ id: 'e1', extractionId: 'missing', role: 'support' }] },
      { ...goodCard, id: 'bad-value', readerValues: [{ kind: 'profit', benefit: '保证收益', evidenceIds: ['e1'] }] },
      { ...goodCard, id: 'model-statistics', statistics: { relatedArticleCount: 999 } },
      { ...goodCard, id: 'bad-distribution', distributionEvidence: 'high' },
      { ...goodCard, id: 'empty-outline', outline: [] },
    ] }
    const result = validateTopicProposals(raw, { snapshot, extractions })
    expect(result.cards.map(card => card.id)).toEqual(['topic-1'])
    expect(result.failures.map(f => f.code)).toEqual([
      'UNKNOWN_EXTRACTION', 'INVALID_READER_VALUE', 'MODEL_SUPPLIED_STATISTICS', 'INVALID_DISTRIBUTION_EVIDENCE', 'INVALID_OUTLINE',
    ])
  })

  it('未知 evidence ID、重复候选 ID 和缺少把握理由都不会进入结果', () => {
    const result = validateTopicProposals({ cards: [
      goodCard,
      { ...goodCard, id: 'topic-2', readerValues: [{ kind: 'knowledge', benefit: 'b', evidenceIds: ['missing'] }] },
      { ...goodCard },
      { ...goodCard, id: 'topic-3', evidenceConfidence: { level: 'high', reasons: [] } },
    ] }, { snapshot, extractions })
    expect(result.cards.map(card => card.id)).toEqual(['topic-1'])
    expect(result.failures.map(f => f.code)).toEqual(['UNKNOWN_EVIDENCE', 'DUPLICATE_TOPIC_ID', 'INVALID_CONFIDENCE'])
  })

  it('最多保留三张有效卡，多出的卡明确失败', () => {
    const cards = Array.from({ length: 5 }, (_, i) => ({ ...goodCard, id: `topic-${i + 1}` }))
    const result = validateTopicProposals({ cards }, { snapshot, extractions })
    expect(result.cards.map(card => card.id)).toEqual(['topic-1', 'topic-2', 'topic-3'])
    expect(result.failures.map(f => f.code)).toEqual(['TOO_MANY_CARDS', 'TOO_MANY_CARDS'])
  })

  it.each([null, {}, { cards: 'bad' }])('拒绝无效 proposal 顶层结构 %#', raw => {
    expect(() => validateTopicProposals(raw, { snapshot, extractions })).toThrow(TopicModelOutputError)
  })
})

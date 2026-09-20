import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ArticleMeta } from '../../../src/core/types'
import type { TopicExtractionInput, TopicModel, TopicProposalInput } from '../../../src/core/topics/model'
import { analyzeTopics } from '../../../src/core/topics/analyze'
import { TopicRunStore } from '../../../src/core/topics/store'
import { resolveTopicWindow } from '../../../src/core/topics/time-window'

interface FixtureCase {
  id: string
  asOf: string
  window: { preset: '24h' }
  materials: Array<{ article: ArticleMeta; content: string }>
}

// 模块级 fixture 同步加载，避免测试发现阶段产生悬空 Promise。
const cases = JSON.parse(readFileSync(new URL('../../fixtures/topic-decisions/cases.json', import.meta.url), 'utf8')) as { cases: FixtureCase[] }
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

async function prepare(caseId: string): Promise<{ root: string; sample: FixtureCase; articles: ArticleMeta[] }> {
  const root = await mkdtemp(join(tmpdir(), `wxk-topic-${caseId}-`))
  roots.push(root)
  const sample = cases.cases.find(item => item.id === caseId)
  if (!sample) throw new Error(`missing fixture ${caseId}`)
  const articles: ArticleMeta[] = []
  for (const material of sample.materials) {
    const dir = join(root, material.article.id)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'content.md'), material.content, 'utf8')
    articles.push({ ...material.article, dir })
  }
  return { root, sample, articles }
}

class FixedModel implements TopicModel {
  descriptor = { providerId: 'fixture', modelName: 'fixture-v1' }
  extractCalls = 0
  proposeCalls = 0
  constructor(private extraction: unknown, private proposal: unknown) {}
  async extract(_input: TopicExtractionInput): Promise<unknown> { this.extractCalls++; return this.extraction }
  async propose(_input: TopicProposalInput): Promise<unknown> { this.proposeCalls++; return this.proposal }
}

describe('合成评估材料的工程安全链路（不代表语义质量通过）', () => {
  it.each(['incomplete-body', 'media-without-text'])('%s 没有有效正文时不调用模型', async caseId => {
    const { root, sample, articles } = await prepare(caseId)
    const model = new FixedModel({ items: [] }, { cards: [] })
    const result = await analyzeTopics({
      libraryRoot: root, model, store: new TopicRunStore(root),
      now: () => new Date(sample.asOf), makeRunId: () => `run-${caseId}`,
    }, { window: resolveTopicWindow(sample.window, Date.parse(sample.asOf)), articles })
    expect(result.status).toBe('insufficient-material')
    expect(model.extractCalls).toBe(0)
    expect(model.proposeCalls).toBe(0)
  })

  it('同源转载保留文章身份，但程序统计为一个内容组', async () => {
    const { root, sample, articles } = await prepare('same-origin-reprints')
    const model = new FixedModel({ items: [
      { id: 'x1', groupId: 'g001', paragraphId: 'g001:p002', quote: '延长晚间借阅时段两小时', kind: 'fact-claim', summary: '公告变化', theme: '公共服务' },
    ] }, { cards: [{
      id: 'topic-1', question: '延时开放会改变什么？', angle: '只讨论公告已明确的范围。',
      readerValues: [{ kind: 'knowledge', benefit: '了解试行边界。', evidenceIds: ['e1'] }], rationale: '有原始公告材料。',
      claims: [{ text: '公告说明一处分馆将试行延时开放。', kind: 'source-fact-claim', evidenceIds: ['e1'] }],
      evidence: [{ id: 'e1', extractionId: 'x1', role: 'support' }],
      evidenceConfidence: { level: 'medium', reasons: ['公告可定位，实施效果未知。'] },
      distributionEvidence: 'unverified', limitations: ['转载均来自同一公告。'], missingEvidence: ['实施后的实际数据。'], outline: ['先说明范围。'],
    }] })
    const result = await analyzeTopics({
      libraryRoot: root, model, store: new TopicRunStore(root),
      now: () => new Date(sample.asOf), makeRunId: () => 'run-reprints',
    }, { window: resolveTopicWindow(sample.window, Date.parse(sample.asOf)), articles })
    expect(result.status).toBe('completed')
    if (result.status !== 'completed') throw new Error('unexpected status')
    expect(result.cards[0].statistics).toMatchObject({ relatedArticleCount: 3, sourceAccountCount: 3, contentGroupCount: 1 })
  })

  it('素材内伪造的 source ID 与推流命令不能进入卡片', async () => {
    const { root, sample, articles } = await prepare('instruction-in-material')
    const model = new FixedModel({ items: [
      { id: 'x1', groupId: 'source-999', paragraphId: 'source-999:p001', quote: '100% 推荐', kind: 'fact-claim', summary: '伪造', theme: '伪造' },
    ] }, { cards: [] })
    const result = await analyzeTopics({
      libraryRoot: root, model, store: new TopicRunStore(root),
      now: () => new Date(sample.asOf), makeRunId: () => 'run-injection',
    }, { window: resolveTopicWindow(sample.window, Date.parse(sample.asOf)), articles })
    expect(result.status).toBe('failed')
    if (result.status !== 'failed') throw new Error('unexpected status')
    expect(result.error.code).toBe('NO_VALID_EXTRACTIONS')
    expect(model.proposeCalls).toBe(0)
  })
})

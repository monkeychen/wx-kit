import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ArticleMeta } from '../../../src/core/types'
import type { TopicExtractionInput, TopicModel, TopicProposalInput } from '../../../src/core/topics/model'
import { TOPIC_EXTRACT_VERSION, TOPIC_PROPOSE_VERSION, TOPIC_SYSTEM_VERSION } from '../../../src/core/topics/model'
import { resolveTopicWindow } from '../../../src/core/topics/time-window'
import { TopicRunStore } from '../../../src/core/topics/store'
import { analyzeTopics } from '../../../src/core/topics/analyze'

const AS_OF = Date.parse('2026-09-20T04:00:00Z')
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'wxk-topic-analyze-'))
  roots.push(root)
  return root
}

async function material(root: string, id = 'a1', content = '# 上涨后的感受\n\n行情上涨以后，一些人反而更频繁查看账户。'): Promise<ArticleMeta> {
  const dir = join(root, id)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'content.md'), content, 'utf8')
  return {
    id, title: '上涨后的感受', author: '作者甲', account: '账号甲', accountId: 'acc-a',
    publishTime: '2026-09-19 16:00', sourceUrl: `https://example.invalid/${id}`,
    digest: '', coverUrl: '', downloadTime: '2026-09-20T03:00:00Z', formats: ['md'], dir,
  }
}

const extraction = { items: [
  { id: 'x1', groupId: 'g001', paragraphId: 'g001:p002', quote: '更频繁查看账户', kind: 'emotion', summary: '上涨时仍焦虑', theme: '投资焦虑' },
] }

const goodCard = {
  id: 'topic-1', question: '为什么上涨时仍会焦虑？', angle: '解释踏空感受的来源。',
  readerValues: [{ kind: 'anxiety-relief', benefit: '把模糊感受拆成可检查的问题。', evidenceIds: ['e1'] }],
  rationale: '素材提供了一个可解释的具体情境。',
  claims: [{ text: '这可以作为解释型文章的入口。', kind: 'editorial-inference', evidenceIds: ['e1'] }],
  evidence: [{ id: 'e1', extractionId: 'x1', role: 'support' }],
  evidenceConfidence: { level: 'low', reasons: ['只有材料表达，没有读者数据。'] },
  distributionEvidence: 'unverified', limitations: ['传播效果未知。'], missingEvidence: ['需要读者反馈。'],
  outline: ['从具体感受开篇。', '解释一种可能机制。'],
}

class FakeModel implements TopicModel {
  descriptor = { providerId: 'fixture', modelName: 'fixture-v1' }
  extractCalls = 0
  proposeCalls = 0
  extractionInput?: TopicExtractionInput
  proposalInput?: TopicProposalInput
  usageValue?: { inputTokens?: number; outputTokens?: number }
  constructor(private extractionRaw: unknown = extraction, private proposalRaw: unknown = { cards: [goodCard] }) {}
  async extract(input: TopicExtractionInput): Promise<unknown> { this.extractCalls++; this.extractionInput = input; return this.extractionRaw }
  async propose(input: TopicProposalInput): Promise<unknown> { this.proposeCalls++; this.proposalInput = input; return this.proposalRaw }
  usage(): { inputTokens?: number; outputTokens?: number } | undefined { return this.usageValue }
}

const window = resolveTopicWindow(undefined, AS_OF)
const fixedNow = () => new Date(AS_OF)

describe('可验证选题分析编排', () => {
  it('运行真实快照、校验、统计和落盘，读取结果不会重复调用模型', async () => {
    const root = await tempRoot()
    const model = new FakeModel()
    model.usageValue = { inputTokens: 21, outputTokens: 8 }
    const store = new TopicRunStore(root)
    const result = await analyzeTopics({ libraryRoot: root, model, store, now: fixedNow, makeRunId: () => 'run-success' }, {
      window, articles: [await material(root)],
    })

    expect(result).toMatchObject({
      status: 'completed', runId: 'run-success', durationMs: 0,
      model: { providerId: 'fixture', modelName: 'fixture-v1', systemVersion: TOPIC_SYSTEM_VERSION, taskVersion: `${TOPIC_EXTRACT_VERSION}+${TOPIC_PROPOSE_VERSION}` },
      usage: { inputTokens: 21, outputTokens: 8 },
      cards: [{ id: 'topic-1', statistics: { relatedArticleCount: 1, sourceAccountCount: 1, contentGroupCount: 1 } }],
    })
    expect(model.extractionInput).toMatchObject({ systemVersion: TOPIC_SYSTEM_VERSION, taskVersion: TOPIC_EXTRACT_VERSION })
    expect(model.proposalInput).toMatchObject({ taskVersion: TOPIC_PROPOSE_VERSION, extractions: [{ id: 'x1' }] })
    expect(model.extractCalls).toBe(1)
    expect(model.proposeCalls).toBe(1)
    expect(await store.readResult('run-success')).toEqual(result)
    expect(model.extractCalls).toBe(1)
    expect(model.proposeCalls).toBe(1)
    const manifest = JSON.parse(await readFile(join(root, 'topic-decisions', 'runs', 'run-success', 'manifest.json'), 'utf8'))
    expect(manifest.paragraphs.map((p: { id: string }) => p.id)).toEqual(['g001:p001', 'g001:p002'])
    const trace = (await readFile(join(root, 'topic-decisions', 'runs', 'run-success', 'trace.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    expect(trace.map(event => `${event.stage}:${event.status}`)).toEqual([
      'snapshot:done', 'extract:start', 'extract:done', 'validate-extract:done',
      'propose:start', 'propose:done', 'validate-propose:done', 'result:done',
    ])
  })

  it('没有有效文字时返回材料不足且不调用模型', async () => {
    const root = await tempRoot()
    const model = new FakeModel()
    const result = await analyzeTopics({ libraryRoot: root, model, store: new TopicRunStore(root), now: fixedNow, makeRunId: () => 'run-empty' }, {
      window, articles: [await material(root, 'image', '![图片](images/x.png)')],
    })
    expect(result).toMatchObject({ status: 'insufficient-material', cards: [], reason: expect.stringContaining('可分析') })
    expect(model.extractCalls).toBe(0)
    expect(model.proposeCalls).toBe(0)
  })

  it('一张卡失败时交付其它卡并保留失败详情', async () => {
    const root = await tempRoot()
    const model = new FakeModel(extraction, { cards: [goodCard, { ...goodCard, id: 'bad', evidence: [{ id: 'e2', extractionId: 'missing', role: 'support' }] }] })
    const result = await analyzeTopics({ libraryRoot: root, model, store: new TopicRunStore(root), now: fixedNow, makeRunId: () => 'run-partial' }, {
      window, articles: [await material(root)],
    })
    expect(result.status).toBe('partial')
    if (result.status !== 'partial') throw new Error('unexpected status')
    expect(result.cards.map(card => card.id)).toEqual(['topic-1'])
    expect(result.failures.map(failure => failure.code)).toEqual(['UNKNOWN_EXTRACTION'])
  })

  it('M76：候选全灭时错误里带失败原因与模型实际取值（只报 code 无法行动）', async () => {
    const root = await tempRoot()
    const bad = { ...goodCard, distributionEvidence: '未验证' }
    const model = new FakeModel(extraction, { cards: [bad, { ...bad, id: 'topic-2' }] })
    const result = await analyzeTopics({ libraryRoot: root, model, store: new TopicRunStore(root), now: fixedNow, makeRunId: () => 'run-badcards' }, {
      window, articles: [await material(root)],
    })
    expect(result.status).toBe('failed')
    if (result.status !== 'failed') throw new Error('unexpected status')
    expect(result.error.code).toBe('NO_VALID_CARDS')
    expect(result.error.message).toContain('INVALID_DISTRIBUTION_EVIDENCE ×2')
    expect(result.error.message).toContain('未验证')
  })

  it('模型明确返回空候选时是完成的空结果', async () => {
    const root = await tempRoot()
    const result = await analyzeTopics({ libraryRoot: root, model: new FakeModel(extraction, { cards: [] }), store: new TopicRunStore(root), now: fixedNow, makeRunId: () => 'run-no-cards' }, {
      window, articles: [await material(root)],
    })
    expect(result).toMatchObject({ status: 'completed', cards: [] })
  })

  it.each([
    ['模型请求失败', new Error('provider unavailable'), 'MODEL_REQUEST_FAILED'],
    ['模型结构无效', { invalid: true }, 'INVALID_EXTRACTION_OUTPUT'],
  ])('%s 不伪装成没有选题', async (_name, extractionRaw, code) => {
    const root = await tempRoot()
    const model = new FakeModel(extractionRaw)
    if (extractionRaw instanceof Error) model.extract = async () => { throw extractionRaw }
    const result = await analyzeTopics({ libraryRoot: root, model, store: new TopicRunStore(root), now: fixedNow, makeRunId: () => `run-${code.toLowerCase()}` }, {
      window, articles: [await material(root)],
    })
    expect(result.status).toBe('failed')
    if (result.status !== 'failed') throw new Error('unexpected status')
    expect(result.error.code).toBe(code)
    expect(result.cards).toEqual([])
  })

  it('供应商错误中的敏感赋值在 result 和 trace 落盘前脱敏', async () => {
    const root = await tempRoot()
    const model = new FakeModel()
    model.extract = async () => { throw new Error('401 api_key=abc123 token=secret456') }
    const store = new TopicRunStore(root)
    const result = await analyzeTopics({ libraryRoot: root, model, store, now: fixedNow, makeRunId: () => 'run-redacted' }, {
      window, articles: [await material(root)],
    })
    expect(result.status).toBe('failed')
    if (result.status !== 'failed') throw new Error('unexpected status')
    expect(result.error.message).toContain('api_key=«redacted:6»')
    expect(result.error.message).toContain('token=«redacted:9»')
    const files = [
      await readFile(join(root, 'topic-decisions', 'runs', 'run-redacted', 'result.json'), 'utf8'),
      await readFile(join(root, 'topic-decisions', 'runs', 'run-redacted', 'trace.jsonl'), 'utf8'),
    ].join('\n')
    expect(files).not.toContain('abc123')
    expect(files).not.toContain('secret456')
  })

  it('AbortError 返回取消状态而非失败或空候选', async () => {
    const root = await tempRoot()
    const model = new FakeModel()
    model.extract = async () => { throw Object.assign(new Error('cancelled'), { name: 'AbortError' }) }
    const result = await analyzeTopics({ libraryRoot: root, model, store: new TopicRunStore(root), now: fixedNow, makeRunId: () => 'run-cancelled' }, {
      window, articles: [await material(root)],
    })
    expect(result).toMatchObject({ status: 'cancelled', cards: [] })
  })

  it('manifest 无法落盘时直接抛存储错误，不伪造运行结果', async () => {
    const root = await tempRoot()
    class FailingManifestStore extends TopicRunStore {
      override async writeManifest(): Promise<string> { throw new Error('disk full') }
    }
    const run = analyzeTopics({ libraryRoot: root, model: new FakeModel(), store: new FailingManifestStore(root), now: fixedNow, makeRunId: () => 'run-store-fail' }, {
      window, articles: [await material(root)],
    })
    await expect(run).rejects.toThrow(/disk full/)
  })

  it('result 写入失败返回独立存储失败，不把分析结论说成已保存', async () => {
    const root = await tempRoot()
    class FailingResultStore extends TopicRunStore {
      override async writeResult(): Promise<string> { throw new Error('read only') }
    }
    const result = await analyzeTopics({ libraryRoot: root, model: new FakeModel(), store: new FailingResultStore(root), now: fixedNow, makeRunId: () => 'run-result-fail' }, {
      window, articles: [await material(root)],
    })
    expect(result.status).toBe('failed')
    if (result.status !== 'failed') throw new Error('unexpected status')
    expect(result.error.code).toBe('STORE_RESULT_FAILED')
  })
})

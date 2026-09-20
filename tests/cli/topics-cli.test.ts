import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TopicExtractionInput, TopicModel, TopicProposalInput } from '../../src/core/topics/model'
import type { TopicCliModelConfig } from '../../src/core/topics/cli-input'

vi.mock('electron', () => ({
  BrowserWindow: class {},
  session: { fromPartition: vi.fn(() => ({ fetch: vi.fn(), cookies: { set: vi.fn(), get: vi.fn(async () => []) } })) },
}))
vi.mock('../../electron/services/mp-auth', () => ({ getSession: vi.fn(() => null), startFreshLogin: vi.fn() }))

import { runCli } from '../../src/cli'

let stdout = ''
let stderr = ''
beforeEach(() => {
  stdout = ''; stderr = ''
  vi.spyOn(process.stdout, 'write').mockImplementation(value => { stdout += value; return true })
  vi.spyOn(process.stderr, 'write').mockImplementation(value => { stderr += value; return true })
})

function seedLibrary(): string {
  const root = mkdtempSync(join(tmpdir(), 'wxk-topics-cli-'))
  const current = join(root, 'acc', 'current')
  const old = join(root, 'acc', 'old')
  mkdirSync(current, { recursive: true }); mkdirSync(old, { recursive: true })
  writeFileSync(join(current, 'content.md'), '# 上涨后的感受\n\n行情上涨以后，一些人反而更频繁查看账户。')
  writeFileSync(join(old, 'content.md'), '# 旧文章\n\n这篇文章不在所选时间范围。')
  writeFileSync(join(root, 'library.json'), JSON.stringify({ version: 1, articles: [
    { id: 'current', title: '上涨后的感受', author: '作者甲', account: '账号甲', accountId: 'acc-a', publishTime: '2026-09-19 16:00', sourceUrl: 'https://example.invalid/current', digest: '', coverUrl: '', downloadTime: '2026-09-20T03:00:00Z', formats: ['md'], dir: current },
    { id: 'old', title: '旧文章', author: '作者甲', account: '账号甲', accountId: 'acc-a', publishTime: '2026-09-18 10:00', sourceUrl: 'https://example.invalid/old', digest: '', coverUrl: '', downloadTime: '2026-09-20T03:00:00Z', formats: ['md'], dir: old },
  ] }))
  return root
}

class CliFakeModel implements TopicModel {
  descriptor = { providerId: 'fixture', modelName: 'fixture-cli' }
  calls = 0
  async extract(_input: TopicExtractionInput): Promise<unknown> {
    this.calls++
    return { items: [{ id: 'x1', groupId: 'g001', paragraphId: 'g001:p002', quote: '更频繁查看账户', kind: 'emotion', summary: '上涨时仍焦虑', theme: '投资焦虑' }] }
  }
  async propose(_input: TopicProposalInput): Promise<unknown> {
    this.calls++
    return { cards: [{
      id: 'topic-1', question: '为什么上涨时仍会焦虑？', angle: '解释一种可能机制。',
      readerValues: [{ kind: 'anxiety-relief', benefit: '把模糊感受拆成问题。', evidenceIds: ['e1'] }],
      rationale: '材料提供了具体情境。', claims: [{ text: '可以形成解释型文章。', kind: 'editorial-inference', evidenceIds: ['e1'] }],
      evidence: [{ id: 'e1', extractionId: 'x1', role: 'support' }],
      evidenceConfidence: { level: 'low', reasons: ['没有读者行为数据。'] }, distributionEvidence: 'unverified',
      limitations: ['传播效果未知。'], missingEvidence: ['需要读者反馈。'], outline: ['从情境开篇。', '解释机制。'],
    }] }
  }
}

const env = { WXKIT_AI_API_KEY: 'cli-secret', WXKIT_AI_BASE_URL: 'https://api.example.invalid/v1', WXKIT_AI_MODEL: 'model-a' }
const now = () => new Date('2026-09-20T04:00:00Z')

describe('topics CLI', () => {
  it('analyze 运行完整本地链路，stdout 纯 JSON 且不落 Key', async () => {
    const root = seedLibrary()
    const userDataDir = mkdtempSync(join(tmpdir(), 'wxk-topics-ud-'))
    let config: TopicCliModelConfig | undefined
    const model = new CliFakeModel()
    const code = await runCli(['topics', 'analyze', '--range', '24h', '--base-url', 'https://flag.invalid/v1', '--model', 'flag-model', '--out', root], {
      userDataDir, env, now, makeTopicRunId: () => 'run-cli',
      topicModelFactory: value => { config = value; return model },
    })
    expect(code).toBe(0)
    const result = JSON.parse(stdout)
    expect(result).toMatchObject({ ok: true, status: 'completed', runId: 'run-cli', timeExcludedCount: 1, cards: [{ id: 'topic-1' }] })
    expect(config).toEqual({ baseUrl: 'https://flag.invalid/v1', model: 'flag-model', apiKey: 'cli-secret' })
    expect(stderr).toContain('正在整理素材')
    const files = [
      stdout,
      readFileSync(join(root, 'topic-decisions', 'runs', 'run-cli', 'result.json'), 'utf8'),
      readFileSync(join(root, 'topic-decisions', 'runs', 'run-cli', 'trace.jsonl'), 'utf8'),
    ].join('\n')
    expect(files).not.toContain('cli-secret')
  })

  it('brief 从保存结果生成 Markdown，不再次调用模型', async () => {
    const root = seedLibrary()
    const model = new CliFakeModel()
    const options = { userDataDir: mkdtempSync(join(tmpdir(), 'wxk-topics-ud-')), env, now, makeTopicRunId: () => 'run-brief', topicModelFactory: () => model }
    expect(await runCli(['topics', 'analyze', '--out', root], options)).toBe(0)
    expect(model.calls).toBe(2)
    stdout = ''; stderr = ''
    expect(await runCli(['topics', 'brief', '--run', 'run-brief', '--topic', 'topic-1', '--out', root], options)).toBe(0)
    const result = JSON.parse(stdout)
    expect(result).toMatchObject({ ok: true, runId: 'run-brief', topicId: 'topic-1' })
    expect(readFileSync(result.path, 'utf8')).toContain('# 为什么上涨时仍会焦虑？')
    expect(model.calls).toBe(2)
  })

  it('缺少 Key 或时间参数无效时退出 2 且不创建模型', async () => {
    const root = seedLibrary()
    let factoryCalls = 0
    const options = { userDataDir: mkdtempSync(join(tmpdir(), 'wxk-topics-ud-')), env: { WXKIT_AI_BASE_URL: 'https://x.invalid/v1', WXKIT_AI_MODEL: 'm' }, now, topicModelFactory: () => { factoryCalls++; return new CliFakeModel() } }
    expect(await runCli(['topics', 'analyze', '--out', root], options)).toBe(2)
    expect(JSON.parse(stdout)).toMatchObject({ ok: false, error: { code: 'MISSING_AI_API_KEY' } })
    expect(stdout).not.toContain('cli-secret')
    expect(factoryCalls).toBe(0)
    stdout = ''
    expect(await runCli(['topics', 'analyze', '--range', 'custom', '--from', '2026-09-19', '--out', root], { ...options, env })).toBe(2)
    expect(JSON.parse(stdout)).toMatchObject({ ok: false, error: { code: 'INVALID_TOPIC_RANGE' } })
    expect(factoryCalls).toBe(0)
  })

  it('供应商失败返回退出 1，不伪装成空候选', async () => {
    const root = seedLibrary()
    const model = new CliFakeModel()
    model.extract = async () => { throw new Error('provider down') }
    const code = await runCli(['topics', 'analyze', '--out', root], {
      userDataDir: mkdtempSync(join(tmpdir(), 'wxk-topics-ud-')), env, now, makeTopicRunId: () => 'run-failed', topicModelFactory: () => model,
    })
    expect(code).toBe(1)
    expect(JSON.parse(stdout)).toMatchObject({ ok: false, status: 'failed', error: { code: 'MODEL_REQUEST_FAILED' } })
  })

  it('brief 拒绝不存在候选且零模型请求', async () => {
    const root = seedLibrary()
    let calls = 0
    const code = await runCli(['topics', 'brief', '--run', 'missing', '--topic', 'topic-1', '--out', root], {
      userDataDir: mkdtempSync(join(tmpdir(), 'wxk-topics-ud-')), env,
      topicModelFactory: () => { calls++; return new CliFakeModel() },
    })
    expect(code).toBe(1)
    expect(JSON.parse(stdout)).toMatchObject({ ok: false, error: { code: 'TOPIC_RESULT_ERROR' } })
    expect(calls).toBe(0)
  })
})

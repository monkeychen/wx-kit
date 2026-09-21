import { afterEach, describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { SettingsService } from '../../electron/services/settings'
import { TopicAiConfigService, type TopicSafeStorage } from '../../electron/services/topic-ai-config'
import { TopicService } from '../../electron/services/topics-service'
import type { TopicExtractionInput, TopicModel, TopicProposalInput } from '../../src/core/topics/model'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function temp(prefix: string): Promise<string> { const value = await mkdtemp(join(tmpdir(), prefix)); roots.push(value); return value }
const sessionOnly: TopicSafeStorage = { isEncryptionAvailable: () => false, encryptString: value => Buffer.from(value), decryptString: value => value.toString() }

async function setupLibrary(): Promise<{ root: string; settings: SettingsService; config: TopicAiConfigService }> {
  const userData = await temp('wxk-topic-ipc-ud-')
  const root = await temp('wxk-topic-ipc-lib-')
  const dir = join(root, 'acc', 'a1')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'content.md'), '# 标题\n\n正文出现了一个值得解释的问题。', 'utf8')
  await writeFile(join(root, 'library.json'), JSON.stringify({ version: 1, articles: [{
    id: 'a1', title: '合成文章', author: '作者', account: '账号', publishTime: '2026-09-20 09:00',
    sourceUrl: 'https://example.invalid/a1', digest: '', coverUrl: '', downloadTime: '2026-09-20T03:00:00Z', formats: ['md'], dir,
  }] }), 'utf8')
  const settings = new SettingsService(userData, root)
  await settings.save({ libraryRoot: root })
  return { root, settings, config: new TopicAiConfigService(settings, userData, sessionOnly) }
}

class ServiceModel implements TopicModel {
  descriptor = { providerId: 'fixture', modelName: 'fixture-gui' }
  calls = 0
  async extract(_input: TopicExtractionInput, signal?: AbortSignal): Promise<unknown> {
    this.calls++; if (signal?.aborted) throw Object.assign(new Error('cancelled'), { name: 'AbortError' })
    return { items: [{ id: 'x1', groupId: 'g001', paragraphId: 'g001:p002', quote: '值得解释的问题', kind: 'question', summary: '问题', theme: '主题' }] }
  }
  async propose(_input: TopicProposalInput): Promise<unknown> {
    this.calls++
    return { cards: [{
      id: 'topic-1', question: '这个问题为什么值得解释？', angle: '把问题拆成具体条件。',
      readerValues: [{ kind: 'knowledge', benefit: '获得可检查的框架。', evidenceIds: ['e1'] }], rationale: '材料提出了明确问题。',
      claims: [{ text: '可以形成解释型文章。', kind: 'editorial-inference', evidenceIds: ['e1'] }], evidence: [{ id: 'e1', extractionId: 'x1', role: 'support' }],
      evidenceConfidence: { level: 'low', reasons: ['只有一篇材料。'] }, distributionEvidence: 'unverified', limitations: ['传播未知。'], missingEvidence: ['需要补充资料。'], outline: ['提出问题。', '解释条件。'],
    }] }
  }
}

const now = () => new Date('2026-09-20T04:00:00Z')

describe('TopicService（IPC 背后的真实服务）', () => {
  it('无配置时返回可行动错误，模型工厂零调用', async () => {
    const { settings, config } = await setupLibrary()
    let factoryCalls = 0
    const service = new TopicService({ settings, config, now, modelFactory: () => { factoryCalls++; return new ServiceModel() } })
    const response = await service.analyze({ window: { preset: '24h' } })
    expect(response).toMatchObject({ ok: false, error: { code: 'MISSING_AI_BASE_URL' } })
    expect(factoryCalls).toBe(0)
  })

  it('配置后运行共享核心并推送阶段，renderer 响应不含 Key', async () => {
    const { settings, config } = await setupLibrary()
    await config.save({ providerId: 'custom', baseUrl: 'http://127.0.0.1:1234/v1', model: 'local', apiKey: 'ipc-secret' })
    const model = new ServiceModel()
    const stages: string[] = []
    const service = new TopicService({ settings, config, now, makeRunId: () => 'run-ipc', makeEventId: () => 'feedback-ipc', modelFactory: () => model })
    const response = await service.analyze({ window: { preset: '24h' } }, stage => stages.push(stage))
    expect(response).toMatchObject({ ok: true, timeExcludedCount: 0, result: { status: 'completed', runId: 'run-ipc', cards: [{ id: 'topic-1' }] } })
    expect(stages).toEqual(['snapshot', 'extract', 'propose', 'result'])
    expect(JSON.stringify(response)).not.toContain('ipc-secret')

    const brief = await service.brief({ runId: 'run-ipc', topicId: 'topic-1' })
    expect(brief).toMatchObject({ ok: true, path: expect.stringMatching(/topic-1\.md$/), markdown: expect.stringContaining('# 这个问题为什么值得解释？') })
    expect(model.calls).toBe(2)
    const feedback = await service.feedback({ runId: 'run-ipc', topicId: 'topic-1', decision: 'watch' })
    expect(feedback).toMatchObject({ ok: true, path: expect.stringMatching(/feedback-ipc\.json$/) })
    expect(JSON.parse(await readFile(feedback.ok ? feedback.path : '', 'utf8')).decision).toBe('watch')
    expect(await service.getConfig()).toMatchObject({ keyConfigured: true, keyPersistent: false })
  })

  it('同一时刻拒绝第二个分析，并能取消第一个', async () => {
    const { settings, config } = await setupLibrary()
    await config.save({ providerId: 'custom', baseUrl: 'http://127.0.0.1:1234/v1', model: 'local', apiKey: 'k' })
    class WaitingModel extends ServiceModel {
      override async extract(_input: TopicExtractionInput, signal?: AbortSignal): Promise<unknown> {
        this.calls++
        return new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), { name: 'AbortError' })), { once: true }))
      }
    }
    const service = new TopicService({ settings, config, now, makeRunId: () => 'run-wait', modelFactory: () => new WaitingModel() })
    const first = service.analyze({ window: { preset: '24h' } })
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(await service.analyze({ window: { preset: '24h' } })).toMatchObject({ ok: false, error: { code: 'TOPIC_ANALYSIS_RUNNING' } })
    // M73.1：运行状态可查询（切页重挂载后 renderer 靠它恢复「进行中」现场，含范围与取消入口）
    expect(service.getRunningStatus()).toEqual({ running: true, startedAt: expect.any(Number), stage: 'extract', window: { preset: '24h' } })
    expect(service.cancel()).toEqual({ ok: true })
    expect(await first).toMatchObject({ ok: true, result: { status: 'cancelled' } })
    expect(service.cancel()).toMatchObject({ ok: false, error: { code: 'NO_TOPIC_ANALYSIS' } })
    expect(service.getRunningStatus()).toEqual({ running: false, startedAt: null, stage: null, window: null })
  })

  it('测试连接：空 Key 回退已存 Key 发最小请求；无 Key 给可行动错误', async () => {
    const { settings, config } = await setupLibrary()
    await config.save({ providerId: 'custom', baseUrl: 'http://127.0.0.1:1/v1', model: 'local', apiKey: 'saved-key' })
    const service = new TopicService({ settings, config })

    const seenAuth: string[] = []
    const server = createServer((req, res) => {
      seenAuth.push(String(req.headers.authorization))
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: '' } }], usage: { prompt_tokens: 3, completion_tokens: 1 } }))
    })
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve()) })
    const port = (server.address() as AddressInfo).port
    try {
      const result = await service.testConnection({ baseUrl: `http://127.0.0.1:${port}/v1`, model: 'local' })
      expect(result).toMatchObject({ ok: true, model: 'local', usage: { inputTokens: 3, outputTokens: 1 } })
      expect(seenAuth).toEqual(['Bearer saved-key'])
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }

    const fresh = await setupLibrary()
    const bare = new TopicService({ settings: fresh.settings, config: fresh.config })
    await expect(bare.testConnection({ baseUrl: 'http://127.0.0.1:1/v1', model: 'local' }))
      .resolves.toMatchObject({ ok: false, error: { code: 'MISSING_AI_BASE_URL' } })
    await fresh.config.save({ providerId: 'custom', baseUrl: 'http://127.0.0.1:1/v1', model: 'local' })
    await expect(bare.testConnection({ baseUrl: 'http://127.0.0.1:1/v1', model: 'local' }))
      .resolves.toMatchObject({ ok: false, error: { code: 'MISSING_AI_API_KEY' } })
  })
})

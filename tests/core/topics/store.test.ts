import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TopicFeedbackEvent, TopicMaterialSnapshot, TopicRunResult, TopicTraceEvent } from '../../../src/core/topics/types'
import { TopicRunStore } from '../../../src/core/topics/store'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
const window = { preset: '24h' as const, fromMs: 1, toMs: 2, asOfMs: 2, timeZone: 'Asia/Shanghai' as const }

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'wxk-topic-store-'))
  roots.push(value)
  return value
}

const manifest: TopicMaterialSnapshot = {
  schemaVersion: 1, runId: 'run-1', createdAt: '2026-09-20T04:00:00.000Z', window,
  articles: [], groups: [], paragraphs: [], excluded: [], totalModelChars: 0,
}
const snapshotArticle = {
  id: 'a-1', title: 't', author: 'x', account: 'acc', publishTime: '2026-09-20T03:00:00.000Z',
  sourceUrl: 'https://mp.weixin.qq.com/s/x', contentHash: 'h', groupId: 'g1', warnings: [],
}
const cardTemplate = {
  id: 'topic-1', question: 'q', angle: 'a', rationale: 'r', limitations: [], outline: [],
  readerValues: [], evidence: [], claims: [], missingEvidence: [],
  statistics: { relatedArticleCount: 1, sourceAccountCount: 1, contentGroupCount: 1, publishedDates: [] },
  distributionEvidence: 'unverified' as const,
  evidenceConfidence: { level: 'medium' as const, reasons: [] },
}
const result: TopicRunResult = {
  schemaVersion: 1, runId: 'run-1', window, manifestPath: '/library/topic-decisions/runs/run-1/manifest.json',
  createdAt: '2026-09-20T04:00:00.000Z', durationMs: 12, status: 'completed', cards: [],
}

describe('选题运行存储', () => {
  it('原子写入并读取 manifest/result/brief，路径固定在文库子目录', async () => {
    const libraryRoot = await root()
    const store = new TopicRunStore(libraryRoot)
    const manifestPath = await store.writeManifest('run-1', manifest)
    const resultPath = await store.writeResult('run-1', result)
    const briefPath = await store.writeBrief('run-1', 'topic-1', '# 简报\n')

    expect(manifestPath).toBe(join(libraryRoot, 'topic-decisions', 'runs', 'run-1', 'manifest.json'))
    expect(resultPath).toBe(join(libraryRoot, 'topic-decisions', 'runs', 'run-1', 'result.json'))
    expect(briefPath).toBe(join(libraryRoot, 'topic-decisions', 'runs', 'run-1', 'briefs', 'topic-1.md'))
    expect(JSON.parse(await readFile(manifestPath, 'utf8'))).toEqual(manifest)
    expect(await store.readResult('run-1')).toEqual(result)
    expect(await readFile(briefPath, 'utf8')).toBe('# 简报\n')
  })

  it('串行追加完整 JSONL trace', async () => {
    const libraryRoot = await root()
    const store = new TopicRunStore(libraryRoot)
    const events: TopicTraceEvent[] = [
      { time: '2026-09-20T04:00:00.000Z', stage: 'snapshot', status: 'done', counts: { articles: 3 }, durationMs: 4 },
      { time: '2026-09-20T04:00:01.000Z', stage: 'extract', status: 'failed', error: { code: 'BAD_OUTPUT', message: '结构无效' } },
    ]
    await Promise.all(events.map(event => store.appendTrace('run-1', event)))
    const trace = (await readFile(join(libraryRoot, 'topic-decisions', 'runs', 'run-1', 'trace.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    expect(trace).toEqual(events)
  })

  it.each(['../escape', '..', 'a/b', '/absolute', 'a\\b', '', '.hidden'])('拒绝不安全 run ID：%s', async id => {
    const store = new TopicRunStore(await root())
    await expect(store.writeManifest(id, manifest)).rejects.toThrow(/ID/)
  })

  it.each(['../escape', '..', 'a/b', '/absolute', 'a\\b', '', '.hidden'])('拒绝不安全 topic ID：%s', async id => {
    const store = new TopicRunStore(await root())
    await expect(store.writeBrief('run-1', id, 'x')).rejects.toThrow(/ID/)
  })

  it('读取不存在或损坏的 result 给出可行动错误', async () => {
    const libraryRoot = await root()
    const store = new TopicRunStore(libraryRoot)
    await expect(store.readResult('missing')).rejects.toThrow(/不存在/)
    const path = join(libraryRoot, 'topic-decisions', 'runs', 'broken')
    await store.writeBrief('broken', 'x', 'seed')
    await import('node:fs/promises').then(fs => fs.writeFile(join(path, 'result.json'), '{bad', 'utf8'))
    await expect(store.readResult('broken')).rejects.toThrow(/损坏/)
  })

  it('反馈按事件独立原子落盘且同 ID 可安全替换', async () => {
    const libraryRoot = await root()
    const store = new TopicRunStore(libraryRoot)
    const event: TopicFeedbackEvent = {
      schemaVersion: 1, id: 'feedback-1', runId: 'run-1', topicId: 'topic-1', decision: 'watch', recordedAt: '2026-09-20T04:00:00.000Z',
    }
    const path = await store.writeFeedback(event)
    expect(path).toBe(join(libraryRoot, 'topic-decisions', 'feedback', 'feedback-1.json'))
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(event)
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    await store.writeFeedback({ ...event, decision: 'already-written' })
    expect(JSON.parse(await readFile(path, 'utf8')).decision).toBe('already-written')
  })

  it.each(['skip', 'watch', 'already-written'] as const)('接受反馈 decision：%s', async decision => {
    const store = new TopicRunStore(await root())
    await expect(store.writeFeedback({ schemaVersion: 1, id: `f-${decision}`, runId: 'run-1', topicId: 'topic-1', decision, recordedAt: '2026-09-20T04:00:00.000Z' })).resolves.toMatch(/\.json$/)
  })

  it('拒绝非法反馈 decision 和路径 ID', async () => {
    const store = new TopicRunStore(await root())
    await expect(store.writeFeedback({ schemaVersion: 1, id: '../x', runId: 'run-1', topicId: 'topic-1', decision: 'skip', recordedAt: 'x' })).rejects.toThrow(/ID/)
    await expect(store.writeFeedback({ schemaVersion: 1, id: 'f-1', runId: 'run-1', topicId: 'topic-1', decision: 'forever-ban', recordedAt: 'x' } as unknown as TopicFeedbackEvent)).rejects.toThrow(/decision/)
  })

  it('listRunSummaries：按时间倒序、附素材篇数与候选标题、limit 生效', async () => {
    const libraryRoot = await root()
    const store = new TopicRunStore(libraryRoot)
    for (const [id, at] of [['run-a', '2026-09-20T04:00:00.000Z'], ['run-b', '2026-09-21T04:00:00.000Z']] as const) {
      await store.writeManifest(id, { ...manifest, runId: id, createdAt: at, articles: [{ ...snapshotArticle, title: `文章-${id}` }] })
      await store.writeResult(id, { ...result, runId: id, createdAt: at, cards: [{ ...cardTemplate, question: `问题-${id}` }] })
    }
    const list = await store.listRunSummaries()
    expect(list.map(item => item.runId)).toEqual(['run-b', 'run-a'])
    expect(list[0].articleCount).toBe(1)
    expect(list[0].articleTitles).toEqual(['文章-run-b'])
    expect(list[0].cardQuestions).toContain('问题-run-b')
    expect((await store.listRunSummaries(1)).map(item => item.runId)).toEqual(['run-b'])
  })

  it('listRunSummaries：目录不存在返回空，损坏条目跳过不影响其余', async () => {
    const libraryRoot = await root()
    const store = new TopicRunStore(libraryRoot)
    expect(await store.listRunSummaries()).toEqual([])
    await store.writeResult('run-ok', { ...result, runId: 'run-ok' })
    await import('node:fs/promises').then(async fs => {
      const dir = join(libraryRoot, 'topic-decisions', 'runs', 'run-bad')
      await fs.mkdir(dir, { recursive: true })
      await fs.writeFile(join(dir, 'result.json'), '{bad', 'utf8')
    })
    const list = await store.listRunSummaries()
    expect(list.map(item => item.runId)).toEqual(['run-ok'])
  })

  it('readManifest 校验 runId 一致；readFeedback 只取该 run 且按时间正序', async () => {
    const libraryRoot = await root()
    const store = new TopicRunStore(libraryRoot)
    await store.writeManifest('run-1', manifest)
    expect((await store.readManifest('run-1')).runId).toBe('run-1')
    await expect(store.readManifest('missing')).rejects.toThrow()

    const base = { schemaVersion: 1 as const, runId: 'run-1', topicId: 'topic-1' }
    await store.writeFeedback({ ...base, id: 'f-2', decision: 'skip', recordedAt: '2026-09-20T05:00:00.000Z' })
    await store.writeFeedback({ ...base, id: 'f-1', decision: 'watch', recordedAt: '2026-09-20T04:00:00.000Z' })
    await store.writeFeedback({ ...base, id: 'f-x', runId: 'run-2', topicId: 'topic-1', decision: 'skip', recordedAt: '2026-09-20T04:00:00.000Z' })
    const events = await store.readFeedback('run-1')
    expect(events.map(item => item.id)).toEqual(['f-1', 'f-2'])
    expect(events[1].decision).toBe('skip')
  })

  it('deleteRun：清 run 目录与该 run 的反馈事件，不动别的 run', async () => {
    const libraryRoot = await root()
    const store = new TopicRunStore(libraryRoot)
    await store.writeResult('run-1', result)
    await store.writeManifest('run-1', manifest)
    await store.writeBrief('run-1', 'topic-1', '# x')
    await store.writeFeedback({ schemaVersion: 1, id: 'f-1', runId: 'run-1', topicId: 'topic-1', decision: 'watch', recordedAt: 'x' })
    await store.writeResult('run-2', { ...result, runId: 'run-2' })
    await store.writeFeedback({ schemaVersion: 1, id: 'f-2', runId: 'run-2', topicId: 'topic-1', decision: 'skip', recordedAt: 'x' })

    await store.deleteRun('run-1')
    await expect(store.readResult('run-1')).rejects.toThrow(/不存在/)
    expect(await store.readFeedback('run-1')).toEqual([])
    expect(await store.readResult('run-2')).toMatchObject({ runId: 'run-2' })
    expect((await store.readFeedback('run-2')).map(item => item.id)).toEqual(['f-2'])
    await expect(store.deleteRun('../escape')).rejects.toThrow(/ID/)
  })
})

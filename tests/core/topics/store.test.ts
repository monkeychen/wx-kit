import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TopicMaterialSnapshot, TopicRunResult, TopicTraceEvent } from '../../../src/core/topics/types'
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
})

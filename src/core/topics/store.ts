import { appendFile, chmod, mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWriteFile } from '../atomic-write'
import { withPathLock } from '../path-lock'
import type { TopicFeedbackEvent, TopicMaterialSnapshot, TopicRunResult, TopicTraceEvent } from './types'

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/

function safeId(value: string, label: string): string {
  if (!SAFE_ID.test(value)) throw new Error(`${label} ID 无效：只接受字母、数字、下划线和连字符。`)
  return value
}

async function privateDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 })
  await chmod(path, 0o700).catch(() => {})
}

async function privateAtomicWrite(path: string, data: string): Promise<void> {
  await atomicWriteFile(path, data)
  await chmod(path, 0o600).catch(() => {})
}

export class TopicRunStore {
  constructor(private libraryRoot: string) {}

  private runDir(runId: string): string {
    return join(this.libraryRoot, 'topic-decisions', 'runs', safeId(runId, 'run'))
  }

  async writeManifest(runId: string, manifest: TopicMaterialSnapshot): Promise<string> {
    if (manifest.runId !== runId) throw new Error('manifest 的 run ID 与写入目标不一致。')
    const dir = this.runDir(runId)
    await privateDir(dir)
    const path = join(dir, 'manifest.json')
    await privateAtomicWrite(path, `${JSON.stringify(manifest, null, 2)}\n`)
    return path
  }

  async writeResult(runId: string, result: TopicRunResult): Promise<string> {
    if (result.runId !== runId) throw new Error('result 的 run ID 与写入目标不一致。')
    const dir = this.runDir(runId)
    await privateDir(dir)
    const path = join(dir, 'result.json')
    await privateAtomicWrite(path, `${JSON.stringify(result, null, 2)}\n`)
    return path
  }

  async appendTrace(runId: string, event: TopicTraceEvent): Promise<void> {
    const dir = this.runDir(runId)
    const path = join(dir, 'trace.jsonl')
    await withPathLock(path, async () => {
      await privateDir(dir)
      await appendFile(path, `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 })
      await chmod(path, 0o600).catch(() => {})
    })
  }

  async writeBrief(runId: string, topicId: string, markdown: string): Promise<string> {
    const dir = join(this.runDir(runId), 'briefs')
    await privateDir(dir)
    const path = join(dir, `${safeId(topicId, 'topic')}.md`)
    await privateAtomicWrite(path, markdown)
    return path
  }

  async writeFeedback(event: TopicFeedbackEvent): Promise<string> {
    safeId(event.id, 'feedback')
    safeId(event.runId, 'run')
    safeId(event.topicId, 'topic')
    if (!['skip', 'watch', 'already-written'].includes(event.decision)) throw new Error('feedback decision 无效。')
    const dir = join(this.libraryRoot, 'topic-decisions', 'feedback')
    await privateDir(dir)
    const path = join(dir, `${event.id}.json`)
    await privateAtomicWrite(path, `${JSON.stringify(event, null, 2)}\n`)
    return path
  }

  async readResult(runId: string): Promise<TopicRunResult> {
    const path = join(this.runDir(runId), 'result.json')
    let raw: string
    try {
      raw = await readFile(path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`选题运行 ${runId} 的结果不存在。`)
      throw error
    }
    try {
      const parsed = JSON.parse(raw) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
        || (parsed as { schemaVersion?: unknown }).schemaVersion !== 1
        || (parsed as { runId?: unknown }).runId !== runId) throw new Error('shape')
      return parsed as TopicRunResult
    } catch {
      throw new Error(`选题运行 ${runId} 的结果文件已损坏。`)
    }
  }
}

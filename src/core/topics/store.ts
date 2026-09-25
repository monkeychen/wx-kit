import { appendFile, chmod, mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWriteFile } from '../atomic-write'
import { withPathLock } from '../path-lock'
import type { TopicFeedbackEvent, TopicFeedbackDecision, TopicMaterialSnapshot, TopicRunResult, TopicTraceEvent } from './types'

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

  /** M78 历史回看：结果 + 素材快照（文章标题等），回看页据此重建完整现场。 */
  async readManifest(runId: string): Promise<TopicMaterialSnapshot> {
    const path = join(this.runDir(runId), 'manifest.json')
    const raw = await readFile(path, 'utf8')
    const parsed = JSON.parse(raw) as TopicMaterialSnapshot
    if (!parsed || parsed.runId !== runId) throw new Error(`选题运行 ${runId} 的素材快照已损坏。`)
    return parsed
  }

  /**
   * M78 历史列表：按时间倒序的运行摘要。单个 run 的文件缺失或损坏只跳过该条——
   * 历史列表是只读浏览，一条坏数据不该让整个列表打不开。
   */
  async listRunSummaries(limit = 30): Promise<TopicRunSummary[]> {
    const root = join(this.libraryRoot, 'topic-decisions', 'runs')
    let entries: string[]
    try { entries = await readdir(root) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    const summaries: TopicRunSummary[] = []
    for (const runId of entries) {
      if (!SAFE_ID.test(runId)) continue
      try {
        const result = await this.readResult(runId)
        let articleCount = 0
        let articleTitles: string[] = []
        try {
          const manifest = await this.readManifest(runId)
          articleCount = manifest.articles.length
          articleTitles = manifest.articles.map(item => item.title)
        } catch { /* 快照缺失时列表仍可展示，篇数留 0 */ }
        summaries.push({
          runId: result.runId,
          createdAt: result.createdAt,
          durationMs: result.durationMs,
          status: result.status,
          window: result.window,
          articleCount,
          articleTitles,
          cardQuestions: ('cards' in result ? result.cards : []).map(card => card.question),
        })
      } catch { /* 跳过损坏条目 */ }
      if (summaries.length >= limit * 3) break // 防目录异常膨胀时无限扫盘
    }
    summaries.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    return summaries.slice(0, limit)
  }

  /**
   * M78 历史回看：该 run 的全部反馈事件（时间正序）。
   * 反馈是 append-only 事件流，展示层按 topicId 取最后一条决定当前状态。
   */
  async readFeedback(runId: string): Promise<TopicFeedbackEvent[]> {
    const dir = join(this.libraryRoot, 'topic-decisions', 'feedback')
    let entries: string[]
    try { entries = await readdir(dir) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    const events: TopicFeedbackEvent[] = []
    for (const name of entries) {
      if (!name.endsWith('.json')) continue
      try {
        const parsed = JSON.parse(await readFile(join(dir, name), 'utf8')) as TopicFeedbackEvent
        if (parsed?.runId === runId && ['skip', 'watch', 'already-written'].includes(parsed.decision as TopicFeedbackDecision)) {
          events.push(parsed)
        }
      } catch { /* 跳过损坏事件 */ }
    }
    return events.sort((a, b) => (a.recordedAt < b.recordedAt ? -1 : 1))
  }

  /**
   * M78 删除一条历史：run 目录（result/manifest/trace/briefs）与该 run 的反馈事件一并清除。
   * 只删 topic-decisions 下的受管文件；「仅从列表隐藏」是 UI 层语义，不经过这里。
   */
  async deleteRun(runId: string): Promise<void> {
    safeId(runId, 'run')
    await rm(this.runDir(runId), { recursive: true, force: true })
    const feedbackDir = join(this.libraryRoot, 'topic-decisions', 'feedback')
    let entries: string[]
    try { entries = await readdir(feedbackDir) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    await Promise.all(entries
      .filter(name => name.endsWith('.json'))
      .map(async name => {
        const path = join(feedbackDir, name)
        try {
          const parsed = JSON.parse(await readFile(path, 'utf8')) as TopicFeedbackEvent
          if (parsed?.runId === runId) await rm(path, { force: true })
        } catch { /* 损坏事件文件留着不碍事 */ }
      }))
  }
}

export interface TopicRunSummary {
  runId: string
  createdAt: string
  durationMs: number
  status: TopicRunResult['status']
  window: TopicRunResult['window']
  articleCount: number
  articleTitles: string[]
  cardQuestions: string[]
}

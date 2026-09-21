import { describe, expect, it, vi } from 'vitest'
import type { TopicAnalyzeResponse } from '../../electron/services/topics-service'
import type { TopicTraceEvent, TopicWindowInput } from '../../src/core/topics/types'
import { initialSnapshot, TopicRunStore, type TopicRunStoreDeps } from '../../src/renderer/topic-run-store'

const WINDOW: TopicWindowInput = { preset: '24h' }

function fakeDeps() {
  const progressListeners: Array<(stage: TopicTraceEvent['stage']) => void> = []
  let analyzeResolve: ((r: TopicAnalyzeResponse) => void) | null = null
  const deps: TopicRunStoreDeps = {
    topicsAnalyze: vi.fn(() => new Promise<TopicAnalyzeResponse>(resolve => { analyzeResolve = resolve })),
    topicsCancel: vi.fn(async () => ({ ok: true as const })),
    topicsRunningStatus: vi.fn(async () => ({ running: false, startedAt: null, stage: null, window: null })),
    onTopicsProgress: cb => { progressListeners.push(cb); return () => {} },
  }
  const emitProgress = (stage: TopicTraceEvent['stage']) => progressListeners.forEach(l => l(stage))
  const finishAnalyze = (r: TopicAnalyzeResponse) => analyzeResolve?.(r)
  return { deps, emitProgress, finishAnalyze: () => finishAnalyze({ ok: true, result: { status: 'completed', runId: 'r1', cards: [] } as never, timeExcludedCount: 2 }), finishError: () => finishAnalyze({ ok: false, error: { code: 'X', message: 'boom' } }) }
}

describe('TopicRunStore 会话状态', () => {
  it('初始快照为空闲', () => {
    const { deps } = fakeDeps()
    expect(new TopicRunStore(deps).getSnapshot()).toEqual(initialSnapshot)
  })

  it('start 进入运行中并带阶段与起始时间，重复 start 被拒绝', () => {
    const { deps } = fakeDeps()
    const store = new TopicRunStore(deps)
    expect(store.start(WINDOW)).toBe(true)
    const snap = store.getSnapshot()
    expect(snap.running).toBe(true)
    expect(snap.stage).toBe('snapshot')
    expect(snap.startedAt).toBeTypeOf('number')
    expect(store.start({ preset: '7d' })).toBe(false)
    // 运行中范围草稿锁定
    store.selectWindow({ preset: '3d' })
    expect(store.getSnapshot().window).toEqual(WINDOW)
  })

  it('进度事件在无订阅者时也落快照（切页期间不丢阶段）', () => {
    const { deps, emitProgress } = fakeDeps()
    const store = new TopicRunStore(deps)
    store.start(WINDOW)
    emitProgress('extract')
    emitProgress('propose')
    expect(store.getSnapshot().stage).toBe('propose')
  })

  it('analyze 成功后结果与排除数落地，运行态清除', async () => {
    const { deps, finishAnalyze } = fakeDeps()
    const store = new TopicRunStore(deps)
    store.start(WINDOW)
    await finishAnalyze()
    const snap = store.getSnapshot()
    expect(snap.running).toBe(false)
    expect(snap.result?.status).toBe('completed')
    expect(snap.timeExcludedCount).toBe(2)
  })

  it('analyze 失败时错误落地且可再次 start', async () => {
    const { deps, finishError } = fakeDeps()
    const store = new TopicRunStore(deps)
    store.start(WINDOW)
    await finishError()
    expect(store.getSnapshot()).toMatchObject({ running: false, error: 'boom' })
    expect(store.start(WINDOW)).toBe(true)
  })

  it('sync：主进程在跑而本地空闲 → 恢复进行中现场', async () => {
    const { deps } = fakeDeps()
    deps.topicsRunningStatus = vi.fn(async () => ({ running: true, startedAt: 123, stage: 'extract' as const, window: { preset: '3d' } as TopicWindowInput }))
    const store = new TopicRunStore(deps)
    await store.sync()
    expect(store.getSnapshot()).toMatchObject({ running: true, stage: 'extract', startedAt: 123, window: { preset: '3d' } })
  })

  it('sync：本地以为在跑但 Promise 不在途且主进程空闲 → 收尾防假死', async () => {
    const { deps } = fakeDeps()
    const store = new TopicRunStore(deps)
    store.start(WINDOW)
    // 模拟热重载丢失在途 Promise（analyze resolve 引用被丢弃）
    deps.topicsRunningStatus = vi.fn(async () => ({ running: false, startedAt: null, stage: null, window: null }))
    ;(store as unknown as { awaitingAnalyze: boolean }).awaitingAnalyze = false
    await store.sync()
    expect(store.getSnapshot().running).toBe(false)
  })

  it('cancel：主进程报 NO_TOPIC_ANALYSIS 且本地无在途 → 本地收尾并回传消息', async () => {
    const { deps } = fakeDeps()
    deps.topicsCancel = vi.fn(async () => ({ ok: false, error: { code: 'NO_TOPIC_ANALYSIS', message: '当前没有正在运行的选题分析。' } }))
    const store = new TopicRunStore(deps)
    store.start(WINDOW)
    ;(store as unknown as { awaitingAnalyze: boolean }).awaitingAnalyze = false
    const result = await store.cancel()
    expect(result).toEqual({ ok: false, message: '当前没有正在运行的选题分析。' })
    expect(store.getSnapshot().running).toBe(false)
  })

  it('订阅者收到快照推送，退订后不再收到', async () => {
    const { deps } = fakeDeps()
    const store = new TopicRunStore(deps)
    const seen: boolean[] = []
    const listener = (s: ReturnType<TopicRunStore['getSnapshot']>) => seen.push(s.running)
    const unsubscribe = store.subscribe(listener)
    store.start(WINDOW)
    expect(seen).toEqual([true])
    unsubscribe()
    await deps.topicsCancel.call(store)
    store.reset()
    expect(seen).toEqual([true])
  })

  it('selectTopic 记录选中卡片（切页恢复详情展开）', () => {
    const { deps } = fakeDeps()
    const store = new TopicRunStore(deps)
    store.selectTopic('c1')
    expect(store.getSnapshot().selectedId).toBe('c1')
    store.dismissResult()
    expect(store.getSnapshot().selectedId).toBe(null)
  })
})

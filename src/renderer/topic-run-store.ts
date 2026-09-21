// 选题分析的会话级状态仓库。
// 背景：分析在主进程运行，页面组件的 useState 在切页卸载时全部丢失——用户切走再切回，
// 进度 UI 消失，再点「寻找选题」只得到「已有选题分析正在进行」却无处取消。
// 这里把「进行中 + 阶段 + 起始时间 + 结果」提升到组件外：组件用 useSyncExternalStore 订阅，
// 卸载只退订；analyze 的 Promise 由 store 持有，进度事件先落 store 再广播，
// 任何时刻重挂载页面都能恢复现场；挂载时还与主进程 runningStatus 对账（见 sync）。
import type { TopicAiConfigStatus } from '../../electron/services/topic-ai-config'
import type { TopicAnalyzeResponse } from '../../electron/services/topics-service'
import type { TopicRunResult, TopicTraceEvent, TopicWindowInput } from '../core/topics/types'

export interface TopicStreamView {
  stage: 'extract' | 'propose'
  /** 环形尾部缓冲：UI 只展示最新片段，全文再长也不撑爆内存。 */
  contentTail: string
  reasoningTail: string
  contentChars: number
  reasoningChars: number
}

export interface TopicRunSnapshot {
  running: boolean
  stage: TopicTraceEvent['stage'] | null
  startedAt: number | null
  window: TopicWindowInput | null
  result: TopicRunResult | null
  error: string | null
  timeExcludedCount: number
  selectedId: string | null
  /** M75：模型流式输出的实时视图；运行结束（成功/失败/取消）即清空。 */
  stream: TopicStreamView | null
}

const TAIL_CHARS = 4000
const clipTail = (current: string, append: string) => (current + append).slice(-TAIL_CHARS)

export const initialSnapshot: TopicRunSnapshot = {
  running: false, stage: null, startedAt: null, window: null,
  result: null, error: null, timeExcludedCount: 0, selectedId: null, stream: null,
}

type Listener = (snapshot: TopicRunSnapshot) => void

export interface TopicRunStoreDeps {
  topicsAnalyze: (input: { window: TopicWindowInput }) => Promise<TopicAnalyzeResponse>
  topicsCancel: () => Promise<{ ok: boolean; error?: { code: string; message: string } }>
  topicsRunningStatus: () => Promise<{ running: boolean; startedAt: number | null; stage: TopicTraceEvent['stage'] | null; window: TopicWindowInput | null }>
  onTopicsProgress: (cb: (stage: TopicTraceEvent['stage']) => void) => () => void
  onTopicsStream: (cb: (event: { stage: 'extract' | 'propose'; kind: 'content' | 'reasoning'; text: string }) => void) => () => void
}

export function configReady(config: TopicAiConfigStatus | null): boolean {
  return !!config?.baseUrl.trim() && !!config.model.trim() && config.keyConfigured
}

export class TopicRunStore {
  private snapshot: TopicRunSnapshot = initialSnapshot
  private readonly listeners = new Set<Listener>()
  private unsubscribed = false

  constructor(private deps: TopicRunStoreDeps) {
    // 进度事件常驻订阅：页面没挂载时事件也不能丢，否则切回来阶段停在空档。
    deps.onTopicsProgress(stage => {
      if (!this.snapshot.running || this.unsubscribed) return
      this.set({ stage })
    })
    deps.onTopicsStream(event => {
      if (!this.snapshot.running || this.unsubscribed) return
      const base: TopicStreamView = this.snapshot.stream?.stage === event.stage
        ? this.snapshot.stream
        : { stage: event.stage, contentTail: '', reasoningTail: '', contentChars: 0, reasoningChars: 0 }
      this.set({
        stream: event.kind === 'content'
          ? { ...base, contentTail: clipTail(base.contentTail, event.text), contentChars: base.contentChars + event.text.length }
          : { ...base, reasoningTail: clipTail(base.reasoningTail, event.text), reasoningChars: base.reasoningChars + event.text.length },
      })
    })
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  getSnapshot = (): TopicRunSnapshot => this.snapshot

  /**
   * 页面挂载时与主进程对账。store 是 renderer 进程内的会话状态，
   * 覆盖不了「analyze 在途但 store 记录被清」的边角（如热重载），以主进程快照为准。
   */
  async sync(): Promise<void> {
    const status = await this.deps.topicsRunningStatus()
    if (status.running && !this.snapshot.running) {
      // 主进程在跑而本地不知道（例：另一窗口触发的）——恢复进行中现场。
      this.set({ running: true, startedAt: status.startedAt, stage: status.stage, window: status.window, result: null, error: null, timeExcludedCount: 0, selectedId: null, stream: this.snapshot.stream })
    } else if (!status.running && this.snapshot.running && !this.awaitingAnalyze) {
      // 本地以为在跑但主进程空闲且无在途 Promise：收尾，避免假死进度条。
      this.set({ running: false, startedAt: null, stage: null })
    }
  }

  /** analyze Promise 是否仍在其途——在途时不采信 sync 的“空闲”判定，结果由 run() 落地。 */
  private awaitingAnalyze = false

  start(window: TopicWindowInput): boolean {
    if (this.snapshot.running) return false
    this.set({ running: true, stage: 'snapshot', startedAt: Date.now(), window, result: null, error: null, timeExcludedCount: 0, selectedId: null, stream: null })
    void this.run(window)
    return true
  }

  private async run(window: TopicWindowInput): Promise<void> {
    this.awaitingAnalyze = true
    try {
      const response = await this.deps.topicsAnalyze({ window })
      if (!this.snapshot.running) return // 被 reset/新运行取代，结果不落地
      if (response.ok) {
        this.set({ running: false, stage: null, startedAt: null, stream: null, result: response.result, timeExcludedCount: response.timeExcludedCount })
      } else {
        this.set({ running: false, stage: null, startedAt: null, stream: null, error: response.error.message })
      }
    } catch (error) {
      if (!this.snapshot.running) return
      this.set({ running: false, stage: null, startedAt: null, stream: null, error: (error as Error).message })
    } finally {
      this.awaitingAnalyze = false
    }
  }

  /** 用户点「取消」：只发信号，running 等 analyze 返回后自然结束（取消语义在主进程）。 */
  async cancel(): Promise<{ ok: boolean; message?: string }> {
    const response = await this.deps.topicsCancel()
    if (!response.ok) {
      // 主进程已无进行中任务（多半是切页期间刚好完成），本地状态收尾，不再谎称运行中。
      if (response.error?.code === 'NO_TOPIC_ANALYSIS' && this.snapshot.running && !this.awaitingAnalyze) {
        this.set({ running: false, stage: null, startedAt: null })
      }
      return { ok: false, message: response.error?.message }
    }
    return { ok: true }
  }

  reset(): void { this.set({ ...initialSnapshot }) }

  dismissResult(): void { this.set({ result: null, error: null, timeExcludedCount: 0, selectedId: null }) }

  selectTopic(id: string | null): void { this.set({ selectedId: id }) }

  /** 范围选择也是会话状态（切页保留），但分析进行中锁定，防止 UI 显示与运行参数不一致。 */
  selectWindow(window: TopicWindowInput): void {
    if (this.snapshot.running) return
    this.set({ window })
  }

  private set(patch: Partial<TopicRunSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch }
    for (const listener of [...this.listeners]) listener(this.snapshot)
  }
}

let apiPromise: Promise<TopicRunStoreDeps> | null = null
let singleton: TopicRunStore | null = null
/**
 * 页面用单例；测试注入 fake deps 构造独立实例。
 * api（window.api）只在浏览器存在，ESM 下不能同步 require——装配延迟到 import() 解析，
 * store 持一个稳定代理型 deps，各方法运行时再等 apiPromise。构造时的进度订阅同样
 * 在解析后挂上；页面挂载即 sync() 与主进程对账，解析窗口内的事件不会丢现场。
 */
export function getTopicRunStore(): TopicRunStore {
  if (singleton) return singleton
  apiPromise = import('./api').then(m => ({
    topicsAnalyze: (input: { window: TopicWindowInput }) => m.api.topicsAnalyze(input),
    topicsCancel: () => m.api.topicsCancel(),
    topicsRunningStatus: () => m.api.topicsRunningStatus(),
    onTopicsProgress: (cb: (stage: TopicTraceEvent['stage']) => void) => m.api.onTopicsProgress(cb),
    onTopicsStream: cb => m.api.onTopicsStream(cb),
  }))
  singleton = new TopicRunStore({
    topicsAnalyze: async input => (await apiPromise!).topicsAnalyze(input),
    topicsCancel: async () => (await apiPromise!).topicsCancel(),
    topicsRunningStatus: async () => (await apiPromise!).topicsRunningStatus(),
    onTopicsProgress: cb => { void apiPromise!.then(deps => deps.onTopicsProgress(cb)); return () => {} },
    onTopicsStream: cb => { void apiPromise!.then(deps => deps.onTopicsStream(cb)); return () => {} },
  })
  return singleton
}

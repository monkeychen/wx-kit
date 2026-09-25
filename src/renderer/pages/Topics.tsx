import { Fragment, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Alert, Badge, Button, Checkbox, Drawer, Input, Modal, Select, Segmented, Space, Spin, Tabs, Tag, message } from 'antd'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import type { ArticleMeta } from '../../core/types'
import type {
  TopicAiConfigStatus,
  TopicDecisionCard,
  TopicFeedbackDecision,
  TopicRunResult,
  TopicRunSummary,
  TopicWindowInput,
} from '../api'
import {
  confidenceLabel,
  feedbackLabel,
  isSafeExternalSource,
  readerValueLabel,
  resultNotice,
  stageLabel,
  statisticsLabel,
} from '../topic-view'
import { configReady, getTopicRunStore } from '../topic-run-store'
import {
  DEFAULT_MANUAL_FILTER,
  MANUAL_ALL_SOURCES,
  MANUAL_SORTS,
  MANUAL_TIME_RANGES,
  buildManualPickView,
  resolveExcerpt,
  type ManualExcerpt,
  type ManualFilterState,
  type ManualSourceOption,
  type ManualTimeRange,
} from '../topic-manual-pick'

const MAX_MANUAL = 30
/** 渐进渲染：首屏只铺这么多，其余靠「加载更多」。文库上千篇时避免一次渲染卡住弹层。 */
const MANUAL_PAGE_SIZE = 40

function usableCards(result: TopicRunResult | null): TopicDecisionCard[] {
  return result?.status === 'completed' || result?.status === 'partial' ? result.cards : []
}

function TopicDetail({ card, runId }: { card: TopicDecisionCard; runId: string }) {
  const [briefPath, setBriefPath] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { setBriefPath('') }, [card.id, runId])

  const recordFeedback = async (decision: TopicFeedbackDecision) => {
    const response = await api.topicsFeedback(runId, card.id, decision)
    if (response.ok) message.success(`已记录“${feedbackLabel(decision)}”`)
    else message.error(response.error.message)
  }

  const makeBrief = async () => {
    setBusy(true)
    try {
      const response = await api.topicsBrief(runId, card.id)
      if (!response.ok) { message.error(response.error.message); return }
      await api.copyText(response.markdown)
      setBriefPath(response.path)
      message.success('选题简报已生成并复制')
    } catch (error) { message.error('生成失败：' + (error as Error).message) }
    finally { setBusy(false) }
  }

  const why = (
    <div className="topic-detail-body">
      <section>
        <h3>读者可能获得什么</h3>
        <div className="topic-value-list">
          {card.readerValues.map(value => (
            <div className="topic-value-row" key={value.kind}>
              <Tag>{readerValueLabel(value.kind)}</Tag>
              <span>{value.benefit}</span>
              <span className="topic-inference">编辑推断</span>
            </div>
          ))}
        </div>
      </section>
      <section><h3>为什么值得考虑</h3><p>{card.rationale}</p></section>
      <section>
        <h3>{confidenceLabel(card.evidenceConfidence.level)}</h3>
        <ul>{card.evidenceConfidence.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
      </section>
      <section>
        <h3>限制</h3>
        <ul>{card.limitations.map(item => <li key={item}>{item}</li>)}</ul>
      </section>
    </div>
  )

  const evidence = (
    <div className="topic-detail-body">
      <Alert type="info" showIcon message="摘录存在不等于事实已验证" description="系统只确认下方文字能在本地素材中逐字定位，不代表外部事实已经独立核验。" />
      {card.evidence.map(item => (
        <article className="topic-evidence" data-testid="topic-evidence" key={item.id}>
          <div className="topic-evidence-head">
            <div><strong>{item.sourceTitle}</strong><span>{item.sourceAccount}</span></div>
            {isSafeExternalSource(item.sourceUrl) && <Button size="small" onClick={() => api.openExternal(item.sourceUrl)}>打开原文</Button>}
          </div>
          <blockquote>{item.quote}</blockquote>
          <div className="topic-evidence-meta">定位 {item.paragraphId} · {item.role === 'support' ? '支持材料' : item.role === 'counterpoint' ? '反方材料' : '背景材料'}</div>
        </article>
      ))}
    </div>
  )

  const outline = (
    <div className="topic-detail-body" data-testid="topic-outline">
      <section>
        <h3>建议结构</h3>
        <ol className="topic-outline-list">{card.outline.map(item => <li key={item}>{item}</li>)}</ol>
      </section>
      <section>
        <h3>动笔前还需补什么</h3>
        {card.missingEvidence.length
          ? <ul>{card.missingEvidence.map(item => <li key={item}>{item}</li>)}</ul>
          : <p className="faint">暂无明确缺口。</p>}
      </section>
    </div>
  )

  return (
    <section className="surface topic-detail" data-testid="topic-detail">
      <div className="topic-detail-head">
        <div>
          <div className="eyebrow">Selected topic</div>
          <h2>{card.question}</h2>
          <p>{card.angle}</p>
        </div>
        <div className="topic-distribution">传播效果未验证</div>
      </div>
      <Tabs items={[
        { key: 'why', label: '为什么值得写', children: why },
        { key: 'evidence', label: '材料依据', children: evidence },
        { key: 'outline', label: '怎么下笔', children: outline },
      ]} />
      <div className="topic-detail-actions">
        <Space wrap>
          <Button data-testid="topic-feedback-skip" onClick={() => recordFeedback('skip')}>暂不写</Button>
          <Button data-testid="topic-feedback-watch" onClick={() => recordFeedback('watch')}>保存观察</Button>
          <Button data-testid="topic-feedback-already-written" onClick={() => recordFeedback('already-written')}>已经写过</Button>
        </Space>
        <Space wrap>
          {briefPath && <Button data-testid="topic-reveal-brief" onClick={() => api.reveal(briefPath)}>显示文件</Button>}
          <Button type="primary" loading={busy} data-testid="topic-make-brief" onClick={makeBrief}>生成选题简报</Button>
        </Space>
      </div>
    </section>
  )
}

/**
 * M77：手动选篇弹层——筛选为主、搜索为辅。
 * 文库动辄上百篇，只给一个搜索框等于让人猜；先按时间/来源收窄、按时间排序，
 * 再看十几篇里挑哪几篇。搜索只作为收尾的精确查找（只匹配标题与来源）。
 * 已选跨筛选保留（切条件不丢勾选），上限与 core 护栏一致。
 * M78：行内「看一眼」（digest 优先、正文截断兜底）+「查看原文」跳阅读器。
 */
function ManualPickModal({ open, selected, onCancel, onConfirm }: {
  open: boolean
  selected: string[]
  onCancel: () => void
  onConfirm: (ids: string[]) => void
}) {
  const nav = useNavigate()
  const [articles, setArticles] = useState<ArticleMeta[] | null>(null)
  const [filter, setFilter] = useState<ManualFilterState>(DEFAULT_MANUAL_FILTER)
  const [draft, setDraft] = useState<string[]>(selected)
  const [limit, setLimit] = useState(MANUAL_PAGE_SIZE)
  // 弹层打开瞬间冻结「现在」，整轮筛选共用同一个参照时刻。
  const [asOfMs, setAsOfMs] = useState(() => Date.now())
  // 「看一眼」手风琴：同时只展开一篇，列表保持可扫读；摘录懒加载并缓存。
  const [excerptId, setExcerptId] = useState<string | null>(null)
  const [excerpts, setExcerpts] = useState<Record<string, ManualExcerpt>>({})

  useEffect(() => {
    if (!open) return
    setDraft(selected)
    setFilter(DEFAULT_MANUAL_FILTER)
    setLimit(MANUAL_PAGE_SIZE)
    setAsOfMs(Date.now())
    setExcerptId(null)
  }, [open, selected])
  useEffect(() => {
    if (!open || articles !== null) return
    api.libraryList().then(setArticles).catch(() => { setArticles([]); message.error('读取文库失败') })
  }, [open, articles])

  /** 「看一眼」：digest 立即可用；没有 digest 才懒加载正文 md 兜底。结果缓存。 */
  const toggleExcerpt = (article: ArticleMeta) => {
    if (excerptId === article.id) { setExcerptId(null); return }
    setExcerptId(article.id)
    if (excerpts[article.id]) return
    const quick = resolveExcerpt(article)
    if (quick.kind !== 'none') { setExcerpts(current => ({ ...current, [article.id]: quick })); return }
    api.readContent(article.dir, 'md')
      .then(md => setExcerpts(current => ({ ...current, [article.id]: resolveExcerpt(article, md) })))
      .catch(() => setExcerpts(current => ({ ...current, [article.id]: { kind: 'none', text: '' } })))
  }

  /** 「查看原文」：记住选稿现场，跳文库阅读器；返回时原样恢复。 */
  const openInReader = (id: string) => {
    sessionStorage.setItem('wxk-topics-pick-return', '1')
    nav(`/reader/${encodeURIComponent(id)}`)
  }

  const view = useMemo(
    () => (articles ? buildManualPickView(articles, filter, { asOfMs, selectedIds: draft }) : null),
    [articles, filter, asOfMs, draft],
  )

  const patch = (next: Partial<ManualFilterState>) => { setFilter(current => ({ ...current, ...next })); setLimit(MANUAL_PAGE_SIZE) }
  const reset = () => { setFilter(DEFAULT_MANUAL_FILTER); setLimit(MANUAL_PAGE_SIZE) }

  const toggle = (id: string, checked: boolean) => {
    setDraft(current => {
      if (!checked) return current.filter(item => item !== id)
      if (current.length >= MAX_MANUAL) { message.warning(`一次最多选择 ${MAX_MANUAL} 篇`); return current }
      return [...current, id]
    })
  }

  const selectAllHits = () => {
    if (!view) return
    const add = view.visible.filter(article => !draft.includes(article.id))
    if (add.length === 0) { message.info('当前命中都已选中'); return }
    const room = MAX_MANUAL - draft.length
    if (add.length > room) message.warning(`已达上限 ${MAX_MANUAL} 篇，这次只加入了 ${room} 篇`)
    setDraft([...draft, ...add.slice(0, room).map(article => article.id)])
  }

  const clearHits = () => {
    if (!view) return
    const hitIds = new Set(view.visible.map(article => article.id))
    const kept = draft.filter(id => !hitIds.has(id))
    if (kept.length === draft.length) { message.info('当前命中里没有已选文章'); return }
    setDraft(kept)
  }

  const picked = new Set(draft)
  const sourceGroups = (options: ManualSourceOption[]) => [
    { label: `全部来源（${options.reduce((sum, item) => sum + item.count, 0)}）`, value: MANUAL_ALL_SOURCES },
    { label: '公众号', options: options.filter(item => item.kind === 'wx')
      .map(item => ({ label: `${item.name}（${item.count}）`, value: item.id })) },
    { label: '墨问作者', options: options.filter(item => item.kind === 'mowen')
      .map(item => ({ label: `${item.name}（${item.count}）`, value: item.id })) },
  ]

  // 渐进渲染：按组切片，组头仍显示该组在全部命中里的篇数。
  let remaining = limit
  const blocks = (view?.groups ?? []).map(group => {
    if (remaining <= 0) return null
    const items = group.items.slice(0, remaining)
    remaining -= items.length
    return (
      <Fragment key={group.key}>
        <div className="topic-manual-group">
          <span>{group.label}</span>
          <span>{group.items.length} 篇</span>
        </div>
        {items.map(article => {
          const excerpt = excerpts[article.id]
          return (
            <div className={`topic-manual-row${picked.has(article.id) ? ' picked' : ''}`} key={article.id}>
              <div className="topic-manual-row-main">
                <label className="topic-manual-pick">
                  <Checkbox checked={picked.has(article.id)} onChange={event => toggle(article.id, event.target.checked)} />
                  <span className="topic-manual-copy">
                    <strong>{article.title || '(无标题)'}</strong>
                    <span>{article.account || '未知公众号'} · {article.publishTime || '时间未知'}</span>
                  </span>
                </label>
                <span className="topic-manual-row-actions">
                  <button type="button" className="topic-manual-action" data-testid="topic-manual-peek"
                    onClick={() => toggleExcerpt(article)}>{excerptId === article.id ? '收起' : '看一眼'}</button>
                  <button type="button" className="topic-manual-action" data-testid="topic-manual-open"
                    onClick={() => openInReader(article.id)}>查看原文</button>
                </span>
              </div>
              {excerptId === article.id && (
                <div className="topic-manual-excerpt" data-testid="topic-manual-excerpt">
                  {!excerpt && '加载中…'}
                  {excerpt?.kind === 'digest' && excerpt.text}
                  {excerpt?.kind === 'content' && <>（作者没写摘要，以下是正文开头）{excerpt.text}</>}
                  {excerpt?.kind === 'none' && '本地没有这篇的摘要或正文（下载时可能未含 markdown）。'}
                </div>
              )}
            </div>
          )
        })}
      </Fragment>
    )
  })

  const narrowed: string[] = []
  if (filter.time !== 'all') narrowed.push('时间范围')
  if (filter.sourceId !== MANUAL_ALL_SOURCES) narrowed.push('来源')
  if (filter.keyword.trim()) narrowed.push('关键词')
  if (filter.onlyPicked) narrowed.push('仅看已选')

  return (
    <Modal open={open} title="选择文章作为素材" data-testid="topic-manual-modal" width={920} zIndex={1000}
      onCancel={onCancel} destroyOnClose
      footer={(
        <div className="topic-manual-foot">
          <div className="topic-manual-foot-info">
            <span data-testid="topic-manual-hits">命中 {view?.hits.length ?? 0} 篇 · 已选 {draft.length} 篇</span>
            {(view?.hiddenSelectedCount ?? 0) > 0 && (
              <span className="topic-manual-keep">其中 {view?.hiddenSelectedCount} 篇不在当前条件内，已保留</span>
            )}
            {draft.length >= MAX_MANUAL && <span className="topic-manual-keep">已达上限 {MAX_MANUAL} 篇</span>}
            <Button size="small" data-testid="topic-manual-select-all" onClick={selectAllHits}>全选命中</Button>
            <Button size="small" data-testid="topic-manual-clear-hits" onClick={clearHits}>清空命中</Button>
          </div>
          <Space>
            <Button onClick={onCancel}>取消</Button>
            <Button type="primary" data-testid="topic-manual-confirm" disabled={draft.length === 0}
              onClick={() => onConfirm(draft)}>
              {draft.length ? `用这 ${draft.length} 篇分析` : '选择文章'}
            </Button>
          </Space>
        </div>
      )}>
      <div className="topic-manual-filters">
        <div className="topic-manual-filter-row">
          <Segmented data-testid="topic-manual-time" value={filter.time} options={MANUAL_TIME_RANGES}
            onChange={value => patch({ time: value as ManualTimeRange })} />
          <Select data-testid="topic-manual-source" style={{ minWidth: 190 }} value={filter.sourceId}
            options={sourceGroups(view?.sourceOptions ?? [])}
            onChange={value => patch({ sourceId: value })} />
          <Select data-testid="topic-manual-sort" style={{ minWidth: 168 }} value={filter.sort} options={MANUAL_SORTS}
            onChange={value => patch({ sort: value })} />
        </div>
        <div className="topic-manual-filter-row">
          <Input data-testid="topic-manual-search" allowClear placeholder="在标题、公众号 / 墨问作者中搜索（可留空）"
            value={filter.keyword} onChange={event => patch({ keyword: event.target.value })} />
          <Checkbox checked={filter.onlyPicked} onChange={event => patch({ onlyPicked: event.target.checked })}>仅看已选</Checkbox>
          <span className="faint">命中 {view?.hits.length ?? 0} 篇</span>
          <Button type="link" size="small" onClick={reset}>重置条件</Button>
        </div>
        {(view?.unknownTimeCount ?? 0) > 0 && (
          <div className="topic-manual-note">另有 {view?.unknownTimeCount} 篇没有可解析的发表时间，切到「全部」即可看到。</div>
        )}
      </div>

      <div className="topic-manual-list" data-testid="topic-manual-list">
        {articles === null && <Spin style={{ margin: 24 }} />}
        {view && view.visible.length === 0 && articles !== null && (
          <div className="topic-manual-empty" data-testid="topic-manual-empty">
            <strong>没有文章符合当前条件</strong>
            <p>{narrowed.length ? `卡住的条件：${narrowed.join(' · ')}` : articles.length === 0 ? '文库还是空的，先去下载一些文章。' : ''}</p>
            <Space>
              {filter.time !== 'all' && <Button onClick={() => patch({ time: 'all' })}>放宽到全部时间</Button>}
              <Button onClick={reset}>重置全部条件</Button>
            </Space>
          </div>
        )}
        {blocks}
        {view && view.visible.length > limit && (
          <button type="button" className="topic-manual-more" data-testid="topic-manual-more"
            onClick={() => setLimit(current => current + MANUAL_PAGE_SIZE)}>
            加载更多（还有 {view.visible.length - limit} 篇）
          </button>
        )}
      </div>
    </Modal>
  )
}

export default function Topics() {
  const navigate = useNavigate()
  const store = useMemo(getTopicRunStore, [])
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [config, setConfig] = useState<TopicAiConfigStatus | null>(null)
  const [manualOpen, setManualOpen] = useState(false)
  // M78：从阅读器「返回选稿」回来时自动重开弹层——勾选与筛选在弹层组件的 state 里，
  // 只要挂载后立刻把 open 置真，现场原样恢复。
  // 标记三态：'1'=已跳出未返回；'return'=点了返回按钮（消费后重开弹层）；无=普通进入。
  // 消费动作只在这里做——阅读器侧若先删，挂载时就读不到了。
  useEffect(() => {
    if (sessionStorage.getItem('wxk-topics-pick-return') === 'return') {
      sessionStorage.removeItem('wxk-topics-pick-return')
      setManualOpen(true)
    }
  }, [])
  // M78：GUI 只提供人工选篇——输入素材恒为 manual；时间窗口能力仅 CLI 保留。
  const manualIds = snapshot.window?.preset === 'manual' ? snapshot.window.articleIds : []
  const loading = snapshot.running
  const stage = snapshot.stage ? stageLabel(snapshot.stage) : ''
  const [elapsed, setElapsed] = useState(0)
  const result = snapshot.result
  const selectedId = snapshot.selectedId
  const cards = useMemo(() => usableCards(result), [result])

  // M78 历史选题：数据本就按 run 落盘，这里补列举与回看入口。
  const [historyOpen, setHistoryOpen] = useState(false)
  const [history, setHistory] = useState<TopicRunSummary[] | null>(null)
  // 回看状态用本地 state，不污染内存 run store——关闭回看即回到当前现场。
  const [viewing, setViewing] = useState<{ result: TopicRunResult; articleTitles: string[]; feedback: Record<string, TopicFeedbackDecision> } | null>(null)
  const viewingCards = useMemo(() => usableCards(viewing?.result ?? null), [viewing])
  const viewingSelectedId = viewing?.result.status === 'completed' || viewing?.result.status === 'partial'
    ? viewingCards[viewingCards.length - 1]?.id ?? null
    : null
  const [viewingSelected, setViewingSelected] = useState<string | null>(null)

  useEffect(() => { api.topicsGetConfig().then(setConfig).catch(() => setConfig(null)) }, [])
  // 挂载时与主进程对账：分析在跑但本地不知道（例如另一处触发）时恢复现场。
  useEffect(() => { void store.sync() }, [store])
  // 加载计时：让人分得清「在跑」和「卡死」。M75 起无总超时（长生成正常），
  // 起点用 snapshot.startedAt——切页再回来计时不归零。
  useEffect(() => {
    if (!loading || !snapshot.startedAt) { setElapsed(0); return }
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - snapshot.startedAt!) / 1000)))
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [loading, snapshot.startedAt])

  const setWindow = (window: TopicWindowInput) => store.selectWindow(window)

  const analyze = async () => {
    if (!configReady(config)) { message.warning('先配置 AI 模型服务'); navigate('/settings'); return }
    if (manualIds.length === 0) { setManualOpen(true); return }
    setViewing(null)
    store.start({ preset: 'manual', articleIds: manualIds })
  }

  const cancel = async () => {
    const response = await store.cancel()
    if (!response.ok && response.message) message.info(response.message)
  }

  const openHistory = async () => {
    setHistoryOpen(true)
    if (history === null) {
      const list = await api.topicsHistory().catch(() => [])
      setHistory(list)
    }
  }

  /** M78 删除历史：「仅列表移除」只隐藏 UI 记录（localStorage）；「删除文件」物理清盘。 */
  const HIDDEN_RUNS_KEY = 'wxk-topics-hidden-runs'
  const readHiddenRuns = (): string[] => {
    try { return JSON.parse(localStorage.getItem(HIDDEN_RUNS_KEY) ?? '[]') as string[] } catch { return [] }
  }
  const [hiddenRuns, setHiddenRuns] = useState<string[]>([])
  const [deleting, setDeleting] = useState<{ runId: string; questions: string[] } | null>(null)
  // 删除方式：默认「仅从列表移除」——可恢复的那项做默认，销毁性操作永远需要一次额外选择。
  const [deleteMode, setDeleteMode] = useState<'ui' | 'files'>('ui')

  useEffect(() => { setHiddenRuns(readHiddenRuns()) }, [])
  const hideInList = (runId: string) => {
    const next = [...new Set([...readHiddenRuns(), runId])]
    localStorage.setItem(HIDDEN_RUNS_KEY, JSON.stringify(next))
    setHiddenRuns(next)
  }
  const removeHistoryItem = async (runId: string, withFiles: boolean) => {
    setDeleting(null)
    if (viewing?.result.runId === runId) setViewing(null)
    if (withFiles) {
      const response = await api.topicsDeleteRunFiles(runId)
      if (!response.ok) { message.error(response.error.message); return }
      const next = readHiddenRuns().filter(id => id !== runId)
      localStorage.setItem(HIDDEN_RUNS_KEY, JSON.stringify(next))
      setHiddenRuns(next)
    } else {
      hideInList(runId)
    }
    setHistory(current => (current ?? []).filter(item => item.runId !== runId))
    message.success(withFiles ? '已删除该次记录与本地文件' : '已从列表移除（本地文件保留）')
  }

  const viewRun = async (runId: string) => {
    const response = await api.topicsReadRun(runId)
    if (!response.ok) { message.error(response.error.message); return }
    const feedback: Record<string, TopicFeedbackDecision> = {}
    for (const item of response.feedback) feedback[item.topicId] = item.decision
    setViewing({ result: response.result, articleTitles: response.articleTitles, feedback })
    setViewingSelected(null)
    setHistoryOpen(false)
  }

  const notice = result ? resultNotice(result) : null
  const stream = snapshot.stream
  // 实时输出滚动跟随：新内容到达即贴底，用户不手动往上翻就一直跟在尾部。
  const streamRef = useRef<HTMLPreElement>(null)
  useEffect(() => {
    const node = streamRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [stream?.contentTail, stream?.reasoningTail])

  return (
    <div className="page" data-testid="topics-page">
      <div className="fade-in topic-page-inner">
        <div className="page-head topic-page-head">
          <div>
            <div className="eyebrow">Topics</div>
            <h1 className="page-title">今天写什么</h1>
            <div className="page-sub">从你选定的素材中找出最多 3 个可追溯的候选，帮你判断“值不值写”。</div>
          </div>
          <Badge count={history?.length ?? 0} size="small" offset={[-4, 4]}>
            <Button data-testid="topic-history" onClick={openHistory} disabled={loading}>历史选题</Button>
          </Badge>
        </div>

        <section className="surface topic-toolbar">
          <div className="topic-range-control">
            <label>输入素材</label>
            <div className="topic-manual-picker" data-testid="topic-manual-picker">
              {manualIds.length === 0
                ? <Button data-testid="topic-manual-pick" disabled={loading} onClick={() => setManualOpen(true)}>选择文章</Button>
                : <>
                    <span className="faint" data-testid="topic-manual-count">已选 {manualIds.length} 篇</span>
                    <Button size="small" data-testid="topic-manual-edit" disabled={loading} onClick={() => setManualOpen(true)}>修改</Button>
                  </>}
            </div>
          </div>
          <Space>
            {loading && <Button data-testid="topic-cancel" onClick={cancel}>取消</Button>}
            <Button type="primary" size="large" loading={loading} data-testid="topic-analyze" onClick={analyze}>寻找选题</Button>
          </Space>
          <div className="topic-privacy-note">分析时，所选文章正文会发送到你配置的 AI 服务{config?.baseUrl ? `（${config.baseUrl}）` : ''}。
          </div>
        </section>

        {!configReady(config) && config !== null && (
          <Alert className="topic-alert" type="warning" showIcon
            message="还不能开始分析"
            description="请先在设置里配置 AI 模型服务（厂商、模型和 API Key）。"
            action={<Button data-testid="topic-go-settings" onClick={() => navigate('/settings')}>前往设置</Button>} />
        )}

        {loading && (
          <div className="surface topic-loading">
            <Spin />
            <strong>{stage || '正在分析'}</strong>
            <span>已等待 {elapsed} 秒{elapsed >= 60 ? '，素材多时模型生成会更久，可随时取消' : '，这一次只读取你选定的文章'}</span>
          </div>
        )}

        {loading && stream && (
          <div className="surface topic-stream" data-testid="topic-stream">
            <div className="topic-stream-head">
              <strong>{stream.stage === 'extract' ? '模型正在提取材料依据' : '模型正在形成候选选题'}</strong>
              <span className="faint">正文 {stream.contentChars} 字{stream.reasoningChars ? ` · 思考 ${stream.reasoningChars} 字` : ''}</span>
            </div>
            {stream.reasoningTail && <pre className="topic-stream-reasoning" data-testid="topic-stream-reasoning">{stream.reasoningTail}</pre>}
            <pre ref={streamRef} className="topic-stream-content" data-testid="topic-stream-content">{stream.contentTail}</pre>
          </div>
        )}

        {notice && (
          <Alert className="topic-alert" type={notice.tone} showIcon message={notice.text} />
        )}

        {viewing && !loading && (
          <Alert className="topic-alert" type="info" showIcon data-testid="topic-viewing-banner"
            message={`正在查看 ${formatRunTime(viewing.result.createdAt)} 的历史选题`}
            description={`当时输入素材 ${viewing.articleTitles.length} 篇。反馈与简报仍可继续使用。`}
            action={<Button size="small" data-testid="topic-viewing-back" onClick={() => setViewing(null)}>返回</Button>} />
        )}

        {(() => {
          // 回看时用 viewing 的数据渲染；正常时用内存 store——两套选中互不干扰。
          const isViewing = viewing !== null && !loading
          if (!isViewing && cards.length === 0) return null
          const shownCards = isViewing ? viewingCards : cards
          const shownSelectedId = isViewing ? (viewingSelected ?? viewingSelectedId) : selectedId
          const shownCard = shownCards.find(card => card.id === shownSelectedId) ?? null
          const shownResult = (isViewing ? viewing!.result : result)!
          return (
            <>
              <div className="topic-grid" role="radiogroup" aria-label="候选选题">
                {shownCards.map((card, index) => {
                  const feedback = isViewing ? viewing!.feedback[card.id] : null
                  return (
                    <button key={card.id} type="button" role="radio" aria-checked={shownSelectedId === card.id}
                      className={`topic-card${shownSelectedId === card.id ? ' selected' : ''}`}
                      data-testid="topic-card"
                      onClick={() => (isViewing ? setViewingSelected(card.id) : store.selectTopic(card.id))}>
                      <div className="topic-card-index">0{index + 1}</div>
                      <h2>{card.question}</h2>
                      <p>{card.angle}</p>
                      <div className="topic-card-values">
                        {card.readerValues.map(value => <Tag key={value.kind}>{readerValueLabel(value.kind)}</Tag>)}
                      </div>
                      <div className="topic-card-meta">{statisticsLabel(card.statistics)}</div>
                      <div className="topic-card-footer">
                        <span>{feedback ? <Tag color="orange" data-testid="topic-card-feedback">{feedbackLabel(feedback)}</Tag> : confidenceLabel(card.evidenceConfidence.level)}</span>
                        <span>传播未验证</span>
                      </div>
                    </button>
                  )
                })}
              </div>
              {!shownCard && <div className="topic-pick-hint">选一个你想继续判断的题目，再展开依据和起笔结构。</div>}
              {shownCard && <TopicDetail card={shownCard} runId={shownResult.runId} />}
            </>
          )
        })()}
      </div>

      <ManualPickModal open={manualOpen} selected={manualIds}
        onCancel={() => setManualOpen(false)}
        onConfirm={ids => { setWindow({ preset: 'manual', articleIds: ids }); setManualOpen(false) }} />

      <Drawer title="历史选题" placement="right" width={440} open={historyOpen}
        data-testid="topic-history-drawer"
        onClose={() => setHistoryOpen(false)}>
        {history === null && <Spin style={{ margin: 24 }} />}
        {history !== null && history.length === 0 && <p className="faint">还没有历史记录，先跑一次「寻找选题」。</p>}
        {history !== null && history.filter(item => !hiddenRuns.includes(item.runId)).map(item => (
          <div key={item.runId} role="button" tabIndex={0} className="topic-history-item" data-testid="topic-history-item"
            onClick={() => void viewRun(item.runId)}
            onKeyDown={event => { if (event.key === 'Enter') void viewRun(item.runId) }}>
            <div className="topic-history-head">
              <strong>{formatRunTime(item.createdAt)}</strong>
              <span className="topic-history-actions">
                <Tag color={item.status === 'completed' ? 'green' : item.status === 'partial' ? 'orange' : 'red'}>
                  {item.status === 'completed' ? '完成' : item.status === 'partial' ? '部分完成' : item.status === 'insufficient-material' ? '素材不足' : item.status === 'cancelled' ? '已取消' : '失败'}
                </Tag>
                <Button size="small" type="text" data-testid="topic-history-delete"
                  onClick={event => { event.stopPropagation(); setDeleteMode('ui'); setDeleting({ runId: item.runId, questions: item.cardQuestions }) }}>删除</Button>
              </span>
            </div>
            <div className="topic-history-cards">
              {item.cardQuestions.length === 0 ? <span className="faint">（无候选）</span>
                : item.cardQuestions.map(question => <span key={question}>{question}</span>)}
            </div>
            <div className="faint">输入素材 {item.articleCount} 篇 · 用时 {Math.round(item.durationMs / 1000)} 秒</div>
          </div>
        ))}
      </Drawer>

      <Modal open={deleting !== null} title="删除这条历史选题？" width={440} zIndex={1000}
        onCancel={() => setDeleting(null)}
        footer={[
          <Button key="cancel" onClick={() => setDeleting(null)}>取消</Button>,
          <Button key="confirm" type="primary" danger={deleteMode === 'files'} data-testid="topic-history-delete-confirm"
            onClick={() => void removeHistoryItem(deleting!.runId, deleteMode === 'files')}>
            {deleteMode === 'files' ? '删除并清除文件' : '从列表移除'}
          </Button>,
        ]} data-testid="topic-history-delete-modal">
        {deleting && (
          <>
            <div className="topic-delete-what">
              {deleting.questions.length > 0
                ? deleting.questions.map(question => <div key={question}>{question}</div>)
                : <div className="faint">这次分析没有产出候选</div>}
            </div>
            <div className="topic-delete-choices">
              <label className={`topic-delete-choice${deleteMode === 'ui' ? ' on' : ''}`}>
                <input type="radio" name="topic-delete-mode" checked={deleteMode === 'ui'}
                  onChange={() => setDeleteMode('ui')} />
                <span className="topic-delete-choice-main">仅从列表移除</span>
                <span className="topic-delete-choice-sub">本地文件保留，历史入口里可再清理</span>
              </label>
              <label className={`topic-delete-choice${deleteMode === 'files' ? ' on' : ''}`}>
                <input type="radio" name="topic-delete-mode" checked={deleteMode === 'files'}
                  onChange={() => setDeleteMode('files')} />
                <span className="topic-delete-choice-main danger">删除本地文件</span>
                <span className="topic-delete-choice-sub">结果、素材快照、简报一并清除，不可恢复</span>
              </label>
            </div>
          </>
        )}
      </Modal>
    </div>
  )
}

function formatRunTime(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return iso
  return new Date(t).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
